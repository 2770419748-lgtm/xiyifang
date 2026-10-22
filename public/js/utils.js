const { reactive } = Vue;

export const CODE_RE = /^(\d{4}|\d{6})$/;

// 屏幕尺寸：< 900px 视为手机布局
const mq = window.matchMedia('(max-width: 899px)');
export const screen = reactive({ mobile: mq.matches });
mq.addEventListener('change', (e) => {
  screen.mobile = e.matches;
});

export const STATUS = {
  pending: { text: '待取', cls: 'warn' },
  picked: { text: '已取', cls: 'good' },
  cancelled: { text: '已作废', cls: '' },
};

// ---------- 金额（后端以“分”存储） ----------
export function fenToYuan(fen) {
  const y = (fen || 0) / 100;
  return Number.isInteger(y) ? String(y) : y.toFixed(2);
}

export function money(fen) {
  const y = (fen || 0) / 100;
  const digits = Number.isInteger(y) ? 0 : 2;
  return `¥${y.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

// 空字符串返回 null；格式错误返回 NaN
export function yuanToFen(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

// ---------- 时间（后端格式 'YYYY-MM-DD HH:mm:ss'，店铺本地时间） ----------
const pad = (n) => String(n).padStart(2, '0');

export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const localInputNow = (d = new Date()) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const toInput = (dt) => (dt ? dt.slice(0, 16).replace(' ', 'T') : '');

// 今年的显示为 MM-DD HH:mm，否则带年份
export function fmtTime(dt) {
  if (!dt) return '';
  const sameYear = dt.slice(0, 4) === String(new Date().getFullYear());
  return sameYear ? dt.slice(5, 16) : dt.slice(0, 16);
}

export const fmtDateTime = (dt) => (dt ? dt.slice(0, 16) : '');

// 按自然日计算：今天送来为 0，昨天送来为 1
export function daysSince(dt) {
  const start = new Date(`${dt.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - start) / 86400000));
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export const DATE_PRESETS = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'last30', label: '近30天' },
  { key: 'lastMonth', label: '上月' },
];

export function presetRange(key) {
  const today = localDate();
  const d = new Date();
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'week': {
      const offset = (d.getDay() + 6) % 7; // 周一为一周开始
      return { from: addDays(today, -offset), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'lastMonth': {
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const last = new Date(d.getFullYear(), d.getMonth(), 0);
      return { from: localDate(first), to: localDate(last) };
    }
    default:
      return { from: '', to: '' };
  }
}

export function matchPreset(from, to) {
  return DATE_PRESETS.find((p) => {
    const r = presetRange(p.key);
    return r.from === from && r.to === to;
  })?.key;
}

// ---------- 其他 ----------
export const itemsText = (items, sep = ' ') => (items || []).map((i) => `${i.category_name}×${i.quantity}`).join(sep);

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function ageTag(receivedAt, overdueDays) {
  const days = daysSince(receivedAt);
  if (days === 0) return { text: '今天送来', cls: 'info' };
  return { text: `已放 ${days} 天`, cls: days >= overdueDays ? 'danger' : 'warn' };
}

export const firstChar = (name) => Array.from(name || '?')[0];
