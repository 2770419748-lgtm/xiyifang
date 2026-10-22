import { api } from '../api.js';
import { openPrintDialog } from '../components/print-dialog.js';
import { store } from '../store.js';
import { toast, toastError } from '../ui.js';
import { CODE_RE, ageTag, debounce, fmtTime, itemsText, localInputNow, money, screen } from '../utils.js';

const { computed, nextTick, onMounted, reactive, ref, watch } = Vue;

export default {
  setup() {
    const searchEl = ref(null);
    const kw = ref('');
    const orders = ref([]);
    const totalPending = ref(0);
    const loading = ref(false);
    const selected = reactive(new Set());
    const confirming = ref(false);
    const editTime = ref(false);
    const pickedAt = ref('');
    const submitting = ref(false);
    let seq = 0;

    // 按客户分组，保持搜索结果的顺序
    const groups = computed(() => {
      const map = new Map();
      for (const o of orders.value) {
        if (!map.has(o.customer_id)) {
          map.set(o.customer_id, {
            id: o.customer_id,
            name: o.customer_name,
            code: o.customer_code,
            baseCode: o.customer_base_code,
            member: o.customer_member_type === 'package',
            orders: [],
          });
        }
        map.get(o.customer_id).orders.push(o);
      }
      return [...map.values()];
    });

    const chosen = computed(() => orders.value.filter((o) => selected.has(o.id)));
    // 当前输入的编码在待取订单里对应几位客户
    const sharedCodeCount = computed(() => {
      const k = kw.value.trim();
      return CODE_RE.test(k) ? groups.value.filter((g) => g.code === k || g.baseCode === k).length : 0;
    });
    const chosenQty = computed(() => chosen.value.reduce((s, o) => s + o.total_qty, 0));
    const chosenGroups = computed(() => groups.value.filter((g) => g.orders.some((o) => selected.has(o.id))));

    async function load() {
      const mine = ++seq;
      loading.value = true;
      try {
        const r = await api.get('/orders/pending', { q: kw.value.trim() });
        if (mine !== seq) return;
        orders.value = r.items;
        totalPending.value = r.total_pending;
        for (const id of [...selected]) if (!r.items.some((o) => o.id === id)) selected.delete(id);
        // 输入的正好是某位客户的编码：自动勾选他的全部待取订单
        // 编码有多位客户共用时不自动勾选，按客户分组列出，由店员选择
        const k = kw.value.trim();
        if (CODE_RE.test(k) && !selected.size) {
          const same = groups.value.filter((x) => x.code === k || x.baseCode === k);
          if (same.length === 1) same[0].orders.forEach((o) => selected.add(o.id));
        }
      } catch (e) {
        toastError(e);
      } finally {
        if (mine === seq) loading.value = false;
      }
    }

    const search = debounce(load, 250);
    watch(kw, () => {
      selected.clear();
      search();
    });

    function toggle(o) {
      if (selected.has(o.id)) selected.delete(o.id);
      else selected.add(o.id);
    }

    const groupAll = (g) => g.orders.every((o) => selected.has(o.id));
    function toggleGroup(g) {
      const all = groupAll(g);
      g.orders.forEach((o) => (all ? selected.delete(o.id) : selected.add(o.id)));
    }

    function openConfirm() {
      editTime.value = false;
      confirming.value = true;
    }

    function startEditTime() {
      pickedAt.value = localInputNow();
      editTime.value = true;
    }

    async function doPickup() {
      submitting.value = true;
      try {
        const names = chosenGroups.value.map((g) => g.name).join('、');
        const r = await api.post('/orders/pickup', {
          ids: chosen.value.map((o) => o.id),
          picked_at: editTime.value ? pickedAt.value : undefined,
        });
        toast(`取件成功：${names}，共 ${r.count} 单 ${chosenQty.value} 件`, 'success', 3000);
        confirming.value = false;
        selected.clear();
        // 清空搜索框会触发重新加载；本来就为空时手动刷新
        if (kw.value) kw.value = '';
        else await load();
        if (!screen.mobile) nextTick(() => searchEl.value?.focus());
      } catch (e) {
        toastError(e);
        load();
      } finally {
        submitting.value = false;
      }
    }

    const onReprint = (o) => openPrintDialog(o);

    onMounted(() => {
      load();
      if (!screen.mobile) searchEl.value?.focus();
    });

    const age = (o) => ageTag(o.received_at, store.settings.overdue_days);

    return {
      store,
      searchEl,
      kw,
      orders,
      totalPending,
      loading,
      selected,
      groups,
      chosen,
      chosenQty,
      chosenGroups,
      sharedCodeCount,
      confirming,
      editTime,
      pickedAt,
      submitting,
      toggle,
      groupAll,
      toggleGroup,
      openConfirm,
      startEditTime,
      doPickup,
      onReprint,
      age,
      fmtTime,
      itemsText,
      money,
    };
  },
  template: `
  <div class="page" :class="{ 'has-action-bar': selected.size }">
    <div class="search-box">
      <Icon name="search"/>
      <input ref="searchEl" v-model="kw" type="search" placeholder="输入编码、姓名或单号查找" autocomplete="off" enterkeyhint="search">
    </div>
    <div v-if="sharedCodeCount > 1" class="notice info">
      <Icon name="users"/>
      <div class="grow">编码 <b>{{ kw.trim() }}</b> 有 {{ sharedCodeCount }} 位客户在店有衣物，请按姓名勾选要取的订单</div>
    </div>
    <div class="result-head">
      <span v-if="kw.trim()">找到 <b>{{ orders.length }}</b> 单待取<template v-if="orders.length >= 100">（只显示前 100 单）</template></span>
      <span v-else>在店待取共 <b>{{ totalPending }}</b> 单，下面是最近送来的</span>
    </div>

    <div v-if="!groups.length" class="card empty">
      <Icon name="packageCheck" :size="36"/>
      {{ loading ? '查找中…' : (kw.trim() ? '没有找到待取的衣物，请核对编码或姓名' : '目前没有待取的衣物') }}
    </div>

    <div v-for="g in groups" :key="g.id" class="card flush" :class="{ refetching: loading }">
      <div class="group-head">
        <span class="name">{{ g.name }}</span>
        <span class="code-badge">{{ g.code }}</span>
        <span v-if="g.member" class="tag info plain">包期会员</span>
        <span class="muted small">{{ g.orders.length }} 单</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm" @click="toggleGroup(g)">{{ groupAll(g) ? '取消全选' : '全选' }}</button>
      </div>
      <div v-for="o in g.orders" :key="o.id" class="order-row" :class="{ selected: selected.has(o.id) }" @click="toggle(o)">
        <input type="checkbox" :checked="selected.has(o.id)" @click.stop="toggle(o)" :aria-label="'选择单号 ' + o.order_no">
        <div class="grow">
          <div class="row wrap">
            <span class="order-no">{{ o.order_no }}</span>
            <span class="tag" :class="age(o).cls">{{ age(o).text }}</span>
          </div>
          <div class="items-line">{{ itemsText(o.items) }} · 共 {{ o.total_qty }} 件<template v-if="store.settings.enable_price"> · {{ money(o.amount) }}</template></div>
          <div class="small muted">送来 {{ fmtTime(o.received_at) }}<template v-if="o.created_by_name"> · {{ o.created_by_name }} 开单</template><template v-if="o.note"> · {{ o.note }}</template></div>
        </div>
        <button type="button" class="icon-btn" title="打印标签" aria-label="打印标签" @click.stop="onReprint(o)"><Icon name="printer" :size="18"/></button>
      </div>
    </div>

    <div class="action-bar" v-if="selected.size">
      <div class="summary">已选 <b>{{ selected.size }}</b> 单 · {{ chosenQty }} 件</div>
      <button type="button" class="btn primary lg" @click="openConfirm"><Icon name="check" :size="18"/>确认取件</button>
    </div>

    <Modal v-if="confirming" title="确认取件" @close="confirming = false">
      <div class="form-stack">
        <div v-for="g in chosenGroups" :key="g.id">
          <div class="row"><b style="font-size:17px">{{ g.name }}</b><span class="code-badge">{{ g.code }}</span></div>
          <ul class="steps" style="margin-top:6px">
            <li v-for="o in g.orders.filter(x => selected.has(x.id))" :key="o.id">
              <span class="order-no">{{ o.order_no }}</span> · {{ itemsText(o.items) }}（{{ o.total_qty }} 件）
            </li>
          </ul>
        </div>
        <div class="field">
          <span>取走时间</span>
          <div v-if="!editTime" class="time-inline"><span>现在</span><button type="button" class="link" @click="startEditTime">修改</button></div>
          <input v-else v-model="pickedAt" type="datetime-local">
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="confirming = false">取消</button>
        <button type="button" class="btn primary" :disabled="submitting" @click="doPickup">确认取走 {{ chosenQty }} 件</button>
      </template>
    </Modal>
  </div>`,
};
