import { Router } from 'express';
import { requireLogin, requireManager } from '../auth.js';
import { q, tx } from '../db.js';
import { now } from '../time.js';
import { HttpError, bool, fen, text } from '../util.js';

const router = Router();

router.get('/', requireLogin, (req, res) => {
  if (req.query.all === '1' && req.user.role === 'manager') {
    return res.json(
      q.all(
        `SELECT c.*, (SELECT COUNT(*) FROM order_items i WHERE i.category_id = c.id) AS used
         FROM categories c ORDER BY c.sort_order, c.id`,
      ),
    );
  }
  res.json(q.all('SELECT id, name, price, sort_order FROM categories WHERE active = 1 ORDER BY sort_order, id'));
});

function assertNameAvailable(name, exceptId = 0) {
  const dup = q.get('SELECT id FROM categories WHERE name = ? AND id != ?', name, exceptId);
  if (dup) throw new HttpError(409, `品类「${name}」已存在`);
}

router.post('/', requireManager, (req, res) => {
  const name = text(req.body.name, { label: '品类名称', max: 10, required: true });
  assertNameAvailable(name);
  const { m } = q.get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories');
  const id = q.run(
    'INSERT INTO categories (name, sort_order, price, created_at) VALUES (?, ?, ?, ?)',
    name,
    m + 1,
    fen(req.body.price, '单价'),
    now(),
  ).lastInsertRowid;
  res.status(201).json(q.get('SELECT * FROM categories WHERE id = ?', id));
});

router.put('/:id', requireManager, (req, res) => {
  const id = Number(req.params.id);
  const current = q.get('SELECT * FROM categories WHERE id = ?', id);
  if (!current) throw new HttpError(404, '品类不存在');
  const name =
    req.body.name !== undefined ? text(req.body.name, { label: '品类名称', max: 10, required: true }) : current.name;
  if (name !== current.name) assertNameAvailable(name, id);
  const price = req.body.price !== undefined ? fen(req.body.price, '单价') : current.price;
  const active = req.body.active !== undefined ? (bool(req.body.active) ? 1 : 0) : current.active;
  q.run('UPDATE categories SET name = ?, price = ?, active = ? WHERE id = ?', name, price, active, id);
  res.json(q.get('SELECT * FROM categories WHERE id = ?', id));
});

// 调整顺序：传入按新顺序排列的全部品类 id
router.post('/reorder', requireManager, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length) throw new HttpError(400, '参数不正确');
  tx(() => {
    ids.forEach((id, i) => q.run('UPDATE categories SET sort_order = ? WHERE id = ?', i + 1, id));
  });
  res.json({ ok: true });
});

router.delete('/:id', requireManager, (req, res) => {
  const id = Number(req.params.id);
  const { n } = q.get('SELECT COUNT(*) AS n FROM order_items WHERE category_id = ?', id);
  if (n > 0) throw new HttpError(400, '该品类已有订单使用，不能删除，可以改为停用');
  const r = q.run('DELETE FROM categories WHERE id = ?', id);
  if (!r.changes) throw new HttpError(404, '品类不存在');
  res.json({ ok: true });
});

export default router;
