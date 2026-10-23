// 标签打印（水洗唛布带）：生成打印内容 → 按布带宽度和每张长度调用浏览器打印
// 打印机只要在电脑上装好驱动即可；Chrome / Edge 加 --kiosk-printing 启动可不弹对话框直接出纸
import { api } from './api.js';
import { store } from './store.js';
import { confirm, toast } from './ui.js';

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

// 布带竖着走纸：每张长度大于布带宽度时，打印时内容整体转 90°，沿布带方向排列
export const isTurned = (L) => L.height > L.width;
// 剪下后横着看的宽和高（毫米），编号、姓名的位置按这个方向设置
export const tagSize = (L) => (isTurned(L) ? { w: L.height, h: L.width } : { w: L.width, h: L.height });

// 编号、姓名：中心点在 (x%, y%)；最大宽度按离左右两边的距离算，过长时自动缩小
function itemHTML(cls, text, p) {
  const room = 2 * Math.min(p.x, 100 - p.x);
  return `<div class="tg-item ${cls} fit" style="left:${p.x}%;top:${p.y}%;font-size:${p.size}mm;max-width:calc(${room}% - 1mm)">${esc(text)}</div>`;
}

// 一张布带标签（打印时为一页）：只打编号和姓名，每件衣物的标签都一样
function tagHTML(order, L) {
  const inner = itemHTML('tg-code', order.customer_code, L.code) + itemHTML('tg-name', order.customer_name, L.name);
  const h = L.height - 0.3; // 略小于纸张，避免四舍五入误差导致多出空白页
  const cut = L.cut_line ? ' cut' : ''; // 裁切线打在每张末尾（走纸方向的下边）
  if (!isTurned(L)) return `<div class="label tape${cut}" style="width:${L.width}mm;height:${h}mm">${inner}</div>`;
  return (
    `<div class="label rotated${cut}" style="width:${L.width}mm;height:${h}mm">` +
    `<div class="tape lb-turn" style="width:${h}mm;height:${L.width}mm;transform:translateX(${L.width}mm) rotate(90deg)">${inner}</div>` +
    '</div>'
  );
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
 * job.kind：all 全部（每件一张）/ piece 单张（job.piece 为第几件）/ order 整单一张
 * “全部”和“整单”按设置的份数重复，单张只打一张
 */
export function buildPages(order, settings, job = { kind: 'all' }) {
  const L = settings.label;
  const tag = tagHTML(order, L);
  if (job.kind === 'piece') return pieceList(order)[(job.piece || 1) - 1] ? [tag] : [];
  const n = job.kind === 'order' ? 1 : pieceList(order).length;
  return Array(n * Math.max(1, L.copies || 1)).fill(tag);
}

// 编号、姓名太长时自动缩小字号，保证打印完整
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
  cleanup();
  pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { size: ${L.width}mm ${L.height}mm; margin: 0; }`;
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
    customer_name: '张小明',
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
