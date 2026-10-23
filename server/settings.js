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
  // 包期会员每周额度：[{ category_ids: [品类id…], limit: 数量 }]，同一项里的品类合并计算；
  // 未设置时默认衣物 + 浴巾合计 9 件、鞋子 1 双（见 defaultPackageQuotas）
  package_quotas: null,
  label: {
    width: 50, // 毫米
    height: 30, // 毫米；0 表示小票（高度随内容）
    padding: 1.5,
    copies: 1, // 全部打印、整单标签时每张打印几份
    font_scale: 1,
    // 标签样式：standard 标准（姓名、编码、件数、单号等）/ simple 简洁（只打编码和姓名，适合水洗唛布带）
    style: 'standard',
    // 每张末尾打一条裁切虚线（连续布带用，沿虚线剪开）
    cut_line: false,
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
      if (!(row.key in DEFAULT_SETTINGS)) continue; // 旧版本留下的设置项
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
    if (!cache.package_quotas) cache.package_quotas = defaultPackageQuotas();
  }
  return cache;
}

function defaultPackageQuotas() {
  const id = {};
  for (const c of q.all(`SELECT id, name FROM categories WHERE name IN ('衣物', '浴巾', '鞋子')`)) id[c.name] = c.id;
  return [
    { category_ids: [id['衣物'], id['浴巾']].filter(Boolean), limit: 9 },
    { category_ids: [id['鞋子']].filter(Boolean), limit: 1 },
  ].filter((g) => g.category_ids.length);
}

// 包期额度：每项至少选一个品类，同一个品类只能放在一项里，数量为 0~999 的整数
function validatePackageQuotas(input) {
  if (!Array.isArray(input) || input.length > 50) throw new HttpError(400, '包期额度设置不正确');
  const names = new Map(q.all('SELECT id, name FROM categories').map((c) => [c.id, c.name]));
  const used = new Set();
  return input.map((g, i) => {
    const ids = [...new Set((Array.isArray(g?.category_ids) ? g.category_ids : []).map(Number))].filter((id) => names.has(id));
    if (!ids.length) throw new HttpError(400, `第 ${i + 1} 项额度还没有选品类`);
    for (const id of ids) {
      if (used.has(id)) throw new HttpError(400, `「${names.get(id)}」不能同时放在两项额度里`);
      used.add(id);
    }
    return { category_ids: ids, limit: int(g.limit, { label: `第 ${i + 1} 项额度的数量`, min: 0, max: 999 }) };
  });
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
  if (input.style !== undefined) {
    if (!['standard', 'simple'].includes(input.style)) throw new HttpError(400, '标签样式不正确');
    label.style = input.style;
  }
  if (input.cut_line !== undefined) label.cut_line = bool(input.cut_line);
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
  if (patch.package_quotas !== undefined) next.package_quotas = validatePackageQuotas(patch.package_quotas);
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
