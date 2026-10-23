// 打印站设置页：开启 / 暂停、使用说明、打印记录
import { api } from '../api.js';
import { buildPages, printPages, sampleOrder } from '../print.js';
import { isTouchDevice, startStation, station, stopStation } from '../station.js';
import { isManager, store } from '../store.js';
import { confirm, toast, toastError } from '../ui.js';
import { itemsText } from '../utils.js';

const { computed } = Vue;

export default {
  setup() {
    async function clearQueue() {
      if (!(await confirm('清空所有等待打印的任务？清空后这些标签不会再打印。'))) return;
      try {
        const r = await api.post('/print-jobs/clear');
        toast(`已清空 ${r.count} 个任务`, 'success');
      } catch (e) {
        toastError(e);
      }
    }

    function testPrint() {
      printPages(buildPages(sampleOrder(), store.settings, { kind: 'piece', piece: 1 }), store.settings);
    }

    async function start(takeover = false) {
      if (
        isTouchDevice() &&
        !(await confirm('手机、平板一般连不上标签打印机。确定要把这台设备作为打印站吗？开启后其他设备发来的标签都会在这里打印。', {
          okText: '确定开启',
        }))
      ) {
        return;
      }
      startStation({ takeover });
    }

    const paper = computed(() => {
      const l = store.settings.label;
      return `${l.width}mm 宽布带，每张 ${l.height}mm`;
    });

    return { station, paper, start, stopStation, clearQueue, testPrint, itemsText, isManager };
  },
  template: `
  <div class="page">
    <section class="card">
      <div class="station-status">
        <span class="pulse" :class="{ on: station.running && !station.error }"></span>
        <div class="grow">
          <div style="font-size:18px;font-weight:700">
            {{ station.running ? (station.error ? '连接异常，正在重试…' : '这台设备正在作为打印站运行') : '这台设备未开启打印站' }}
          </div>
          <div class="muted small">本次已打印 {{ station.printed }} 次 · 纸张：{{ paper }}</div>
          <div v-if="station.error" class="field-error">{{ station.error }}</div>
        </div>
        <button v-if="station.running" type="button" class="btn" @click="stopStation"><Icon name="pause" :size="16"/>关闭</button>
        <button v-else-if="!station.conflict" type="button" class="btn primary" @click="start()"><Icon name="play" :size="16"/>开启打印站</button>
      </div>
    </section>

    <div v-if="station.conflict" class="notice warn">
      <Icon name="alert"/>
      <div class="grow">
        <div><b>已有设备在作为打印站：</b>{{ station.conflict }}</div>
        <div class="small">一般只需要连着打印机的那台电脑开启。确定要改由这台设备打印吗？</div>
      </div>
      <button type="button" class="btn sm" @click="start(true)">改用这台设备</button>
    </div>
    <div v-if="station.replacedBy" class="notice info">
      <Icon name="info"/>
      <div class="grow">打印站已由「{{ station.replacedBy }}」接管，这台设备不再打印。</div>
    </div>

    <section class="card">
      <div class="card-head"><h3>使用说明</h3></div>
      <ol class="steps">
        <li>只需在<b>连着打印机的那台电脑</b>上开启打印站（同一时间只能有一台）。开启后在本系统任何页面都会在后台自动打印，刷新或重新登录后自动继续。</li>
        <li>手机等设备在“我的 → 本机打印方式”中选择“发送到打印站”，开单后标签会自动从这台电脑打印。</li>
        <li>保持浏览器窗口打开（不要最小化）。建议把标签打印机设为 Windows <b>默认打印机</b>，并双击系统文件夹里的
          <kbd>open-direct-print.bat</kbd> 打开系统，这样<b>不弹打印预览、直接打印</b>（也可以在 Edge / Chrome 快捷方式的“目标”末尾加上 <kbd>--kiosk-printing</kbd>）。</li>
        <li>第一次使用请先点“打印测试标签”，确认纸张尺寸和位置正确。</li>
      </ol>
      <div class="btn-row" style="margin-top:14px">
        <button type="button" class="btn" @click="testPrint"><Icon name="printer" :size="16"/>打印测试标签</button>
        <button v-if="isManager()" type="button" class="btn danger" @click="clearQueue"><Icon name="trash" :size="16"/>清空等待队列</button>
      </div>
    </section>

    <section class="card flush">
      <div class="card-head"><h3>打印记录</h3></div>
      <div v-if="!station.log.length" class="empty">还没有打印任务</div>
      <div v-else class="list">
        <div v-for="l in station.log" :key="l.id" class="list-item" style="cursor:default">
          <div class="grow">
            <div class="list-title">{{ l.order.customer_name }} <span class="code-badge">{{ l.order.customer_code }}</span><span class="spacer"></span><span class="muted small">{{ l.time }}</span></div>
            <div class="list-sub">{{ l.order.order_no }} · {{ itemsText(l.order.items) }}</div>
          </div>
        </div>
      </div>
    </section>
  </div>`,
};
