// 打印站：在连着打印机的电脑上开启后，在后台持续领取并打印其他设备发来的标签。
// 开启状态记在本机浏览器里，刷新或重新登录后自动继续；切换到其他页面也不影响。
// 同一时间只有一台设备能作为打印站，已有其他设备时需要确认“接管”。
import { api } from './api.js';
import { buildPages, printPages } from './print.js';
import { store } from './store.js';

const { reactive } = Vue;

const FLAG_KEY = 'laundry.station';
const ID_KEY = 'laundry.stationId';

export const station = reactive({
  running: false,
  printed: 0,
  error: '',
  conflict: '', // 已有其他打印站时，对方的名称
  replacedBy: '', // 被其他设备接管时，对方的名称
  log: [],
});

let loopId = 0;

function storage(fn, fallback) {
  try {
    return fn(localStorage);
  } catch {
    return fallback;
  }
}

export const isStationDevice = () => storage((s) => s.getItem(FLAG_KEY) === '1', false);

function remember(on) {
  storage((s) => (on ? s.setItem(FLAG_KEY, '1') : s.removeItem(FLAG_KEY)));
}

// 本机打印站标识（不用 crypto.randomUUID，局域网 http 下不可用）
let memoryId = '';
function stationId() {
  let id = storage((s) => s.getItem(ID_KEY), '') || memoryId;
  if (!id) {
    id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    memoryId = id;
    storage((s) => s.setItem(ID_KEY, id));
  }
  return id;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return '苹果手机/平板';
  if (/Android/.test(ua)) return '安卓手机/平板';
  if (/Windows/.test(ua)) return 'Windows 电脑';
  if (/Macintosh/.test(ua)) return 'Mac 电脑';
  return '电脑';
}

export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome 中 afterprint 可能在 print() 返回前触发，所以要先监听再打印
function printAndWait(pages, settings) {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('afterprint', done);
      resolve();
    };
    window.addEventListener('afterprint', done);
    setTimeout(done, 3000);
    printPages(pages, settings);
  });
}

async function loop(id, takeover) {
  while (station.running && id === loopId) {
    try {
      const r = await api.post('/print-jobs/claim?wait=1', {
        station_id: stationId(),
        station_name: `${store.user?.display_name || ''} · ${deviceLabel()}`,
        takeover,
      });
      takeover = false;
      station.error = '';
      if (r.replaced) {
        // 其他设备接管了打印站
        station.running = false;
        station.replacedBy = r.by || '其他设备';
        remember(false);
        return;
      }
      if (r.job && r.order) {
        // 用服务器返回的最新设置打印（店长可能刚在别的设备上改过纸张）
        if (r.settings) store.settings = r.settings;
        const settings = r.settings || store.settings;
        // 任务类型：全部（每件一张）/ 单张 / 整单一张
        const pages = buildPages(r.order, settings, r.job);
        if (pages.length) await printAndWait(pages, settings);
        // 确认打印完成；没确认的任务过一会儿会重新排队
        await api.post(`/print-jobs/${r.job.id}/done`).catch(() => {});
        station.printed++;
        station.log.unshift({ id: r.job.id, time: new Date().toTimeString().slice(0, 8), order: r.order });
        station.log.splice(50);
      }
    } catch (e) {
      if (e.status === 401) {
        station.running = false;
        return;
      }
      if (e.status === 409 && e.data?.station) {
        station.running = false;
        station.conflict = e.data.station;
        return;
      }
      station.error = e.message;
      await sleep(3000);
    }
  }
}

export function startStation({ takeover = false } = {}) {
  remember(true);
  station.conflict = '';
  station.replacedBy = '';
  if (station.running && !takeover) return;
  station.running = true;
  station.error = '';
  loop(++loopId, takeover);
}

export function stopStation() {
  remember(false);
  station.running = false;
  loopId++;
}

// 登录且设置加载完成后：如果这台设备是打印站就自动开始
export function resumeStationIfNeeded() {
  if (isStationDevice() && store.user && store.settings) startStation();
}
