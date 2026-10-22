import { q } from '../db.js';
import { getSettings } from '../settings.js';
import { addDays, isDate, normalizeDateTime, now, shiftMinutes, today } from '../time.js';
import { HttpError, likeEscape } from '../util.js';

export const ORDER_SELECT = `
  SELECT o.id, o.order_no, o.customer_id, c.name AS customer_name, c.code AS customer_code,
         c.member_type AS customer_member_type, c.base_code AS customer_base_code,
         o.status, o.total_qty, o.amount, o.note, o.received_at, o.picked_at,
         o.cancelled_at, o.cancel_reason, o.created_at,
         cu.display_name AS created_by_name,
         pu.display_name AS picked_by_name,
         xu.display_name AS cancelled_by_name
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN users cu ON cu.id = o.created_by
  LEFT JOIN users pu ON pu.id = o.picked_by
  LEFT JOIN users xu ON xu.id = o.cancelled_by`;

export const STATUS_TEXT = { pending: '待取', picked: '已取', cancelled: '已作废' };

// 批量查询订单明细并挂到订单上
export function attachItems(orders) {
  if (!orders.length) return [];
  const rows = q.all(
    `SELECT i.order_id, i.category_id, cat.name AS category_name, i.quantity, i.unit_price
     FROM order_items i JOIN categories cat ON cat.id = i.category_id
     WHERE i.order_id IN (SELECT value FROM json_each(?))
     ORDER BY cat.sort_order, cat.id`,
    JSON.stringify(orders.map((o) => o.id)),
  );
  const map = new Map(orders.map((o) => [o.id, []]));
  for (const { order_id: orderId, ...item } of rows) map.get(orderId).push(item);
  return orders.map((o) => ({ ...o, items: map.get(o.id) }));
}

export function getOrder(id) {
  const row = q.get(`${ORDER_SELECT} WHERE o.id = ?`, id);
  return row ? attachItems([row])[0] : null;
}

// 送来满 N 天（按自然日）仍未取的订单算“超期”：早于这个时间送来的
export function overdueBefore(settings = getSettings()) {
  return `${addDays(today(), -(settings.overdue_days - 1))} 00:00:00`;
}

// 用户填写的时间：格式校验 + 不能晚于当前时间
export function parseTime(value, label) {
  const t = normalizeDateTime(value);
  if (!t) throw new HttpError(400, `${label}格式不正确`);
  if (t > shiftMinutes(now(), 10)) throw new HttpError(400, `${label}不能晚于当前时间`);
  return t;
}

/**
 * 校验并合并物品明细
 * keepPrices：改单时保留原有品类的成交单价
 */
export function normalizeItems(input, { enablePrice, keepPrices = new Map() }) {
  if (!Array.isArray(input) || !input.length) throw new HttpError(400, '请至少选择一件物品');
  const categories = new Map(q.all('SELECT id, name, price FROM categories').map((c) => [c.id, c]));
  const merged = new Map();
  for (const it of input) {
    const cat = categories.get(Number(it?.category_id));
    if (!cat) throw new HttpError(400, '品类不存在，请刷新页面后重试');
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new HttpError(400, `「${cat.name}」的数量不正确`);
    const existing = merged.get(cat.id);
    if (existing) {
      existing.quantity += qty;
      continue;
    }
    const unitPrice = keepPrices.has(cat.id) ? keepPrices.get(cat.id) : enablePrice ? cat.price : 0;
    merged.set(cat.id, { category_id: cat.id, quantity: qty, unit_price: unitPrice });
  }
  const items = [...merged.values()];
  if (items.some((i) => i.quantity > 999)) throw new HttpError(400, '单个品类数量不能超过 999');
  return items;
}

export function insertItems(orderId, items) {
  for (const it of items) {
    q.run(
      'INSERT INTO order_items (order_id, category_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
      orderId,
      it.category_id,
      it.quantity,
      it.unit_price,
    );
  }
}

// 单号：送来日期-当日流水号，如 261022-007（补录昨天的单，单号也是昨天的日期）
export function nextOrderNo(receivedAt = now()) {
  const prefix = receivedAt.slice(2, 10).replaceAll('-', '');
  const { n } = q.get(
    'SELECT COALESCE(MAX(CAST(substr(order_no, 8) AS INTEGER)), 0) AS n FROM orders WHERE order_no LIKE ?',
    `${prefix}-%`,
  );
  return `${prefix}-${String(n + 1).padStart(3, '0')}`;
}

/**
 * 订单查询条件
 * q: 姓名/编码/单号模糊匹配；status；customer_id；category_id；
 * date_field: received(送来) | picked(取走)；from/to: YYYY-MM-DD；overdue=1 超期未取
 */
export function buildOrderFilter(query) {
  const where = [];
  const params = [];
  const kw = String(query.q ?? '').trim().slice(0, 30);
  if (kw) {
    const like = `%${likeEscape(kw)}%`;
    where.push(`(c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR o.order_no LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  if (['pending', 'picked', 'cancelled'].includes(query.status)) {
    where.push('o.status = ?');
    params.push(query.status);
  }
  if (query.customer_id) {
    where.push('o.customer_id = ?');
    params.push(Number(query.customer_id));
  }
  if (query.category_id) {
    where.push('EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.category_id = ?)');
    params.push(Number(query.category_id));
  }
  const field = query.date_field === 'picked' ? 'o.picked_at' : 'o.received_at';
  if (isDate(query.from)) {
    where.push(`${field} >= ?`);
    params.push(`${query.from} 00:00:00`);
  }
  if (isDate(query.to)) {
    where.push(`${field} < ?`);
    params.push(`${addDays(query.to, 1)} 00:00:00`);
  }
  if (query.overdue === '1') {
    where.push(`o.status = 'pending' AND o.received_at < ?`);
    params.push(overdueBefore());
  }
  return {
    where: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    orderBy: `${field} DESC, o.id DESC`,
  };
}
