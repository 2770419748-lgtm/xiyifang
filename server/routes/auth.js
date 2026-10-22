import { Router } from 'express';
import {
  endSession,
  hashPassword,
  loginLimiter,
  publicUser,
  requireLogin,
  startSession,
  validatePassword,
  verifyPassword,
} from '../auth.js';
import { q, tx } from '../db.js';
import { getSettings } from '../settings.js';
import { now } from '../time.js';
import { HttpError, text } from '../util.js';

const router = Router();

export function validateUsername(value) {
  const s = text(value, { label: '用户名', max: 32, required: true });
  if (s.length < 2 || /\s/.test(s)) throw new HttpError(400, '用户名至少 2 位，且不能包含空格');
  return s;
}

router.get('/status', (req, res) => {
  const { n } = q.get('SELECT COUNT(*) AS n FROM users');
  res.json({ need_setup: n === 0, user: req.user || null, shop_name: getSettings().shop_name });
});

// 首次使用：创建店长账号（仅在没有任何账号时可用）
router.post('/setup', (req, res) => {
  const username = validateUsername(req.body.username);
  const password = validatePassword(req.body.password);
  const displayName = text(req.body.display_name, { label: '姓名', max: 20 }) || '店长';
  const id = tx(() => {
    const { n } = q.get('SELECT COUNT(*) AS n FROM users');
    if (n > 0) throw new HttpError(400, '系统已初始化，请直接登录');
    return Number(
      q.run(
        `INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, 'manager', ?)`,
        username,
        hashPassword(password),
        displayName,
        now(),
      ).lastInsertRowid,
    );
  });
  startSession(req, res, id);
  res.json({ user: publicUser(q.get('SELECT * FROM users WHERE id = ?', id)) });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username ?? '').trim();
  const password = String(req.body.password ?? '');
  if (!username || !password) throw new HttpError(400, '请输入用户名和密码');
  const key = `${req.ip}|${username.toLowerCase()}`;
  loginLimiter.check(key);
  const user = q.get('SELECT * FROM users WHERE username = ?', username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    loginLimiter.fail(key);
    throw new HttpError(400, '用户名或密码错误');
  }
  if (!user.active) throw new HttpError(403, '该账号已停用，请联系店长');
  loginLimiter.reset(key);
  startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

router.post('/password', requireLogin, (req, res) => {
  const user = q.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(req.body.old_password ?? ''), user.password_hash)) {
    throw new HttpError(400, '原密码不正确');
  }
  const password = validatePassword(req.body.new_password);
  tx(() => {
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), user.id);
    // 其他设备上的登录全部失效
    q.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', user.id, req.tokenHash);
  });
  res.json({ ok: true });
});

export default router;
