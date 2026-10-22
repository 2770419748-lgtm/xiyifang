import { api } from '../api.js';
import { SERIES } from '../components/charts.js';
import { store } from '../store.js';
import { toastError } from '../ui.js';
import { DATE_PRESETS, money, presetRange, screen } from '../utils.js';

const { computed, onMounted, reactive, ref } = Vue;

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function dayTitle(key) {
  const d = new Date(`${key}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
}

export default {
  setup() {
    const presetKey = ref('today');
    const range = reactive(presetRange('today'));
    const data = ref(null);
    const loading = ref(false);
    const trendView = ref('chart');
    const enablePrice = computed(() => store.settings.enable_price);

    async function load() {
      if (!range.from || !range.to) return;
      loading.value = true;
      try {
        data.value = await api.get('/stats', { from: range.from, to: range.to });
      } catch (e) {
        toastError(e);
      } finally {
        loading.value = false;
      }
    }

    function choose(key) {
      presetKey.value = key;
      if (key === 'custom') return;
      Object.assign(range, presetRange(key));
      load();
    }

    const single = computed(() => data.value?.days === 1);
    const prevLabel = computed(() => (data.value?.days === 1 ? '较前一天' : `较前 ${data.value?.days} 天`));
    const rangeText = computed(() =>
      data.value ? (data.value.from === data.value.to ? data.value.from : `${data.value.from} 至 ${data.value.to}`) : '',
    );

    function delta(cur, prev) {
      if (!prev) return cur ? { text: '上期无数据', cls: '', noCompare: true } : null;
      const pct = Math.round(((cur - prev) / prev) * 100);
      return {
        text: `${pct > 0 ? '+' : ''}${pct}%`,
        cls: pct > 0 ? 'up' : pct < 0 ? 'down' : '',
        icon: pct > 0 ? 'arrowUp' : pct < 0 ? 'arrowDown' : null,
      };
    }

    const kpis = computed(() => {
      const s = data.value?.summary;
      if (!s) return [];
      const list = [
        { key: 'ro', label: '收件单数', value: s.received.orders, unit: '单', delta: delta(s.received.orders, s.prev.received.orders) },
        { key: 'rq', label: '收件件数', value: s.received.qty, unit: '件', delta: delta(s.received.qty, s.prev.received.qty) },
        { key: 'po', label: '取件单数', value: s.picked.orders, unit: '单', delta: delta(s.picked.orders, s.prev.picked.orders) },
      ];
      if (enablePrice.value) {
        list.push({ key: 'am', label: '营业额', value: money(s.received.amount), delta: delta(s.received.amount, s.prev.received.amount) });
      }
      list.push(
        { key: 'nc', label: '新增客户', value: s.new_customers, unit: '位', note: `到店客户 ${s.received.customers} 位` },
        { key: 'pd', label: '当前在店待取', value: s.pending.orders, unit: '单', note: `共 ${s.pending.qty} 件，点击查看`, to: '/orders?status=pending' },
        {
          key: 'od',
          label: `超期未取（满 ${store.settings.overdue_days} 天）`,
          value: s.overdue,
          unit: '单',
          note: s.overdue ? '点击查看并联系客户' : '暂无超期',
          to: '/orders?overdue=1',
          alert: s.overdue > 0,
        },
      );
      return list;
    });

    const trend = computed(() => {
      const t = data.value?.trend || [];
      return {
        labels: t.map((x) => x.key),
        series: [
          { name: '收件', color: SERIES[0], values: t.map((x) => x.received_orders) },
          { name: '取件', color: SERIES[1], values: t.map((x) => x.picked_orders) },
        ],
        empty: t.every((x) => !x.received_orders && !x.picked_orders),
      };
    });

    const byMonth = computed(() => data.value?.granularity === 'month');
    const formatX = (k) => (byMonth.value ? `${+k.slice(5, 7)}月` : `${+k.slice(5, 7)}/${+k.slice(8, 10)}`);
    const formatTitle = (k) => (byMonth.value ? `${k.slice(0, 4)}年${+k.slice(5, 7)}月` : dayTitle(k));

    const hours = computed(() => {
      const h = data.value?.hours || [];
      return { labels: h.map((x) => x.hour), values: h.map((x) => x.orders), empty: h.every((x) => !x.orders) };
    });

    const catRows = computed(() => {
      const cats = data.value?.categories || [];
      const total = cats.reduce((s, c) => s + c.qty, 0) || 1;
      return cats.map((c) => ({
        key: c.id,
        name: c.name,
        value: c.qty,
        sub: `${Math.round((c.qty / total) * 100)}%`,
        title: `${c.name}：${c.qty} 件，${c.orders} 单${enablePrice.value ? `，约 ${money(c.amount)}` : ''}`,
      }));
    });

    onMounted(load);

    return {
      DATE_PRESETS,
      SERIES,
      presetKey,
      range,
      data,
      loading,
      trendView,
      enablePrice,
      single,
      prevLabel,
      rangeText,
      kpis,
      trend,
      hours,
      catRows,
      screen,
      load,
      choose,
      formatX,
      formatTitle,
      money,
    };
  },
  template: `
  <div class="page">
    <div class="row wrap">
      <div class="seg">
        <button v-for="p in DATE_PRESETS" :key="p.key" type="button" :class="{ active: presetKey === p.key }" @click="choose(p.key)">{{ p.label }}</button>
        <button type="button" :class="{ active: presetKey === 'custom' }" @click="choose('custom')">自定义</button>
      </div>
      <template v-if="presetKey === 'custom'">
        <input class="input" type="date" v-model="range.from" style="width:auto" aria-label="开始日期">
        <span class="muted">至</span>
        <input class="input" type="date" v-model="range.to" style="width:auto" aria-label="结束日期">
        <button type="button" class="btn primary" @click="load">查询</button>
      </template>
      <span class="muted small">{{ rangeText }}</span>
    </div>

    <div v-if="data" class="page" :class="{ refetching: loading }">
      <div class="kpis">
        <component :is="k.to ? 'RouterLink' : 'div'" v-for="k in kpis" :key="k.key" :to="k.to" class="kpi" :class="{ alert: k.alert }">
          <span class="label">{{ k.label }}</span>
          <span class="value">{{ k.value }}<small v-if="k.unit">{{ k.unit }}</small></span>
          <span v-if="k.delta" class="delta" :class="k.delta.cls">
            <Icon v-if="k.delta.icon" :name="k.delta.icon" :size="12"/>{{ k.delta.text }}<span v-if="!k.delta.noCompare" class="muted">&nbsp;{{ prevLabel }}</span>
          </span>
          <span v-else-if="k.note" class="delta">{{ k.note }}</span>
          <span v-else class="delta">&nbsp;</span>
        </component>
      </div>

      <div class="chart-grid">
        <section class="card">
          <div class="card-head">
            <h3>{{ single ? '各时段收件单数' : (data.granularity === 'month' ? '每月收件与取件（单）' : '每日收件与取件（单）') }}</h3>
            <span class="spacer"></span>
            <div class="seg" v-if="!single">
              <button type="button" :class="{ active: trendView === 'chart' }" @click="trendView = 'chart'">图表</button>
              <button type="button" :class="{ active: trendView === 'table' }" @click="trendView = 'table'">表格</button>
            </div>
          </div>
          <template v-if="single">
            <div v-if="hours.empty" class="empty">这一天还没有收件</div>
            <ColumnChart v-else :labels="hours.labels" :values="hours.values" :color="SERIES[0]" name="单收件"
              :label-every="screen.mobile ? 6 : 3" :format-x="h => h + '时'" :format-title="h => h + ':00–' + (h + 1) + ':00'"/>
          </template>
          <template v-else-if="trendView === 'chart'">
            <div v-if="trend.empty" class="empty">这段时间没有数据</div>
            <LineChart v-else :labels="trend.labels" :series="trend.series" unit="单" :height="screen.mobile ? 230 : 300" :format-x="formatX" :format-title="formatTitle"/>
          </template>
          <div v-else class="table-wrap" style="max-height:320px">
            <table class="table">
              <thead><tr><th>日期</th><th class="num">收件单数</th><th class="num">收件件数</th><th class="num">取件单数</th><th v-if="enablePrice" class="num">营业额</th></tr></thead>
              <tbody>
                <tr v-for="t in data.trend" :key="t.key">
                  <td>{{ formatTitle(t.key) }}</td>
                  <td class="num">{{ t.received_orders }}</td>
                  <td class="num">{{ t.received_qty }}</td>
                  <td class="num">{{ t.picked_orders }}</td>
                  <td v-if="enablePrice" class="num">{{ money(t.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>品类分布</h3><span class="muted small">按收件件数</span></div>
          <BarList v-if="catRows.length" :rows="catRows" :color="SERIES[0]"/>
          <div v-else class="empty">这段时间没有收件</div>
        </section>
      </div>

      <div class="chart-grid" :style="single ? 'grid-template-columns:1fr' : ''">
        <section class="card" v-if="!single">
          <div class="card-head"><h3>各时段收件单数</h3><span class="muted small">看看什么时候最忙</span></div>
          <div v-if="hours.empty" class="empty">这段时间没有收件</div>
          <ColumnChart v-else :labels="hours.labels" :values="hours.values" :color="SERIES[0]" name="单收件"
            :label-every="screen.mobile ? 6 : 3" :format-x="h => h + '时'" :format-title="h => h + ':00–' + (h + 1) + ':00'"/>
        </section>
        <section class="card flush">
          <div class="card-head"><h3>店员业绩</h3></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>店员</th><th class="num">开单数</th><th class="num">收件件数</th><th class="num">取件单数</th></tr></thead>
              <tbody>
                <tr v-for="u in data.staff" :key="u.id">
                  <td>{{ u.display_name }} <span class="muted small">{{ u.role === 'manager' ? '店长' : '店员' }}</span></td>
                  <td class="num">{{ u.created_orders }}</td>
                  <td class="num">{{ u.created_qty }}</td>
                  <td class="num">{{ u.picked_orders }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
    <div v-else class="card empty">{{ loading ? '加载中…' : '暂无数据' }}</div>
  </div>`,
};
