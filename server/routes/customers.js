import { Router } from 'express';
import { loginLimiter, requireLogin, requireManager, verifyPassword } from '../auth.js';
import { q } from '../db.js';
import { createCustomer, validateCustomer } from '../services/customers.js';
import { packageCode, packageLimits, semesterEnd, setMembership, weekOf, weekUsage } from '../services/members.js';
import { snapshotTo, backupDir } from '../backup.js';
import path from 'node:path';
import { addDays, diffDays, isDate, now, today } from '../time.js';
import { CODE_RE, HttpError, likeEscape, pageParams } from '../util.js';

const router = Router();

// 开单时的客户联想搜索（店员可用，只返回必要字段）
// code=xxxx：按编码精确查找（同一编码可能有多位客户，供店员选择）；q=关键字：姓名/编码模糊查找
router.get('/search', requireLogin, (req, res) => {
  if (req.query.code !== undefined) {
    const code = String(req.query.code).trim();
    if (!CODE_RE.test(code)) return res.json([]);
    return res.json(
      q.all(
        `SELECT c.id, c.name, c.code, c.member_type, c.base_code,
           (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'pending') AS pending_count,
           (SELECT MAX(received_at) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelled') AS last_received_at
         FROM customers c WHERE c.code = ? OR c.base_code = ?
         ORDER BY last_received_at DESC NULLS LAST, c.id
         LIMIT 50`,
        code,
        code,
      ),
    );
  }
  const kw = String(req.query.q ?? '').trim().slice(0, 30);
  if (!kw) return res.json([]);
  const like = `%${likeEscape(kw)}%`;
  const prefix = `${likeEscape(kw)}%`;
  const rows = q.all(
    `SELECT c.id, c.name, c.code, c.member_type, c.base_code,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'pending') AS pending_count
     FROM customers c
     WHERE c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\'
     ORDER BY (c.code = ? OR c.base_code = ?) DESC, (c.name = ?) DESC,
              (c.code LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\') DESC,
              c.updated_at DESC
     LIMIT 10`,
    like,
    like,
    kw,
    kw,
    kw,
    prefix,
    prefix,
  );
  res.json(rows);
});

const STATS_JOIN = `
  LEFT JOIN (
    SELECT customer_id,
      SUM(status != 'cancelled') AS order_count,
      SUM(CASE WHEN status != 'cancelled' THEN total_qty ELSE 0 END) AS total_qty,
      SUM(CASE WHEN status != 'cancelled' THEN amount ELSE 0 END) AS total_amount,
      SUM(status = 'pending') AS pending_count,
      MIN(CASE WHEN status != 'cancelled' THEN received_at END) AS first_received_at,
      MAX(CASE WHEN status != 'cancelled' THEN received_at END) AS last_received_at
    FROM orders GROUP BY customer_id
  ) s ON s.customer_id = c.id`;

function withStats(row) {
  return {
    ...row,
    order_count: row.order_count || 0,
    total_qty: row.total_qty || 0,
    total_amount: row.total_amount || 0,
    pending_count: row.pending_count || 0,
  };
}

