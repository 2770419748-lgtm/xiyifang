import { Router } from 'express';
import { hashPassword, requireManager, validatePassword } from '../auth.js';
import { q, tx } from '../db.js';
import { now } from '../time.js';
import { HttpError, bool, text } from '../util.js';
import { validateUsername } from './auth.js';

const router = Router();
router.use(requireManager);

const FIELDS = 'id, username, display_name, role, active, created_at, last_login_at';

function validateRole(value) {
  if (!['manager', 'clerk'].includes(value)) throw new HttpError(400, '角色不正确');
  return value;
}

router.get('/', (req, res) => {
  res.json(q.all(`SELECT ${FIELDS} FROM users ORDER BY active DESC, role DESC, id`));
});

router.post('/', (req, res) => {
  const username = validateUsername(req.body.username);
  const password = validatePassword(req.body.password);
  const displayName = text(req.body.display_name, { label: '姓名', max: 20, required: true });
  const role = validateRole(req.body.role || 'clerk');
  if (q.get('SELECT id FROM users WHERE username = ?', username)) throw new HttpError(409, '用户名已存在');
  const id = q.run(
    'INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)',
    username,
    hashPassword(password),
    displayName,
    role,
    now(),
  ).lastInsertRowid;
  res.status(201).json(q.get(`SELECT ${FIELDS} FROM users WHERE id = ?`, id));
});

// 修改姓名/角色/启用状态，或重置密码
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, '账号不存在');
  const body = req.body;
  const displayName =
    body.display_name !== undefined ? text(body.display_name, { label: '姓名', max: 20, required: true }) : u.display_name;
  const role = body.role !== undefined ? validateRole(body.role) : u.role;
  const active = body.active !== undefined ? (bool(body.active) ? 1 : 0) : u.active;
  const password = body.password !== undefined && body.password !== null ? validatePassword(body.password) : null;
  const self = id === req.user.id;
  if (self && (role !== 'manager' || !active)) throw new HttpError(400, '不能停用自己或取消自己的店长权限');

  tx(() => {
    q.run('UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?', displayName, role, active, id);
    if (password) q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), id);
    // 重置密码、停用、调整角色后，该账号需要重新登录
    if (password || !active || role !== u.role) {
      q.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', id, self ? req.tokenHash : '');
    }
    const { n } = q.get(`SELECT COUNT(*) AS n FROM users WHERE role = 'manager' AND active = 1`);
    if (n === 0) throw new HttpError(400, '至少需要保留一个启用的店长账号');
  });
  res.json(q.get(`SELECT ${FIELDS} FROM users WHERE id = ?`, id));
});

export default router;
