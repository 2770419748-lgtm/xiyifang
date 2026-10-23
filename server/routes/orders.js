import { Router } from 'express';
import { requireLogin, requireManager } from '../auth.js';
import { q, tx } from '../db.js';
import { resolveCustomer } from '../services/customers.js';
import { packageAmount } from '../services/members.js';
import {
  ORDER_SELECT,
  STATUS_TEXT,
  attachItems,
  buildOrderFilter,
  getOrder,
  insertItems,
  nextOrderNo,
  normalizeItems,
  parseTime,
} from '../services/orders.js';
import { getSettings } from '../settings.js';
import { addPrintJob, notifyStations, stationOnline } from './print.js';
import { now } from '../time.js';
import { HttpError, fen, likeEscape, pageParams, text } from '../util.js';

const router = Router();

const sumQty = (items) => items.reduce((s, i) => s + i.quantity, 0);
const sumAmount = (items) => items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
const hasValue = (v) => v !== undefined && v !== null && v !== '';

function findOrder(id) {
  const o = q.get('SELECT * FROM orders WHERE id = ?', Number(id));
  if (!o) throw new HttpError(404, '订单不存在');
  return o;
}

// ---------- 店员 + 店长 ----------

// 开单
router.post('/', requireLogin, (req, res) => {
  const body = req.body;
  const settings = getSettings();
  const items = normalizeItems(body.items, { enablePrice: settings.enable_price });
  const receivedAt = hasValue(body.received_at) ? parseTime(body.received_at, '送来时间') : now();
  const note = text(body.note, { label: '备注', max: 200 });

  const id = tx(() => {
    const customer = resolveCustomer(body);
    // 包期会员开单不提示超额（店长每周在“客户管理 → 包期会员”里查看），包期内的品类不收费
    let amount = 0;
    if (settings.enable_price) {
      if (hasValue(body.amount)) amount = fen(body.amount);
      else amount = customer.member_type === 'package' ? packageAmount(items) : sumAmount(items);
    }
    const t = now();
    const orderId = Number(
      q.run(
        `INSERT INTO orders (order_no, customer_id, total_qty, amount, note, received_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nextOrderNo(receivedAt),
        customer.id,
        sumQty(items),
        amount,
        note,
        receivedAt,
        req.user.id,
        t,
        t,
      ).lastInsertRowid,
    );
    insertItems(orderId, items);
    q.run('UPDATE customers SET updated_at = ? WHERE id = ?', t, customer.id);
    if (body.print === 'station') addPrintJob(orderId, req.user.id);
    return orderId;
  });
  const order = getOrder(id);
  if (body.print === 'station') {
    order.station_online = stationOnline();
    notifyStations();
  }
  res.status(201).json(order);
});

// 取货：搜索在店待取的订单
router.get('/pending', requireLogin, (req, res) => {
  const kw = String(req.query.q ?? '').trim().slice(0, 30);
  let where = `WHERE o.status = 'pending'`;
  const params = [];
  if (kw) {
    const like = `%${likeEscape(kw)}%`;
    where += ` AND (c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR o.order_no LIKE ? ESCAPE '\\')`;
    params.push(like, like, like);
  }
  const rows = q.all(
    `${ORDER_SELECT} ${where}
     ORDER BY (c.code = ?) DESC, (c.name = ?) DESC, o.received_at DESC, o.id DESC
     LIMIT 100`,
    ...params,
    kw,
    kw,
  );
  const { n } = q.get(`SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'`);
  res.json({ total_pending: n, items: attachItems(rows) });
});

// 取货：确认取件（可一次取多单）
router.post('/pickup', requireLogin, (req, res) => {
  const raw = Array.isArray(req.body.ids) ? req.body.ids : [];
  const ids = [...new Set(raw.map(Number))];
  if (!ids.length || ids.length > 200 || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new HttpError(400, '请选择要取件的订单');
  }
  const pickedAt = hasValue(req.body.picked_at) ? parseTime(req.body.picked_at, '取走时间') : now();
  tx(() => {
    for (const id of ids) {
      const o = findOrder(id);
      if (o.status !== 'pending') {
        throw new HttpError(409, `单号 ${o.order_no} ${o.status === 'picked' ? '已经取走' : '已作废'}，请刷新后重试`);
      }
      if (pickedAt < o.received_at) throw new HttpError(400, `取走时间不能早于送来时间（单号 ${o.order_no}）`);
      q.run(
        `UPDATE orders SET status = 'picked', picked_at = ?, picked_by = ?, updated_at = ? WHERE id = ?`,
        pickedAt,
        req.user.id,
        now(),
        id,
      );
    }
  });
  res.json({ ok: true, count: ids.length, picked_at: pickedAt });
});

// ---------- 订单查询：店员也可以查看；导出、修改、作废、恢复、撤销取件仅店长 ----------

router.get('/', requireLogin, (req, res) => {
  const { where, params, orderBy } = buildOrderFilter(req.query);
  const { page, pageSize, offset } = pageParams(req.query);
  // 合计（单数、件数、金额）不算作废单，除非筛选的就是作废单；total 为分页用的全部匹配数
  const counted = req.query.status === 'cancelled' ? '1' : `o.status != 'cancelled'`;
  const s = q.get(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN ${counted} THEN 1 ELSE 0 END), 0) AS orders,
       COALESCE(SUM(CASE WHEN ${counted} THEN o.total_qty END), 0) AS qty,
       COALESCE(SUM(CASE WHEN ${counted} THEN o.amount END), 0) AS amount
     FROM orders o JOIN customers c ON c.id = o.customer_id ${where}`,
    ...params,
  );
  // 按品类筛选时，另外统计该品类的件数
  let categoryQty = null;
  if (req.query.category_id) {
    categoryQty = q.get(
      `SELECT COALESCE(SUM(i.quantity), 0) AS n
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
       ${where ? `${where} AND` : 'WHERE'} ${counted} AND i.category_id = ?`,
      ...params,
      Number(req.query.category_id),
    ).n;
  }
  const rows = q.all(`${ORDER_SELECT} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({
    total: s.total,
    orders: s.orders,
    qty: s.qty,
    // 合计金额相当于这段时间的营业额，只给店长看（每单的金额店员照样能看到）
    amount: req.user.role === 'manager' ? s.amount : null,
    category_qty: categoryQty,
    page,
    page_size: pageSize,
    items: attachItems(rows),
  });
});

function csvCell(value) {
  let s = value == null ? '' : String(value);
  // 防止 Excel 把内容当公式执行
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// 保留编码/单号前导零，让 Excel 按文本显示
const csvText = (value) => `="${value}"`;

router.get('/export', requireManager, (req, res) => {
  const { enable_price: enablePrice } = getSettings();
  const { where, params, orderBy } = buildOrderFilter(req.query);
  const orders = attachItems(q.all(`${ORDER_SELECT} ${where} ORDER BY ${orderBy} LIMIT 20000`, ...params));
  const header = ['单号', '客户姓名', '编码', '物品明细', '件数'];
  if (enablePrice) header.push('金额(元)');
  header.push('状态', '送来时间', '取走时间', '开单人', '取件人', '备注');
  const lines = [header.map(csvCell).join(',')];
  for (const o of orders) {
    const cells = [
      csvText(o.order_no),
      csvCell(o.customer_name),
      csvText(o.customer_code),
      csvCell(o.items.map((i) => `${i.category_name}×${i.quantity}`).join(' ')),
      o.total_qty,
    ];
    if (enablePrice) cells.push((o.amount / 100).toFixed(2));
    cells.push(
      STATUS_TEXT[o.status],
      o.received_at,
      o.picked_at || '',
      csvCell(o.created_by_name || ''),
      csvCell(o.picked_by_name || ''),
      csvCell(o.note),
    );
    lines.push(cells.join(','));
  }
  res.attachment(`订单导出-${now().slice(0, 10)}.csv`);
  res.type('text/csv; charset=utf-8');
  res.send(`﻿${lines.join('\r\n')}`);
});

router.get('/:id', requireLogin, (req, res) => {
  const order = getOrder(Number(req.params.id));
  if (!order) throw new HttpError(404, '订单不存在');
  res.json(order);
});

// 修改订单：客户、物品、时间、金额、备注
router.put('/:id', requireManager, (req, res) => {
  const body = req.body;
  const settings = getSettings();
  const id = Number(req.params.id);
  tx(() => {
    const o = findOrder(id);
    const customer =
      hasValue(body.customer_id) || body.customer
        ? resolveCustomer(body)
        : q.get('SELECT * FROM customers WHERE id = ?', o.customer_id);

    const current = q.all('SELECT category_id, quantity, unit_price FROM order_items WHERE order_id = ?', id);
    let items = null; // 有变化时才重写明细
    if (body.items !== undefined) {
      const keepPrices = new Map(current.map((r) => [r.category_id, r.unit_price]));
      const next = normalizeItems(body.items, { enablePrice: settings.enable_price, keepPrices });
      const unchanged =
        next.length === current.length &&
        next.every((n) => current.some((c) => c.category_id === n.category_id && c.quantity === n.quantity));
      if (!unchanged) items = next;
    }
    const finalItems = items || current;

    const receivedAt = hasValue(body.received_at) ? parseTime(body.received_at, '送来时间') : o.received_at;
    let pickedAt = o.picked_at;
    if (o.status === 'picked' && hasValue(body.picked_at)) pickedAt = parseTime(body.picked_at, '取走时间');
    if (pickedAt && pickedAt < receivedAt) throw new HttpError(400, '取走时间不能早于送来时间');
    const note = body.note !== undefined ? text(body.note, { label: '备注', max: 200 }) : o.note;

    // 物品没变时保留原金额（可能是手动优惠过的价格）
    let amount = o.amount;
    if (settings.enable_price && items) {
      amount = customer.member_type === 'package' ? packageAmount(items) : sumAmount(items);
    }
    if (settings.enable_price && hasValue(body.amount)) amount = fen(body.amount);

    q.run(
      `UPDATE orders SET customer_id = ?, total_qty = ?, amount = ?, note = ?, received_at = ?, picked_at = ?, updated_at = ?
       WHERE id = ?`,
      customer.id,
      sumQty(finalItems),
      amount,
      note,
      receivedAt,
      pickedAt,
      now(),
      id,
    );
    if (items) {
      q.run('DELETE FROM order_items WHERE order_id = ?', id);
      insertItems(id, items);
    }
  });
  res.json(getOrder(id));
});

router.post('/:id/cancel', requireManager, (req, res) => {
  const o = findOrder(req.params.id);
  if (o.status === 'cancelled') throw new HttpError(409, '订单已经作废');
  const reason = text(req.body.reason, { label: '作废原因', max: 100 });
  q.run(
    `UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
    now(),
    req.user.id,
    reason,
    now(),
    o.id,
  );
  res.json(getOrder(o.id));
});

// 恢复作废的订单
router.post('/:id/restore', requireManager, (req, res) => {
  const o = findOrder(req.params.id);
  if (o.status !== 'cancelled') throw new HttpError(409, '订单未作废');
  q.run(
    `UPDATE orders SET status = ?, cancelled_at = NULL, cancelled_by = NULL, cancel_reason = '', updated_at = ? WHERE id = ?`,
    o.picked_at ? 'picked' : 'pending',
    now(),
    o.id,
  );
  res.json(getOrder(o.id));
});

// 撤销取件（取错了）
router.post('/:id/unpickup', requireManager, (req, res) => {
  const o = findOrder(req.params.id);
  if (o.status !== 'picked') throw new HttpError(409, '订单不是已取件状态');
  q.run(
    `UPDATE orders SET status = 'pending', picked_at = NULL, picked_by = NULL, updated_at = ? WHERE id = ?`,
    now(),
    o.id,
  );
  res.json(getOrder(o.id));
});

export default router;
