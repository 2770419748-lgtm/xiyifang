import { api } from '../api.js';
import { chooseOnCodeConflict, isCodeConflict } from '../components/pickers.js';
import { openPrintDialog } from '../components/print-dialog.js';
import { getPrintMethod } from '../print.js';
import { store } from '../store.js';
import { toast, toastError } from '../ui.js';
import { CODE_RE, fenToYuan, itemsText, localInputNow, money, screen, yuanToFen } from '../utils.js';

const { computed, nextTick, onMounted, ref } = Vue;
const { useRoute } = VueRouter;

const emptyCustomer = () => ({ id: null, name: '', code: '' });

export default {
  setup() {
    const route = useRoute();
    const picker = ref(null);
    const customer = ref(emptyCustomer());
    const counts = ref({});
    const note = ref('');
    const editTime = ref(false);
    const receivedAt = ref('');
    const amount = ref('');
    const submitting = ref(false);
    const last = ref(null);

    const enablePrice = computed(() => store.settings.enable_price);
    const priceOf = (id) => store.categories.find((c) => c.id === Number(id))?.price || 0;
    const totalQty = computed(() => Object.values(counts.value).reduce((s, n) => s + n, 0));
    const isMember = computed(() => customer.value.member_type === 'package');
    // 自动金额：包期会员包期内的品类（设置了每周额度的）不收费，其他按单价算（与服务器计算一致）
    const inPackage = (id) => isMember.value && Number.isInteger(store.settings.package_limits?.[id]);
    const autoAmount = computed(() =>
      Object.entries(counts.value).reduce((s, [id, n]) => (inPackage(id) ? s : s + n * priceOf(id)), 0),
    );
    const finalAmount = computed(() => {
      const v = yuanToFen(amount.value);
      return v === null || Number.isNaN(v) ? autoAmount.value : v;
    });

    function startEditTime() {
      receivedAt.value = localInputNow();
      editTime.value = true;
    }

    function reset() {
      customer.value = emptyCustomer();
      counts.value = {};
      note.value = '';
      amount.value = '';
      editTime.value = false;
      if (!screen.mobile) nextTick(() => picker.value?.focus());
    }

    // 开单：编码有多位客户时让店员选
    async function create(body) {
      try {
        return await api.post('/orders', body);
      } catch (e) {
        if (!isCodeConflict(e)) throw e;
        const choice = await chooseOnCodeConflict(e, body.customer?.name);
        if (!choice) return null;
        const next = { ...body, ...choice };
        if (choice.customer_id) delete next.customer;
        return create(next);
      }
    }

    async function submit() {
      const c = customer.value;
      if (!c.id && !CODE_RE.test(c.code)) return toast('请输入 4 位或 6 位数字编码', 'error');
      const items = Object.entries(counts.value)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ category_id: Number(id), quantity: n }));
      if (!items.length) return toast('请选择送洗的物品', 'error');
      const amountFen = enablePrice.value ? yuanToFen(amount.value) : null;
      if (Number.isNaN(amountFen)) return toast('金额格式不正确', 'error');

      const body = {
        items,
        note: note.value,
        received_at: editTime.value ? receivedAt.value : undefined,
        amount: amountFen ?? undefined,
      };
      if (c.id) body.customer_id = c.id;
      else {
        body.customer = { name: c.name.trim(), code: c.code };
        if (c.isNew) body.force_new = true;
      }

      submitting.value = true;
      try {
        const order = await create(body);
        if (!order) return;
        last.value = order;
        reset();
        toast(`开单成功：${order.order_no}`, 'success');
        // 开单成功后弹出打印选项：全部打印 / 打印单张
        if (store.settings.auto_print && getPrintMethod() !== 'none') openPrint(order, `开单成功 · ${order.order_no}`);
      } catch (e) {
        toastError(e);
      } finally {
        submitting.value = false;
      }
    }

    // 打印弹窗关闭后，电脑上把光标放回编码框，方便接着开下一单
    function openPrint(order, title) {
      openPrintDialog(order, { title, onClose: () => !screen.mobile && picker.value?.focus() });
    }

    onMounted(() => {
      // 从客户详情页“为TA开单”跳转过来
      const { cid, name, code, member } = route.query;
      if (cid && name && code) customer.value = { id: Number(cid), name, code, member_type: member || 'regular' };
      else if (!screen.mobile) picker.value?.focus();
    });

    return {
      store,
      picker,
      customer,
      counts,
      note,
      editTime,
      receivedAt,
      amount,
      submitting,
      last,
      isMember,
      enablePrice,
      totalQty,
      autoAmount,
      finalAmount,
      startEditTime,
      submit,
      openPrint,
      itemsText,
      money,
      fenToYuan,
    };
  },
  template: `
  <div class="page has-action-bar">
    <div v-if="last" class="notice">
      <Icon name="checkCircle" :size="22"/>
      <div class="grow">
        <div><b>开单成功</b> · 单号 <span class="order-no">{{ last.order_no }}</span></div>
        <div class="small muted ellipsis">{{ last.customer_name }}（{{ last.customer_code }}）· {{ itemsText(last.items) }} · 共 {{ last.total_qty }} 件</div>
      </div>
      <button type="button" class="btn sm" @click="openPrint(last)"><Icon name="printer" :size="16"/>打印</button>
    </div>

    <section class="card">
      <div class="card-head"><h3>客户</h3></div>
      <CustomerPicker ref="picker" v-model="customer"/>
    </section>

    <section class="card">
      <div class="card-head">
        <h3>送洗物品</h3>
        <span class="muted small">点击品类加 1 件，长按可直接输入数量</span>
      </div>
      <CategoryPicker v-model="counts" :categories="store.categories" :show-price="enablePrice"/>
    </section>

    <section class="card">
      <div class="form-grid">
        <label class="field">
          <span>备注</span>
          <input v-model="note" maxlength="200" placeholder="颜色、品牌、污渍、破损等（选填）">
        </label>
        <div class="field">
          <span>送来时间</span>
          <div v-if="!editTime" class="time-inline">
            <span>现在</span><button type="button" class="link" @click="startEditTime">修改</button>
          </div>
          <input v-else v-model="receivedAt" type="datetime-local">
        </div>
        <label class="field" v-if="enablePrice">
          <span>金额（元）<span class="hint">{{ isMember ? '包期会员：包期内的品类不收费' : '不填按单价自动计算' }}</span></span>
          <input v-model="amount" inputmode="decimal" :placeholder="fenToYuan(autoAmount)">
        </label>
      </div>
    </section>

    <div class="action-bar">
      <div class="summary">
        <template v-if="totalQty">共 <b>{{ totalQty }}</b> 件<template v-if="enablePrice"> · {{ money(finalAmount) }}</template></template>
        <span v-else class="muted">还没有选择物品</span>
      </div>
      <button type="button" class="btn primary lg" :disabled="submitting" @click="submit">
        <Icon name="check" :size="18"/>{{ submitting ? '提交中…' : '开单' }}
      </button>
    </div>
  </div>`,
};
