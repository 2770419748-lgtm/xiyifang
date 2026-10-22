export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// 客户编码：4 位或 6 位数字
export const CODE_RE = /^(\d{4}|\d{6})$/;

export function text(value, { label, max = 100, required = false } = {}) {
  const s = value == null ? '' : String(value).trim();
  if (required && !s) throw new HttpError(400, `请填写${label}`);
  if (s.length > max) throw new HttpError(400, `${label}不能超过 ${max} 个字`);
  return s;
}

export function int(value, { label, min = -Infinity, max = Infinity, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `请填写${label}`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label}不正确`);
  return n;
}

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

// 金额统一用“分”的整数传输和存储
export function fen(value, label = '金额') {
  return int(value, { label, min: 0, max: 100000000, fallback: 0 });
}

export const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export function pageParams(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.page_size, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
