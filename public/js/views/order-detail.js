import { api } from '../api.js';
import { chooseOnCodeConflict, isCodeConflict } from '../components/pickers.js';
import { openPrintDialog } from '../components/print-dialog.js';
import { isManager, store } from '../store.js';
import { confirm, prompt, toast, toastError } from '../ui.js';
import { CODE_RE, daysSince, fenToYuan, fmtDateTime, money, toInput, yuanToFen } from '../utils.js';

const { computed, ref, watch } = Vue;
const { useRoute } = VueRouter;

// 修改订单（店长）
const OrderEditor = {
  props: { order: { type: Object, required: true } },
  emits: ['close', 'saved'],
  setup(props, { emit }) {
    const o = props.order;
    const customer = ref({ id: o.customer_id, name: o.customer_name, code: o.customer_code, member_type: o.customer_member_type });
    const counts = ref(Object.fromEntries(o.items.map((i) => [i.category_id, i.quantity])));
    const receivedAt = ref(toInput(o.received_at));
    const pickedAt = ref(toInput(o.picked_at));
    const amount = ref(fenToYuan(o.amount));
    const amountDirty = ref(false);
    const note = ref(o.note);
    const saving = ref(false);
    const enablePrice = computed(() => store.settings.enable_price);

    // 订单里如果有已停用的品类，也要显示出来
    const categories = computed(() => {
      const list = [...store.categories];
      for (const i of o.items) {
        if (!list.some((c) => c.id === i.category_id)) list.push({ id: i.category_id, name: i.category_name, price: i.unit_price });
      }
      return list;
    });

    async function save() {
      const items = Object.entries(counts.value)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ category_id: Number(id), quantity: n }));
      if (!items.length) return toast('请至少保留一件物品', 'error');
      const body = { items, note: note.value };
      if (receivedAt.value !== toInput(o.received_at)) body.received_at = receivedAt.value;
      if (o.status === 'picked' && pickedAt.value !== toInput(o.picked_at)) body.picked_at = pickedAt.value;
      if (enablePrice.value && amountDirty.value) {
        const fen = yuanToFen(amount.value);
        if (Number.isNaN(fen)) return toast('金额格式不正确', 'error');
        if (fen !== null) body.amount = fen;
      }
      const c = customer.value;
      if (c.id !== o.customer_id) {
        if (c.id) body.customer_id = c.id;
        else {
          if (!CODE_RE.test(c.code)) return toast('请输入 4 位或 6 位数字编码', 'error');
          body.customer = { name: c.name.trim(), code: c.code };
          if (c.isNew) body.force_new = true;
        }
      }
      saving.value = true;
      try {
        // 编码有多位客户时让店长选
        const put = async (data) => {
          try {
            return await api.put(`/orders/${o.id}`, data);
          } catch (e) {
            if (!isCodeConflict(e)) throw e;
            const choice = await chooseOnCodeConflict(e, data.customer?.name);
            if (!choice) return null;
            const next = { ...data, ...choice };
            if (choice.customer_id) delete next.customer;
            return put(next);
          }
        };
        const r = await put(body);
        if (!r) return;
        toast('订单已保存', 'success');
        emit('saved', r);
      } catch (e) {
        toastError(e);
      } finally {
        saving.value = false;
      }
    }

    return { o, customer, counts, receivedAt, pickedAt, amount, amountDirty, note, saving, enablePrice, categories, save };
  },
  template: `
  <Modal title="修改订单" width="760px" @close="$emit('close')">
    <div class="form-stack">
      <div class="field"><span class="field-label">客户</span><CustomerPicker v-model="customer"/></div>
      <div class="field"><span class="field-label">物品</span><CategoryPicker v-model="counts" :categories="categories" :show-price="enablePrice"/></div>
      <div class="form-grid">
        <label class="field"><span>送来时间</span><input v-model="receivedAt" type="datetime-local" required></label>
        <label class="field" v-if="o.status === 'picked'"><span>取走时间</span><input v-model="pickedAt" type="datetime-local" required></label>
        <label class="field" v-if="enablePrice">
          <span>金额（元）<span class="hint">不改动则按物品自动计算</span></span>
          <input v-model="amount" inputmode="decimal" @input="amountDirty = true">
        </label>
        <label class="field"><span>备注</span><input v-model="note" maxlength="200"></label>
      </div>
    </div>
    <template #footer>
      <button type="button" class="btn" @click="$emit('close')">取消</button>
      <button type="button" class="btn primary" :disabled="saving" @click="save">保存</button>
    </template>
  </Modal>`,
};

