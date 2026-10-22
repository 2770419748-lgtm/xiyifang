// 时间统一以店铺时区的 'YYYY-MM-DD HH:mm:ss' 字符串存储，可直接按字符串比较和截取日期
import { config } from './config.js';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function now(date = new Date()) {
  const p = {};
  for (const { type, value } of formatter.formatToParts(date)) p[type] = value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export const today = () => now().slice(0, 10);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// 对 'YYYY-MM-DD HH:mm:ss' 加减分钟
export function shiftMinutes(dt, minutes) {
  const d = new Date(`${dt.replace(' ', 'T')}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// 接受 'YYYY-MM-DDTHH:mm'、'YYYY-MM-DD HH:mm' 或带秒的格式，非法时返回 null
export function normalizeDateTime(input) {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const s = `${m[1]} ${m[2]}:${m[3]}:${m[4] || '00'}`;
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 19).replace('T', ' ') !== s) return null;
  return s;
}
