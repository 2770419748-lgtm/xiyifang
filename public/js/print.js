// 标签/小票打印：生成打印内容 → 按设置的纸张尺寸调用浏览器打印
// 打印机只要在电脑上装好驱动即可；Chrome 加 --kiosk-printing 启动可不弹对话框直接出纸
import { api } from './api.js';
import { store } from './store.js';
import { confirm, toast } from './ui.js';
import { itemsText, money } from './utils.js';

const METHOD_KEY = 'laundry.printMethod';

export const PRINT_METHODS = [
  { value: 'local', label: '本机直接打印', desc: '这台设备连着打印机（电脑装好了打印机驱动）' },
  { value: 'station', label: '发送到打印站', desc: '由连着打印机的电脑自动打印，适合手机开单' },
  { value: 'none', label: '开单后不弹出打印', desc: '需要时点“打印”按钮手动打印（按本机打印）' },
];

export function getPrintMethod() {
  try {
    const v = localStorage.getItem(METHOD_KEY);
    if (PRINT_METHODS.some((m) => m.value === v)) return v;
  } catch {
    // 无痕模式等情况下 localStorage 不可用
  }
  return window.matchMedia('(pointer: coarse)').matches ? 'station' : 'local';
}

export function setPrintMethod(value) {
  try {
    localStorage.setItem(METHOD_KEY, value);
  } catch {
    // 忽略
  }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 字号随纸张大小缩放（以 50×30mm 标签 / 58mm 小票为基准）
function scaleOf(L) {
  const base = L.height ? Math.min(L.width / 50, L.height / 30) : L.width / 58;
  return Math.round(base * L.font_scale * 100) / 100;
}

function box(L, inner, extraClass = '') {
  // 高度略小于纸张，避免四舍五入误差导致多出空白页；小票纸（高度 0）高度随内容
  const h = L.height ? `height:${L.height - 0.3}mm;` : '';
  const cls = `${extraClass}${L.height ? '' : ' auto'}`;
  return `<div class="label${cls}" style="width:${L.width}mm;${h}padding:${L.padding}mm;--s:${scaleOf(L)}">${inner}</div>`;
}

// 不干胶标签：传 piece 为单件标签（衣物 1/3），不传为整单汇总标签
function stickerHTML(order, settings, piece) {
  const L = settings.label;
  const parts = [];
  if (L.show_shop || L.show_time) {
    parts.push(
      `<div class="lb-row lb-small"><span>${L.show_shop ? esc(settings.shop_name) : ''}</span><span>${
        L.show_time ? esc(order.received_at.slice(5, 16)) : ''
      }</span></div>`,
    );
  }
  parts.push(`<div class="lb-name fit">${esc(order.customer_name)}</div>`);
  parts.push(`<div class="lb-code fit">${esc(order.customer_code)}</div>`);
  if (piece) {
    parts.push(
      `<div class="lb-row lb-mid"><span>${esc(piece.name)} ${piece.k}/${piece.qty}</span><span>第${piece.index}/${order.total_qty}件</span></div>`,
    );
  } else if (L.show_items) {
    parts.push(`<div class="lb-items">${esc(itemsText(order.items))}</div>`);
  }
  if (L.show_note && order.note) parts.push(`<div class="lb-note">备注:${esc(order.note)}</div>`);
  if (L.show_order_no) {
    parts.push(`<div class="lb-row lb-small"><span>${esc(order.order_no)}</span><span>共${order.total_qty}件</span></div>`);
  }
  return box(L, parts.join(''));
}

// 小票纸上的整单取件小票
function receiptHTML(order, settings) {
  const L = settings.label;
  const priced = settings.enable_price;
  const items = order.items
    .map(
      (i) =>
        `<div class="rc-line"><span>${esc(i.category_name)} × ${i.quantity}</span>${
          priced && i.unit_price ? `<span>${money(i.unit_price * i.quantity)}</span>` : ''
        }</div>`,
    )
    .join('');
  const inner = [
    L.show_shop ? `<div class="rc-center rc-shop">${esc(settings.shop_name)}</div><div class="rc-hr"></div>` : '',
    `<div class="lb-name fit">${esc(order.customer_name)}</div>`,
    `<div class="lb-code fit">${esc(order.customer_code)}</div>`,
    `<div class="rc-line"><span>单号</span><span>${esc(order.order_no)}</span></div>`,
    L.show_time ? `<div class="rc-line"><span>送来时间</span><span>${esc(order.received_at.slice(0, 16))}</span></div>` : '',
    '<div class="rc-hr"></div>',
    items,
    '<div class="rc-hr"></div>',
    `<div class="rc-line"><b>共 ${order.total_qty} 件</b>${priced ? `<b>${money(order.amount)}</b>` : ''}</div>`,
    L.show_note && order.note ? `<div class="lb-note">备注：${esc(order.note)}</div>` : '',
    '<div class="rc-hr"></div>',
    '<div class="rc-center lb-small">请凭编码取件，谢谢惠顾</div>',
  ];
  return box(L, inner.join(''), ' receipt');
}

// 一个订单每件一张标签的清单：[{ index: 第几件(从1开始), name, k, qty }]
export function pieceList(order) {
  const list = [];
  for (const it of order.items) {
    for (let k = 1; k <= it.quantity; k++) list.push({ index: list.length + 1, name: it.category_name, k, qty: it.quantity });
  }
  return list;
}

/**
 * 生成要打印的页面（每页一张标签）
 * job.kind：all 全部（每件一张）/ piece 单张（job.piece 为第几件）/ order 整单一张（小票纸为取件小票）
 * “全部”和“整单”按设置的份数重复，单张只打一张
 */
export function buildPages(order, settings, job = { kind: 'all' }) {
  const L = settings.label;
  const copies = Math.max(1, L.copies || 1);
  const repeat = (pages) => pages.flatMap((p) => Array(copies).fill(p));
  if (job.kind === 'order') return repeat([L.height ? stickerHTML(order, settings) : receiptHTML(order, settings)]);
  const pieces = pieceList(order);
  if (job.kind === 'piece') {
    const p = pieces[(job.piece || 1) - 1];
    return p ? [stickerHTML(order, settings, p)] : [];
  }
  return repeat(pieces.map((p) => stickerHTML(order, settings, p)));
}

// 姓名、编码太长时自动缩小字号，保证打印完整
export function fitText(root) {
  for (const el of root.querySelectorAll('.fit')) {
    let size = Number.parseFloat(getComputedStyle(el).fontSize);
    for (let i = 0; i < 40 && el.scrollWidth > el.clientWidth && size > 6; i++) {
      size *= 0.92;
      el.style.fontSize = `${size}px`;
    }
  }
}

let pageStyle = null;
let cleanupTimer = null;

function cleanup() {
  document.body.classList.remove('printing-labels');
  pageStyle?.remove();
  pageStyle = null;
}

export function printPages(pages, settings) {
  if (!pages.length) return;
  const L = settings.label;
  const root = document.getElementById('print-root');
  root.innerHTML = pages.join('');
  fitText(root);
  let height = L.height;
  if (!height) {
    // 小票纸：按最高的一张确定纸张高度
    const px = Math.max(...[...root.children].map((el) => el.getBoundingClientRect().height));
    height = Math.ceil((px * 25.4) / 96) + 2;
  }
  cleanup();
  pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { size: ${L.width}mm ${height}mm; margin: 0; }`;
  document.head.appendChild(pageStyle);
  document.body.classList.add('printing-labels');
  clearTimeout(cleanupTimer);
  window.addEventListener('afterprint', cleanup, { once: true });
  cleanupTimer = setTimeout(cleanup, 60000);
  window.print();
}

/**
 * 打印订单标签：本机直接打印，或发送到打印站
 * method 为 none（开单后不弹出打印）时，手动打印按本机打印处理
 */
export async function printJob(order, job = { kind: 'all' }, method = getPrintMethod()) {
  if (method === 'station') {
    const r = await api.post('/print-jobs', { order_id: order.id, kind: job.kind, piece: job.piece });
    if (!r.station_online) toast('已发送。打印站当前未开启，开启后会自动打印', 'warn', 4000);
    return;
  }
  const pages = buildPages(order, store.settings, job);
  if (pages.length > 60 && !(await confirm(`将打印 ${pages.length} 张标签，确定吗？`))) return;
  printPages(pages, store.settings);
}

export function sampleOrder() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    id: 0,
    order_no: `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-001`,
    customer_name: '张三',
    customer_code: '1234',
    total_qty: 3,
    amount: 4500,
    note: '白衬衫领口有污渍',
    received_at: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`,
    items: [
      { category_name: '衣物', quantity: 2, unit_price: 1500 },
      { category_name: '鞋子', quantity: 1, unit_price: 1500 },
    ],
  };
}
