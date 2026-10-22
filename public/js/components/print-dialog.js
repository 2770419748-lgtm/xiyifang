// 打印弹窗：开单成功后、取货页补打、订单详情里打印时使用
// 全部打印：每件一张一次打完；打印单张：点一下打一张；整单汇总：一单一张（小票纸为取件小票）
import { getPrintMethod, pieceList, printJob } from '../print.js';
import { store } from '../store.js';
import { toast, toastError } from '../ui.js';

const { computed, nextTick, reactive, ref, watch } = Vue;

const state = reactive({ order: null, title: '', counts: {}, onClose: null });

/**
 * 打开打印弹窗
 * options.title：弹窗标题；options.onClose：关闭后回调（如开单页把光标放回编码框）
 */
export function openPrintDialog(order, { title = '', onClose = null } = {}) {
  Object.assign(state, { order, title, counts: {}, onClose });
}

export const PrintDialogHost = {
  setup() {
    const allBtn = ref(null);
    const busy = ref(false);
    const order = computed(() => state.order);
    const pieces = computed(() => (order.value ? pieceList(order.value) : []));
    // 本机设置为“开单后不弹出打印”时，手动打印按本机打印
    const method = computed(() => (getPrintMethod() === 'station' ? 'station' : 'local'));
    const receipt = computed(() => !store.settings.label.height);
    const nextPiece = computed(() => pieces.value.find((p) => !state.counts[p.index]));
    const printedCount = computed(() => pieces.value.filter((p) => state.counts[p.index]).length);

    function close() {
      const cb = state.onClose;
      Object.assign(state, { order: null, title: '', counts: {}, onClose: null });
      cb?.();
    }

    async function run(job) {
      if (busy.value) return false;
      busy.value = true;
      try {
        await printJob(order.value, job, method.value);
        return true;
      } catch (e) {
        toastError(e);
        return false;
      } finally {
        busy.value = false;
      }
    }

    async function printAll() {
      const n = pieces.value.length;
      if (!(await run({ kind: 'all' }))) return;
      if (method.value === 'station') toast(`已发送 ${n} 张标签到打印站`, 'success');
      close();
    }

    async function printOne(p) {
      if (!p || !(await run({ kind: 'piece', piece: p.index }))) return;
      state.counts[p.index] = (state.counts[p.index] || 0) + 1;
      if (method.value === 'station') toast(`已发送：${p.name} ${p.k}/${p.qty}`, 'success', 1500);
    }

    async function printWhole() {
      if (!(await run({ kind: 'order' }))) return;
      if (method.value === 'station') toast('已发送到打印站', 'success');
    }

    watch(order, async (o) => {
      if (!o) return;
      await nextTick();
      allBtn.value?.focus();
    });

    return { state, order, pieces, method, receipt, nextPiece, printedCount, busy, allBtn, close, printAll, printOne, printWhole };
  },
  template: `
  <Modal v-if="order" :title="state.title || ('打印标签 · ' + order.order_no)" width="560px" @close="close">
    <div class="print-dlg">
      <div class="pd-head">
        <span class="pd-name">{{ order.customer_name }}</span>
        <span class="code-badge">{{ order.customer_code }}</span>
        <span class="muted">共 {{ order.total_qty }} 件</span>
        <span class="spacer"></span>
        <span class="tag plain" :class="method === 'station' ? 'info' : ''">{{ method === 'station' ? '由打印站打印' : '本机打印' }}</span>
      </div>

      <button ref="allBtn" type="button" class="btn primary lg block" :disabled="busy" @click="printAll">
        <Icon name="printer" :size="18"/>{{ pieces.length > 1 ? '全部打印（' + pieces.length + ' 张）' : '打印标签' }}
      </button>

      <template v-if="pieces.length > 1">
        <div class="pd-section">
          <span>打印单张</span><span class="muted small">点一下打一张，已打 {{ printedCount }}/{{ pieces.length }}</span>
        </div>
        <div class="piece-grid">
          <button v-for="p in pieces" :key="p.index" type="button" class="piece-tile" :class="{ done: state.counts[p.index] }"
            :disabled="busy" @click="printOne(p)">
            <span class="pt-name">{{ p.name }}</span>
            <span class="pt-idx">{{ p.k }}/{{ p.qty }}</span>
            <span v-if="state.counts[p.index]" class="pt-done">✓{{ state.counts[p.index] > 1 ? ' ×' + state.counts[p.index] : '' }}</span>
          </button>
        </div>
        <button type="button" class="btn block" :disabled="busy || !nextPiece" @click="printOne(nextPiece)">
          {{ nextPiece ? '打印下一张：' + nextPiece.name + ' ' + nextPiece.k + '/' + nextPiece.qty : '单张已全部打印' }}
        </button>
      </template>

      <button type="button" class="link small pd-whole" :disabled="busy" @click="printWhole">
        {{ receipt ? '打印取件小票（整单一张）' : '打印整单汇总标签（一单一张）' }}
      </button>
    </div>
    <template #footer>
      <button type="button" class="btn" @click="close">完成</button>
    </template>
  </Modal>`,
};
