// 包期会员：每周额度与超额统计、设为/取消包期会员、学期结束一键清除
import { q, tx } from '../db.js';
import { getSettings } from '../settings.js';
import { addDays, now } from '../time.js';
import { HttpError } from '../util.js';

// 包期会员编码 = 88 + 原来的 4 位编码
export const PACKAGE_PREFIX = '88';

// 自然周：周一至周日；订单按送来时间归入所在的那一周
export function weekOf(dt) {
  const day = dt.slice(0, 10);
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // 周一 = 0
  const start = addDays(day, -dow);
  return { start, end: addDays(start, 6) };
}

export const unitOf = (name) => (name.includes('鞋') ? '双' : '件');

// 设置了额度的品类：[{ category_id, name, unit, limit }]；没设额度的品类不在包期内
export function packageLimits() {
  const limits = getSettings().package_limits || {};
  return q
    .all('SELECT id, name FROM categories ORDER BY sort_order, id')
    .filter((c) => Number.isInteger(limits[c.id]))
    .map((c) => ({ category_id: c.id, name: c.name, unit: unitOf(c.name), limit: limits[c.id] }));
}

/**
 * 包期会员在某一周（周一至周日，按送来时间）各品类已送的件数和超出额度的件数
 * 返回函数：客户id → { usage: [{ category_id, used, over }]（与 limits 顺序一致）, over: 超出的总件数 }
 */
export function weekUsage(week, limits = packageLimits()) {
  const sent = new Map(); // 客户id → Map(品类id → 件数)
  const rows = q.all(
    `SELECT o.customer_id, i.category_id, SUM(i.quantity) AS qty
     FROM order_items i
     JOIN orders o ON o.id = i.order_id
     JOIN customers c ON c.id = o.customer_id
     WHERE c.member_type = 'package' AND o.status != 'cancelled'
       AND o.received_at >= ? AND o.received_at < ?
     GROUP BY o.customer_id, i.category_id`,
    `${week.start} 00:00:00`,
    `${addDays(week.end, 1)} 00:00:00`,
  );
  for (const r of rows) {
    if (!sent.has(r.customer_id)) sent.set(r.customer_id, new Map());
    sent.get(r.customer_id).set(r.category_id, r.qty);
  }
  return (customerId) => {
    const usage = limits.map((l) => {
      const used = sent.get(customerId)?.get(l.category_id) || 0;
      return { category_id: l.category_id, used, over: Math.max(0, used - l.limit) };
    });
    return { usage, over: usage.reduce((s, u) => s + u.over, 0) };
  };
}

// 包期会员的金额：包期内的品类（设置了每周额度的）不收费，其他品类按单价计算。
// 开单时不提示超额，超额的由店长每周在“客户管理 → 包期会员”里查看
export function packageAmount(items) {
  const limited = new Set(packageLimits().map((l) => l.category_id));
  return items.reduce((sum, it) => (limited.has(it.category_id) ? sum : sum + it.quantity * it.unit_price), 0);
}

// 取消包期时恢复的编码：优先用记录的原编码，否则去掉开头的 88
const restoreCode = (c) =>
  c.base_code || (c.code.length === 6 && c.code.startsWith(PACKAGE_PREFIX) ? c.code.slice(2) : c.code);

export function setMembership(id, type) {
  const c = q.get('SELECT * FROM customers WHERE id = ?', id);
  if (!c) throw new HttpError(404, '客户不存在');
  const t = now();
  if (type === 'package') {
    if (c.member_type === 'package') throw new HttpError(400, '已经是包期会员');
    if (!/^\d{4}$/.test(c.code)) {
      throw new HttpError(400, `只有 4 位编码的客户可以设为包期会员（当前编码 ${c.code}），请先把编码改为 4 位`);
    }
    q.run(
      `UPDATE customers SET member_type = 'package', base_code = code, code = ?, member_since = ?, updated_at = ? WHERE id = ?`,
      PACKAGE_PREFIX + c.code,
      t,
      t,
      id,
    );
  } else if (type === 'regular') {
    if (c.member_type !== 'package') throw new HttpError(400, '不是包期会员');
    q.run(
      `UPDATE customers SET member_type = 'regular', code = ?, base_code = NULL, member_since = NULL, updated_at = ? WHERE id = ?`,
      restoreCode(c),
      t,
      id,
    );
  } else {
    throw new HttpError(400, '会员类型不正确');
  }
  return q.get('SELECT * FROM customers WHERE id = ?', id);
}

// 学期结束：所有包期会员降为普通会员，编码恢复为原来的 4 位数
export function semesterEnd() {
  const list = q.all(`SELECT * FROM customers WHERE member_type = 'package'`);
  const t = now();
  tx(() => {
    for (const c of list) {
      q.run(
        `UPDATE customers SET member_type = 'regular', code = ?, base_code = NULL, member_since = NULL, updated_at = ? WHERE id = ?`,
        restoreCode(c),
        t,
        c.id,
      );
    }
  });
  return list.length;
}

/**
 * 新建/修改包期会员时的编码：可以填原来的 4 位编码，或 88 开头的 6 位编码
 * 返回 { code, base_code }
 */
export function packageCode(input) {
  const s = String(input ?? '').trim();
  if (/^\d{4}$/.test(s)) return { code: PACKAGE_PREFIX + s, base_code: s };
  if (/^\d{6}$/.test(s) && s.startsWith(PACKAGE_PREFIX)) return { code: s, base_code: s.slice(2) };
  throw new HttpError(400, '包期会员请填写原来的 4 位编码（系统会自动在前面加 88）');
}
