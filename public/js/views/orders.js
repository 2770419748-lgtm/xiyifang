import { api } from '../api.js';
import { isManager, store } from '../store.js';
import { toastError } from '../ui.js';
import { DATE_PRESETS, localDate, matchPreset, money, presetRange, screen } from '../utils.js';

const { onMounted, reactive, ref, watch, computed } = Vue;
const { useRoute, useRouter } = VueRouter;

const EMPTY = { q: '', status: '', category_id: '', date_field: 'received', from: '', to: '', overdue: false };

export default {
  setup() {
    const route = useRoute();
    const router = useRouter();
    const f = reactive({ ...EMPTY });
    const presetSel = ref('all');
    const data = ref({ total: 0, orders: 0, qty: 0, amount: 0, category_qty: null, page: 1, page_size: 20, items: [] });
    const loading = ref(false);
    const categories = ref([]);
    const showFilters = ref(false);
    // 当前生效的筛选条件数（手机端折叠筛选时显示）
    const activeCount = computed(() => {
      const q = route.query;
      return ['status', 'category_id', 'from', 'overdue'].filter((k) => q[k]).length + (q.date_field ? 1 : 0);
    });

    function fromQuery() {
      const q = route.query;
      Object.assign(f, {
        q: q.q || '',
        status: q.status || '',
        category_id: q.category_id || '',
        date_field: q.date_field || 'received',
        from: q.from || '',
        to: q.to || '',
        overdue: q.overdue === '1',
      });
      presetSel.value = !f.from && !f.to ? 'all' : matchPreset(f.from, f.to) || 'custom';
    }

    function toQuery(page = 1) {
      const q = {};
      if (f.q.trim()) q.q = f.q.trim();
      if (f.status) q.status = f.status;
      if (f.category_id) q.category_id = String(f.category_id);
      if (f.date_field !== 'received') q.date_field = f.date_field;
      if (f.from) q.from = f.from;
      if (f.to) q.to = f.to;
      if (f.overdue) q.overdue = '1';
      if (page > 1) q.page = String(page);
      return q;
    }

    async function load() {
      loading.value = true;
      try {
        data.value = await api.get('/orders', route.query);
      } catch (e) {
        toastError(e);
      } finally {
        loading.value = false;
      }
    }

    const sameQuery = (a, b) => {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].every((k) => String(a[k] ?? '') === String(b[k] ?? ''));
    };
    // 条件没变时路由不会变化，需要手动刷新
    function apply() {
      const q = toQuery();
      if (sameQuery(q, route.query)) load();
      else router.replace({ query: q });
    }
    const categoryName = computed(() => categories.value.find((c) => String(c.id) === String(f.category_id))?.name || '');
    const goPage = (p) => router.replace({ query: toQuery(p) });

    function reset() {
      Object.assign(f, EMPTY);
      apply();
    }

    function onPreset() {
      const v = presetSel.value;
      if (v === 'all') {
        f.from = '';
        f.to = '';
        apply();
      } else if (v === 'custom') {
        if (!f.from) f.from = localDate();
        if (!f.to) f.to = localDate();
      } else {
        Object.assign(f, presetRange(v));
        apply();
      }
    }

    const exportHref = computed(() => {
      const { page, ...rest } = route.query;
      return api.href('/orders/export', rest);
    });

    watch(
      () => route.query,
      () => {
        if (route.path !== '/orders') return;
        fromQuery();
        load();
      },
      { immediate: true },
    );
    showFilters.value = activeCount.value > 0;

    onMounted(async () => {
      try {
        categories.value = await api.get('/categories', { all: 1 });
      } catch {
        categories.value = store.categories;
      }
    });

    const openOrder = (o) => router.push(`/orders/${o.id}`);

    return {
      store,
      screen,
      f,
      presetSel,
      data,
      loading,
      categories,
      categoryName,
      showFilters,
      activeCount,
      DATE_PRESETS,
      apply,
      goPage,
      reset,
      onPreset,
      exportHref,
      openOrder,
      money,
      isManager,
    };
  },
  template: `
  <div class="page">
    <section class="card">
      <form class="filters" @submit.prevent="apply">
        <input class="kw" v-model="f.q" type="search" placeholder="姓名 / 编码 / 单号" enterkeyhint="search">
        <template v-if="!screen.mobile || showFilters">
        <select v-model="f.status" @change="apply" aria-label="状态">
          <option value="">全部状态</option>
          <option value="pending">待取</option>
          <option value="picked">已取</option>
          <option value="cancelled">已作废</option>
        </select>
        <select v-model="f.category_id" @change="apply" aria-label="品类">
          <option value="">全部品类</option>
          <option v-for="c in categories" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
        </select>
        <select v-model="f.date_field" @change="apply" aria-label="时间类型">
          <option value="received">按送来时间</option>
          <option value="picked">按取走时间</option>
        </select>
        <select v-model="presetSel" @change="onPreset" aria-label="时间范围">
          <option value="all">全部时间</option>
          <option v-for="p in DATE_PRESETS" :key="p.key" :value="p.key">{{ p.label }}</option>
          <option value="custom">自定义日期</option>
        </select>
        <template v-if="presetSel === 'custom'">
          <input type="date" v-model="f.from" aria-label="开始日期">
          <input type="date" v-model="f.to" aria-label="结束日期">
        </template>
        <label class="check"><input type="checkbox" v-model="f.overdue" @change="apply">只看超期未取</label>
        </template>
        <button v-if="screen.mobile" type="button" class="btn" @click="showFilters = !showFilters">
          <Icon name="sliders" :size="16"/>{{ showFilters ? '收起筛选' : '筛选' }}<span v-if="activeCount" class="tag info plain">{{ activeCount }}</span>
        </button>
        <button class="btn primary"><Icon name="search" :size="16"/>查询</button>
        <button v-if="!screen.mobile || showFilters" type="button" class="btn" @click="reset">重置</button>
      </form>
    </section>

    <div class="result-head">
      <span>
        共 <b>{{ data.orders }}</b> 单
        <template v-if="data.category_qty !== null"> · 其中「{{ categoryName }}」<b>{{ data.category_qty }}</b> 件</template>
        <template v-else> · <b>{{ data.qty }}</b> 件<template v-if="store.settings.enable_price && data.amount !== null"> · <b>{{ money(data.amount) }}</b></template></template>
        <span class="muted" v-if="data.total > data.orders">（另有 {{ data.total - data.orders }} 单已作废，不计入合计）</span>
      </span>
      <span class="spacer"></span>
      <a v-if="isManager()" class="btn sm" :href="exportHref"><Icon name="download" :size="16"/>导出 Excel</a>
    </div>

    <section class="card flush">
      <OrderList :orders="data.items" :loading="loading" @open="openOrder"/>
      <Pager :page="data.page" :page-size="data.page_size" :total="data.total" @change="goPage"/>
    </section>
  </div>`,
};