export default {
  components: { OrderEditor },
  setup() {
    const route = useRoute();
    const order = ref(null);
    const notFound = ref(false);
    const editing = ref(false);
    const busy = ref(false);
    const enablePrice = computed(() => store.settings.enable_price);
    const days = computed(() => (order.value ? daysSince(order.value.received_at) : 0));

    async function load() {
      try {
        order.value = await api.get(`/orders/${route.params.id}`);
      } catch (e) {
        if (e.status === 404) notFound.value = true;
        else toastError(e);
      }
    }

    async function act(fn, message) {
      busy.value = true;
      try {
        await fn();
        toast(message, 'success');
        await load();
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    }

    async function pickup() {
      const o = order.value;
      if (!(await confirm(`确认 ${o.customer_name}（${o.customer_code}）取走这单 ${o.total_qty} 件？`, { title: '确认取件' }))) return;
      act(() => api.post('/orders/pickup', { ids: [o.id] }), '已确认取件');
    }

    async function unpickup() {
      if (!(await confirm('撤销后订单恢复为“待取”状态，取走时间会被清除。', { title: '撤销取件' }))) return;
      act(() => api.post(`/orders/${order.value.id}/unpickup`), '已撤销取件');
    }

    async function cancel() {
      const reason = await prompt('作废订单', {
        message: '作废后不计入经营数据，之后可以恢复。作废原因（选填）：',
        placeholder: '例如：录错了',
        okText: '确认作废',
      });
      if (reason === null) return;
      act(() => api.post(`/orders/${order.value.id}/cancel`, { reason }), '订单已作废');
    }

    function restore() {
      act(() => api.post(`/orders/${order.value.id}/restore`), '订单已恢复');
    }

    const print = () => openPrintDialog(order.value);

    function onSaved(o) {
      order.value = o;
      editing.value = false;
    }

    watch(() => route.params.id, (id) => id && load(), { immediate: true });

    // 店员可以查看、确认取件、打印待取订单；修改、作废、恢复、撤销取件只有店长能做
    const manager = isManager();
    return { order, notFound, editing, busy, enablePrice, days, manager, pickup, unpickup, cancel, restore, print, onSaved, fmtDateTime, money };
  },
  template: `
  <div class="page" v-if="order">
    <section class="card">
      <div class="detail-head">
        <div class="grow">
          <div class="title"><span class="order-no">{{ order.order_no }}</span><StatusTag :status="order.status"/></div>
          <div class="muted small">录入时间 {{ fmtDateTime(order.created_at) }}</div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn" v-if="manager || order.status === 'pending'" @click="print"><Icon name="printer" :size="16"/>打印标签</button>
          <button type="button" class="btn" v-if="manager && order.status !== 'cancelled'" @click="editing = true"><Icon name="edit" :size="16"/>修改</button>
          <button type="button" class="btn primary" v-if="order.status === 'pending'" :disabled="busy" @click="pickup"><Icon name="check" :size="16"/>确认取件</button>
          <button type="button" class="btn" v-if="manager && order.status === 'picked'" :disabled="busy" @click="unpickup">撤销取件</button>
          <button type="button" class="btn danger" v-if="manager && order.status !== 'cancelled'" :disabled="busy" @click="cancel">作废</button>
          <button type="button" class="btn" v-if="manager && order.status === 'cancelled'" :disabled="busy" @click="restore">恢复订单</button>
        </div>
      </div>
      <div class="info-grid">
        <div>
          <div class="label">客户</div>
          <RouterLink v-if="manager" :to="'/customers/' + order.customer_id"><b>{{ order.customer_name }}</b></RouterLink>
          <b v-else>{{ order.customer_name }}</b>
          <span class="code-badge" style="margin-left:6px">{{ order.customer_code }}</span>
          <span v-if="order.customer_member_type === 'package'" class="tag info plain" style="margin-left:6px">包期会员</span>
        </div>
        <div>
          <div class="label">数量</div>
          <b>{{ order.total_qty }}</b> 件<template v-if="enablePrice"> · <b>{{ money(order.amount) }}</b></template>
        </div>
        <div v-if="order.note"><div class="label">备注</div>{{ order.note }}</div>
      </div>
    </section>

    <div class="chart-grid">
      <section class="card flush">
        <div class="card-head"><h3>物品明细</h3></div>
        <table class="table">
          <thead><tr><th>品类</th><th class="num">数量</th><template v-if="enablePrice"><th class="num">单价</th><th class="num">小计</th></template></tr></thead>
          <tbody>
            <tr v-for="i in order.items" :key="i.category_id">
              <td>{{ i.category_name }}</td>
              <td class="num">{{ i.quantity }}</td>
              <template v-if="enablePrice"><td class="num">{{ money(i.unit_price) }}</td><td class="num">{{ money(i.unit_price * i.quantity) }}</td></template>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="card">
        <div class="card-head"><h3>送取记录</h3></div>
        <ul class="timeline">
          <li>
            <div class="t">送来</div>
            <div class="muted small">{{ fmtDateTime(order.received_at) }} · {{ order.created_by_name || '—' }} 开单</div>
          </li>
          <li v-if="order.picked_at">
            <div class="t">取走</div>
            <div class="muted small">{{ fmtDateTime(order.picked_at) }} · {{ order.picked_by_name || '—' }} 办理</div>
          </li>
          <li v-else-if="order.status === 'pending'" class="pending">
            <div class="t">等待取件</div>
            <div class="muted small">{{ days ? '已在店 ' + days + ' 天' : '今天送来' }}</div>
          </li>
          <li v-if="order.status === 'cancelled'" class="cancel">
            <div class="t">已作废</div>
            <div class="muted small">{{ fmtDateTime(order.cancelled_at) }} · {{ order.cancelled_by_name || '—' }}<template v-if="order.cancel_reason"> · {{ order.cancel_reason }}</template></div>
          </li>
        </ul>
      </section>
    </div>

    <OrderEditor v-if="editing" :order="order" @close="editing = false" @saved="onSaved"/>
  </div>
  <div v-else-if="notFound" class="card empty">订单不存在</div>`,
};
