import { Router } from 'express';
import { requireManager } from '../auth.js';
import { q } from '../db.js';
import { overdueBefore } from '../services/orders.js';
import { addDays, diffDays, isDate, today } from '../time.js';
import { HttpError } from '../util.js';

const router = Router();

const NOT_CANCELLED = `status != 'cancelled'`;

function receivedIn(start, end) {
  return q.get(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total_qty), 0) AS qty, COALESCE(SUM(amount), 0) AS amount,
            COUNT(DISTINCT customer_id) AS customers
     FROM orders WHERE ${NOT_CANCELLED} AND received_at >= ? AND received_at < ?`,
    start,
    end,
  );
}

function pickedIn(start, end) {
  return q.get(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total_qty), 0) AS qty
     FROM orders WHERE status = 'picked' AND picked_at >= ? AND picked_at < ?`,
    start,
    end,
  );
}

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const end = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= end) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// 经营数据：from/to 为 YYYY-MM-DD，默认今天
router.get('/', requireManager, (req, res) => {
  let from = isDate(req.query.from) ? req.query.from : today();
  let to = isDate(req.query.to) ? req.query.to : today();
  if (from > to) [from, to] = [to, from];
  const days = diffDays(from, to) + 1;
  if (days > 366 * 3) throw new HttpError(400, '统计区间不能超过 3 年');

  const start = `${from} 00:00:00`;
  const end = `${addDays(to, 1)} 00:00:00`;
  // 上一个同等长度的区间，用于环比
  const prevStart = `${addDays(from, -days)} 00:00:00`;

  const summary = {
    received: receivedIn(start, end),
    picked: pickedIn(start, end),
    new_customers: q.get('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?', start, end).n,
    prev: { received: receivedIn(prevStart, start), picked: pickedIn(prevStart, start) },
    // 以下两项是当前实时数据，与所选区间无关
    pending: q.get(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total_qty), 0) AS qty FROM orders WHERE status = 'pending'`,
    ),
    overdue: q.get(`SELECT COUNT(*) AS n FROM orders WHERE status = 'pending' AND received_at < ?`, overdueBefore()).n,
  };

  // 趋势：区间超过 92 天按月汇总，否则按天
  const byMonth = days > 92;
  const len = byMonth ? 7 : 10;
  const received = new Map(
    q
      .all(
        `SELECT substr(received_at, 1, ${len}) AS k, COUNT(*) AS orders, SUM(total_qty) AS qty, SUM(amount) AS amount
         FROM orders WHERE ${NOT_CANCELLED} AND received_at >= ? AND received_at < ? GROUP BY k`,
        start,
        end,
      )
      .map((r) => [r.k, r]),
  );
  const picked = new Map(
    q
      .all(
        `SELECT substr(picked_at, 1, ${len}) AS k, COUNT(*) AS orders
         FROM orders WHERE status = 'picked' AND picked_at >= ? AND picked_at < ? GROUP BY k`,
        start,
        end,
      )
      .map((r) => [r.k, r]),
  );
  const keys = byMonth ? monthsBetween(from, to) : Array.from({ length: days }, (_, i) => addDays(from, i));
  const trend = keys.map((k) => ({
    key: k,
    received_orders: received.get(k)?.orders || 0,
    received_qty: received.get(k)?.qty || 0,
    amount: received.get(k)?.amount || 0,
    picked_orders: picked.get(k)?.orders || 0,
  }));

  const categories = q.all(
    `SELECT cat.id, cat.name, SUM(i.quantity) AS qty, COUNT(DISTINCT i.order_id) AS orders,
            SUM(i.quantity * i.unit_price) AS amount
     FROM order_items i
     JOIN orders o ON o.id = i.order_id
     JOIN categories cat ON cat.id = i.category_id
     WHERE o.${NOT_CANCELLED} AND o.received_at >= ? AND o.received_at < ?
     GROUP BY cat.id ORDER BY qty DESC, cat.sort_order`,
    start,
    end,
  );

  const staff = q
    .all(
      `SELECT u.id, u.display_name, u.role, u.active,
         (SELECT COUNT(*) FROM orders o WHERE o.created_by = u.id AND o.${NOT_CANCELLED}
            AND o.received_at >= ? AND o.received_at < ?) AS created_orders,
         (SELECT COALESCE(SUM(o.total_qty), 0) FROM orders o WHERE o.created_by = u.id AND o.${NOT_CANCELLED}
            AND o.received_at >= ? AND o.received_at < ?) AS created_qty,
         (SELECT COUNT(*) FROM orders o WHERE o.picked_by = u.id AND o.status = 'picked'
            AND o.picked_at >= ? AND o.picked_at < ?) AS picked_orders
       FROM users u
       ORDER BY created_orders DESC, picked_orders DESC, u.id`,
      start,
      end,
      start,
      end,
      start,
      end,
    )
    .filter((u) => u.active || u.created_orders || u.picked_orders);

  const hourRows = new Map(
    q
      .all(
        `SELECT CAST(substr(received_at, 12, 2) AS INTEGER) AS h, COUNT(*) AS orders
         FROM orders WHERE ${NOT_CANCELLED} AND received_at >= ? AND received_at < ? GROUP BY h`,
        start,
        end,
      )
      .map((r) => [r.h, r.orders]),
  );
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: hourRows.get(h) || 0 }));

  res.json({ from, to, days, granularity: byMonth ? 'month' : 'day', summary, trend, categories, staff, hours });
});

export default router;