router.get('/', requireManager, (req, res) => {
  const kw = String(req.query.q ?? '').trim().slice(0, 30);
  const { page, pageSize, offset } = pageParams(req.query);
  const conds = [];
  const params = [];
  if (kw) {
    const like = `%${likeEscape(kw)}%`;
    conds.push(`(c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  // member=package 只看包期会员，member=regular 只看普通会员
  if (['package', 'regular'].includes(req.query.member)) {
    conds.push('c.member_type = ?');
    params.push(req.query.member);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  // 包期会员人数，以及本周超额的人数
  const members = q.all(`SELECT id FROM customers WHERE member_type = 'package'`);
  const usageOf = weekUsage(weekOf(today()));
  const packageExcess = members.filter((c) => usageOf(c.id).over > 0).length;
  const { total } = q.get(`SELECT COUNT(*) AS total FROM customers c ${where}`, ...params);
  const rows = q.all(
    `SELECT c.*, s.order_count, s.total_qty, s.total_amount, s.pending_count, s.first_received_at, s.last_received_at
     FROM customers c ${STATS_JOIN}
     ${where}
     ORDER BY COALESCE(s.last_received_at, c.created_at) DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  );
  res.json({
    total,
    page,
    page_size: pageSize,
    package_count: members.length,
    package_excess: packageExcess,
    items: rows.map(withStats),
  });
});

// 包期会员每周情况（店长周末查看）：每位会员这一周各品类送了多少，超额的置顶
// date：这一周里的任意一天，默认本周；q：姓名 / 编码 / 电话
router.get('/package-week', requireManager, (req, res) => {
  const week = weekOf(isDate(req.query.date) ? req.query.date : today());
  const thisWeek = weekOf(today()).start;
  const limits = packageLimits();
  const usageOf = weekUsage(week, limits);
  const kw = String(req.query.q ?? '').trim().slice(0, 30);
  const { page, pageSize, offset } = pageParams(req.query);
  let where = `WHERE c.member_type = 'package'`;
  const params = [];
  if (kw) {
    const like = `%${likeEscape(kw)}%`;
    where += ` AND (c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')`;
    params.push(like, like, like);
  }
  const rows = q
    .all(
      `SELECT c.*, s.order_count, s.total_qty, s.total_amount, s.pending_count, s.first_received_at, s.last_received_at
       FROM customers c ${STATS_JOIN}
       ${where}
       ORDER BY COALESCE(s.last_received_at, c.created_at) DESC, c.id DESC`,
      ...params,
    )
    .map((c) => ({ ...withStats(c), ...usageOf(c.id) }));
  // 超额的排在最前面（超得多的在前），其余保持最近送来的顺序
  rows.sort((a, b) => b.over - a.over);
  res.json({
    week: {
      ...week,
      ago: diffDays(week.start, thisWeek) / 7, // 0 本周，1 上周……
      prev: addDays(week.start, -7),
      next: week.start < thisWeek ? addDays(week.start, 7) : null,
    },
    limits,
    total: rows.length,
    excess_count: rows.filter((r) => r.over > 0).length,
    page,
    page_size: pageSize,
    items: rows.slice(offset, offset + pageSize),
  });
});

router.get('/:id', requireManager, (req, res) => {
  const row = q.get(
    `SELECT c.*, s.order_count, s.total_qty, s.total_amount, s.pending_count, s.first_received_at, s.last_received_at
     FROM customers c ${STATS_JOIN}
     WHERE c.id = ?`,
    Number(req.params.id),
  );
  if (!row) throw new HttpError(404, '客户不存在');
  res.json(withStats(row));
});

// 学期结束：所有包期会员降为普通会员，编码恢复为原来的 4 位数
// 需要输入当前登录账号的密码确认，操作前自动备份
router.post('/semester-end', requireManager, (req, res) => {
  const password = String(req.body.password ?? '');
  if (!password) throw new HttpError(400, '请输入登录密码');
  const key = `semester-end|${req.user.id}`;
  loginLimiter.check(key);
  const user = q.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(password, user.password_hash)) {
    loginLimiter.fail(key);
    throw new HttpError(400, '登录密码不正确');
  }
  loginLimiter.reset(key);
  const stamp = now().replace(/[-: ]/g, '').slice(0, 12);
  snapshotTo(path.join(backupDir, `laundry-before-semester-end-${stamp}.db`));
  res.json({ ok: true, count: semesterEnd() });
});

router.post('/', requireManager, (req, res) => {
  const data = validateCustomer(req.body);
  if (req.body.member_type === 'package') Object.assign(data, packageCode(data.code), { member_type: 'package' });
  res.status(201).json(createCustomer(data));
});

// 设为 / 取消包期会员
router.post('/:id/membership', requireManager, (req, res) => {
  res.json(setMembership(Number(req.params.id), req.body.type));
});

// 包期会员某一周（date 所在的周，默认本周）的额度使用情况（客户详情页显示）
router.get('/:id/package-usage', requireManager, (req, res) => {
  const c = q.get('SELECT id, member_type FROM customers WHERE id = ?', Number(req.params.id));
  if (!c) throw new HttpError(404, '客户不存在');
  const week = weekOf(isDate(req.query.date) ? req.query.date : today());
  const limits = packageLimits();
  const { usage } = weekUsage(week, limits)(c.id);
  res.json({
    member: c.member_type === 'package',
    week,
    items: limits.map((l, i) => ({ ...l, used: usage[i].used })),
  });
});

router.put('/:id', requireManager, (req, res) => {
  const id = Number(req.params.id);
  const current = q.get('SELECT * FROM customers WHERE id = ?', id);
  if (!current) throw new HttpError(404, '客户不存在');
  const data = validateCustomer({ ...current, ...req.body });
  // 包期会员：可以填原来的 4 位编码或 88 开头的 6 位编码，统一保存为 88 + 4 位
  const { code, base_code: baseCode } =
    current.member_type === 'package' ? packageCode(req.body.code ?? current.code) : { code: data.code, base_code: null };
  q.run(
    'UPDATE customers SET name = ?, code = ?, base_code = ?, phone = ?, note = ?, updated_at = ? WHERE id = ?',
    data.name,
    code,
    baseCode,
    data.phone,
    data.note,
    now(),
    id,
  );
  res.json(q.get('SELECT * FROM customers WHERE id = ?', id));
});

router.delete('/:id', requireManager, (req, res) => {
  const id = Number(req.params.id);
  const { n } = q.get('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', id);
  if (n > 0) throw new HttpError(400, '该客户已有订单记录，不能删除');
  const r = q.run('DELETE FROM customers WHERE id = ?', id);
  if (!r.changes) throw new HttpError(404, '客户不存在');
  res.json({ ok: true });
});

export default router;
