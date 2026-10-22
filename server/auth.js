import crypto from 'node:crypto';
import { config } from './config.js';
import { q } from './db.js';
import { now } from './time.js';
import { HttpError } from './util.js';

export const COOKIE_NAME = 'laundry_token';
const DAY = 86400000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(password) {
  const s = String(password ?? '');
  if (s.length < 6) throw new HttpError(400, '密码至少 6 位');
  if (s.length > 64) throw new HttpError(400, '密码不能超过 64 位');
  return s;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function setCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: config.sessionDays * DAY,
    path: '/',
  });
}

function readToken(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    sha256(token),
    userId,
    now(),
    Date.now() + config.sessionDays * DAY,
    String(req.get('user-agent') || '').slice(0, 200),
  );
  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), userId);
  setCookie(req, res, token);
}

export function endSession(req, res) {
  if (req.tokenHash) q.run('DELETE FROM sessions WHERE token_hash = ?', req.tokenHash);
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function publicUser(u) {
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role };
}

// 解析登录状态，所有 /api 请求都会经过
export function authenticate(req, res, next) {
  const token = readToken(req);
  if (token) {
    const row = q.get(
      `SELECT s.token_hash, s.expires_at, u.id, u.username, u.display_name, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
      sha256(token),
    );
    if (row && row.active && row.expires_at > Date.now()) {
      req.user = publicUser(row);
      req.tokenHash = row.token_hash;
      // 过半有效期后自动续期
      if (row.expires_at - Date.now() < (config.sessionDays / 2) * DAY) {
        q.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', Date.now() + config.sessionDays * DAY, row.token_hash);
        setCookie(req, res, token);
      }
    }
  }
  next();
}

export function requireLogin(req, res, next) {
  if (!req.user) throw new HttpError(401, '请先登录');
  next();
}

export function requireManager(req, res, next) {
  if (!req.user) throw new HttpError(401, '请先登录');
  if (req.user.role !== 'manager') throw new HttpError(403, '没有权限，请联系店长');
  next();
}

export function purgeExpiredSessions() {
  q.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}

// 登录失败次数限制：同一来源 + 用户名 10 分钟内失败 8 次，锁定 10 分钟
const failures = new Map();
const WINDOW = 10 * 60 * 1000;
const MAX_FAILURES = 8;

export const loginLimiter = {
  check(key) {
    const f = failures.get(key);
    if (f && f.lockedUntil > Date.now()) {
      const minutes = Math.ceil((f.lockedUntil - Date.now()) / 60000);
      throw new HttpError(429, `密码错误次数过多，请 ${minutes} 分钟后再试`);
    }
  },
  fail(key) {
    const t = Date.now();
    let f = failures.get(key);
    if (!f || t - f.first > WINDOW) f = { count: 0, first: t, lockedUntil: 0 };
    f.count++;
    if (f.count >= MAX_FAILURES) f.lockedUntil = t + WINDOW;
    failures.set(key, f);
    if (failures.size > 5000) failures.clear();
  },
  reset(key) {
    failures.delete(key);
  },
};
