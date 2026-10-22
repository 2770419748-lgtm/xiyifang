// 打印站：手机等设备开单后把打印任务发到服务器，
// 连着打印机的电脑开启“打印站”后，用长轮询领取任务并打印（后台标签页也能及时出纸）。
// 流程：领取（任务进入“打印中”）→ 打印 → 确认完成；领取后一段时间没确认的任务会重新排队，保证不丢标签。
// 同一时间只允许一台设备作为打印站，换设备需要明确“接管”，避免任务被别的设备领走。
import { Router } from 'express';
import { requireLogin, requireManager } from '../auth.js';
import { config } from '../config.js';
import { q, tx } from '../db.js';
import { getOrder } from '../services/orders.js';
import { getSettings } from '../settings.js';
import { now, shiftMinutes } from '../time.js';
import { HttpError, int, text } from '../util.js';

const router = Router();

const WAIT_MS = 25000;
const ACTIVE_TTL = 30000;
const waiters = new Set();
let active = null; // 当前打印站 { id, name, seen }

const isActive = () => active && (Date.now() - active.seen < ACTIVE_TTL || [...waiters].some((w) => w.stationId === active.id));

export const stationOnline = () => !!active && (waiters.size > 0 || Date.now() - active.seen < 15000);

// 只处理 24 小时内的任务，避免打印站长时间离线后一次性打出大量旧标签
const recentSince = () => shiftMinutes(now(), -24 * 60);

function claimNext(stationId) {
  return tx(() => {
    // 领取后超时未确认的任务重新排队
    q.run(`UPDATE print_jobs SET status = 'pending' WHERE status = 'printing' AND claimed_at < ?`, Date.now() - config.printLeaseMs);
    for (;;) {
      const j = q.get(
        `SELECT p.id, p.order_id, p.kind, p.piece, o.status AS order_status
         FROM print_jobs p JOIN orders o ON o.id = p.order_id
         WHERE p.status = 'pending' AND p.created_at >= ? ORDER BY p.id LIMIT 1`,
        recentSince(),
      );
      if (!j) return null;
      if (j.order_status === 'cancelled') {
        q.run(`UPDATE print_jobs SET status = 'skipped' WHERE id = ?`, j.id);
        continue;
      }
      q.run(`UPDATE print_jobs SET status = 'printing', claimed_at = ?, station = ? WHERE id = ?`, Date.now(), stationId, j.id);
      return j;
    }
  });
}

// 只返回打印标签需要的字段，并带上最新的打印设置
function payload(job) {
  if (!job) return { job: null };
  const o = getOrder(job.order_id);
  return {
    job: { id: job.id, kind: job.kind, piece: job.piece },
    order: {
      id: o.id,
      order_no: o.order_no,
      customer_name: o.customer_name,
      customer_code: o.customer_code,
      total_qty: o.total_qty,
      amount: o.amount,
      note: o.note,
      received_at: o.received_at,
      items: o.items.map((i) => ({ category_name: i.category_name, quantity: i.quantity, unit_price: i.unit_price })),
    },
    settings: getSettings(),
  };
}

function finish(waiter, job, extra = {}) {
  if (waiter.done) return;
  waiter.done = true;
  clearTimeout(waiter.timer);
  waiters.delete(waiter);
  if (active?.id === waiter.stationId) active.seen = Date.now();
  waiter.res.json({ ...payload(job), ...extra });
}

export function addPrintJob(orderId, userId, kind = 'all', piece = null) {
  q.run(
    'INSERT INTO print_jobs (order_id, created_by, created_at, kind, piece) VALUES (?, ?, ?, ?, ?)',
    orderId,
    userId,
    now(),
    kind,
    piece,
  );
}

// 有新任务时唤醒正在等待的打印站
export function notifyStations() {
  for (const w of [...waiters]) {
    const job = claimNext(w.stationId);
    if (!job) break;
    finish(w, job);
  }
}

// 发送打印任务：kind = all 全部（每件一张）/ piece 单张（piece 为第几件，从 1 开始）/ order 整单一张
router.post('/', requireLogin, (req, res) => {
  const orderId = int(req.body.order_id, { label: '订单', min: 1 });
  const o = q.get('SELECT status, total_qty FROM orders WHERE id = ?', orderId);
  if (!o) throw new HttpError(404, '订单不存在');
  if (o.status === 'cancelled') throw new HttpError(400, '已作废的订单不能打印');
  if (o.status !== 'pending' && req.user.role !== 'manager') throw new HttpError(403, '店员只能打印待取订单的标签');
  const kind = req.body.kind ?? 'all';
  if (!['all', 'piece', 'order'].includes(kind)) throw new HttpError(400, '打印内容不正确');
  const piece = kind === 'piece' ? int(req.body.piece, { label: '标签序号', min: 1, max: o.total_qty }) : null;
  addPrintJob(orderId, req.user.id, kind, piece);
  const online = stationOnline();
  notifyStations();
  res.status(201).json({ ok: true, station_online: online });
});

router.get('/status', requireLogin, (req, res) => {
  const { n } = q.get(
    `SELECT COUNT(*) AS n FROM print_jobs WHERE status IN ('pending', 'printing') AND created_at >= ?`,
    recentSince(),
  );
  res.json({ station_online: stationOnline(), station_name: isActive() ? active.name : null, pending: n });
});

/**
 * 打印站领取任务
 * body: { station_id, station_name, takeover }；wait=1 时没有任务就等待（最长 25 秒）
 * 已有其他设备在作为打印站时返回 409，传 takeover=true 才会接管
 */
router.post('/claim', requireLogin, (req, res) => {
  const stationId = text(req.body.station_id, { label: '打印站标识', max: 64, required: true });
  const stationName = text(req.body.station_name, { label: '打印站名称', max: 60 }) || '未命名设备';
  if (isActive() && active.id !== stationId) {
    if (req.body.takeover !== true) {
      throw new HttpError(409, `已有设备在作为打印站：${active.name}`, { station: active.name });
    }
    // 接管：通知原来的打印站停止
    for (const w of [...waiters]) if (w.stationId === active.id) finish(w, null, { replaced: true, by: stationName });
  }
  active = { id: stationId, name: stationName, seen: Date.now() };

  const job = claimNext(stationId);
  if (job || req.query.wait !== '1') return res.json(payload(job));
  const waiter = { res, stationId, done: false };
  waiter.timer = setTimeout(() => finish(waiter, null), WAIT_MS);
  waiters.add(waiter);
  // 打印站断开（关闭页面等）时移除
  res.on('close', () => {
    if (waiter.done) return;
    waiter.done = true;
    clearTimeout(waiter.timer);
    waiters.delete(waiter);
  });
});

// 打印站确认已打印
router.post('/:id/done', requireLogin, (req, res) => {
  q.run(`UPDATE print_jobs SET status = 'done', printed_at = ? WHERE id = ? AND status = 'printing'`, now(), Number(req.params.id));
  res.json({ ok: true });
});

// 清空待打印队列（店长）
router.post('/clear', requireManager, (req, res) => {
  const r = q.run(`UPDATE print_jobs SET status = 'skipped' WHERE status IN ('pending', 'printing')`);
  res.json({ ok: true, count: r.changes });
});

export default router;
