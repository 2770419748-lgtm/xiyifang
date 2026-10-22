import { q, tx } from './db.js';
import { HttpError, bool, int, text } from './util.js';

export const DEFAULT_SETTINGS = {
  shop_name: '洗衣房',
  // 是否启用金额（品类单价、开单金额、营业额统计）
  enable_price: false,
  // 送来超过多少天未取算“超期”
  overdue_days: 7,
  // 开单成功后弹出打印选项（全部打印 / 打印单张）
  auto_print: true,
  // 包期会员每周额度 { 品类id: 数量 }，未设置时默认衣物 9 件、鞋子 1 双（见 defaultPackageLimits）
  package_limits: null,
  label: {
    width: 50, // 毫米
    height: 30, // 毫米；0 表示小票（高度随内容）
    padding: 1.5,
    copies: 1, // 全部打印、整单标签时每张打印几份
    font_scale: 1,
    show_shop: true,
    show_time: true,
    show_items: true,
    show_note: false,
    show_order_no: true,
  },
};

let cache = null;

export function getSettings() {
  if (!cache) {
    const stored = {};
    for (const row of q.all('SELECT key, value FROM settings')) {
      try {
        stored[row.key] = JSON.parse(row.value);
      } catch {
        // 忽略损坏的值，使用默认值
      }
    }
    cache = {
      ...DEFAULT_SETTINGS,
      ...stored,
      label: { ...DEFAULT_SETTINGS.label, ...(stored.label || {}) },
    };
    if (!cache.package_limits) cache.package_limits = defaultPackageLimits();
  }
  return cache;
}

function defaultPackageLimits() {
  const limits = {};
  for (const c of q.all(`SELECT id, name FROM categories WHERE name IN ('衣物', '鞋子')`)) {
    limits[c.id] = c.name === '衣物' ? 9 : 1;
  }
  return limits;
}

// 包期额度：只保留存在的品类，数量为 0~999 的整数；空值表示该品类不在包期内
function validatePackageLimits(input) {
  if (typeof input !== 'object' || input === null) throw new HttpError(400, '包期额度设置不正确');
  const ids = new Set(q.all('SELECT id FROM categories').map((c) => String(c.id)));
  const out = {};
  for (const [id, v] of Object.entries(input)) {
    if (!ids.has(String(id)) || v === null || v === '' || v === undefined) continue;
    out[id] = int(v, { label: '包期额度', min: 0, max: 999 });
  }
  return out;
}

function num(value, { label, min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label}应在 ${min}~${max} 之间`);
  return Math.round(n * 10) / 10;
}

function validateLabel(input, current) {
  const label = { ...current };
  if (input.width !== undefined) label.width = num(input.width, { label: '标签宽度', min: 20, max: 120 });
  if (input.height !== undefined) {
    label.height = Number(input.height) === 0 ? 0 : num(input.height, { label: '标签高度', min: 10, max: 200 });
  }
  if (input.padding !== undefined) label.padding = num(input.padding, { label: '边距', min: 0, max: 10 });
  if (input.font_scale !== undefined) label.font_scale = num(input.font_scale, { label: '字体缩放', min: 0.6, max: 2 });
  if (input.copies !== undefined) label.copies = int(input.copies, { label: '打印份数', min: 1, max: 10 });
  for (const key of ['show_shop', 'show_time', 'show_items', 'show_note', 'show_order_no']) {
    if (input[key] !== undefined) label[key] = bool(input[key]);
  }
  return label;
}

export function saveSettings(patch = {}) {
  const current = getSettings();
  const next = {};
  if (patch.shop_name !== undefined) next.shop_name = text(patch.shop_name, { label: '店铺名称', max: 30, required: true });
  if (patch.enable_price !== undefined) next.enable_price = bool(patch.enable_price);
  if (patch.auto_print !== undefined) next.auto_print = bool(patch.auto_print);
  if (patch.overdue_days !== undefined) next.overdue_days = int(patch.overdue_days, { label: '超期天数', min: 1, max: 365 });
  if (patch.package_limits !== undefined) next.package_limits = validatePackageLimits(patch.package_limits);
  if (patch.label !== undefined) {
    if (typeof patch.label !== 'object' || patch.label === null) throw new HttpError(400, '标签设置不正确');
    next.label = validateLabel(patch.label, current.label);
  }

  tx(() => {
    for (const [key, value] of Object.entries(next)) {
      q.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        JSON.stringify(value),
      );
    }
  });
  cache = null;
  return getSettings();
}
