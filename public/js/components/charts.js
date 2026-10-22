// 轻量 SVG 图表：折线（趋势）、柱状（时段）、横向条形（品类）
// 规范：细线 2px、柱宽 ≤ 24px 顶部 4px 圆角、网格为浅色细实线、悬停有提示、文字使用文字色而非系列色
const { computed, onBeforeUnmount, onMounted, ref } = Vue;

// 系列色（已通过色盲区分度与对比度校验），SVG 属性里不能用 CSS 变量，所以直接写色值
export const SERIES = ['#2a78d6', '#eb6834'];
const GRID = '#ecebe6';
const AXIS = '#c3c2b7';

function useWidth() {
  const el = ref(null);
  const width = ref(0);
  let ro;
  onMounted(() => {
    width.value = el.value.clientWidth;
    ro = new ResizeObserver(([entry]) => {
      width.value = Math.floor(entry.contentRect.width);
    });
    ro.observe(el.value);
  });
  onBeforeUnmount(() => ro?.disconnect());
  return { el, width };
}

function niceStep(raw) {
  if (raw <= 1) return 1;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function yScale(max, count = 4) {
  const step = niceStep(max / count);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

const fmtTick = (v) => (v >= 10000 ? `${+(v / 10000).toFixed(1)}万` : String(v));

/** 多系列折线图 series: [{ name, color, values }] */
export const LineChart = {
  props: {
    labels: { type: Array, required: true },
    series: { type: Array, required: true },
    formatX: { type: Function, default: (k) => k },
    formatTitle: { type: Function, default: (k) => k },
    unit: { type: String, default: '' },
    height: { type: Number, default: 240 },
  },
  setup(props) {
    const { el, width } = useWidth();
    const hover = ref(-1);

    const L = computed(() => {
      const W = width.value;
      const H = props.height;
      const n = props.labels.length;
      const max = Math.max(0, ...props.series.flatMap((s) => s.values));
      const { top, ticks } = yScale(max);
      const pad = { l: Math.max(...ticks.map((t) => fmtTick(t).length)) * 7 + 12, r: 34, t: 14, b: 28 };
      const pw = Math.max(10, W - pad.l - pad.r);
      const ph = H - pad.t - pad.b;
      const x = (i) => pad.l + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
      const y = (v) => pad.t + ph - (v / top) * ph;
      const lines = props.series.map((s) => ({
        ...s,
        d: s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''),
        endY: y(s.values[n - 1] ?? 0),
        end: s.values[n - 1] ?? 0,
      }));
      // 末端数值标签：相互太近就不显示（由图例和悬停提示承担）
      const ys = lines.map((s) => s.endY).sort((a, b) => a - b);
      const endLabels = ys.every((v, i) => i === 0 || v - ys[i - 1] >= 14);
      const maxLabels = Math.max(2, Math.floor(pw / 56));
      const step = Math.ceil(n / maxLabels);
      const xLabels = [];
      for (let i = 0; i < n; i += step) xLabels.push({ i, x: x(i), text: props.formatX(props.labels[i]) });
      return { W, H, n, pad, pw, ph, x, y, ticks, lines, endLabels, xLabels };
    });

    function onMove(e) {
      const { n, pad, pw } = L.value;
      const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
      const i = n <= 1 ? 0 : Math.round(((px - pad.l) / pw) * (n - 1));
      hover.value = Math.min(n - 1, Math.max(0, i));
    }

    function onKey(e) {
      const n = L.value.n;
      if (e.key === 'ArrowRight') hover.value = Math.min(n - 1, hover.value + 1);
      else if (e.key === 'ArrowLeft') hover.value = Math.max(0, hover.value - 1);
    }

    const tipStyle = computed(() => {
      const { x, W, pad } = L.value;
      const px = x(hover.value);
      const left = px + 160 > W ? px - 150 : px + 12;
      return { left: `${Math.max(0, left)}px`, top: `${pad.t}px` };
    });

    return { el, width, hover, L, onMove, onKey, tipStyle, fmtTick, AXIS, GRID };
  },
  template: `
  <div class="chart" ref="el">
    <div class="legend" v-if="series.length > 1" style="margin-bottom:8px">
      <span v-for="s in series" :key="s.name"><i class="key-line" :style="{ background: s.color }"></i>{{ s.name }}</span>
    </div>
    <svg v-if="width" :width="L.W" :height="L.H" role="img" @pointermove="onMove" @pointerleave="hover = -1">
      <g v-for="t in L.ticks" :key="'t' + t">
        <line :x1="L.pad.l" :x2="L.W - L.pad.r" :y1="L.y(t)" :y2="L.y(t)" :stroke="t === 0 ? AXIS : GRID" shape-rendering="crispEdges"/>
        <text :x="L.pad.l - 8" :y="L.y(t) + 4" text-anchor="end" class="num">{{ fmtTick(t) }}</text>
      </g>
      <text v-for="l in L.xLabels" :key="'x' + l.i" :x="l.x" :y="L.H - 8" text-anchor="middle">{{ l.text }}</text>
      <line v-if="hover >= 0" :x1="L.x(hover)" :x2="L.x(hover)" :y1="L.pad.t" :y2="L.pad.t + L.ph" :stroke="AXIS" shape-rendering="crispEdges"/>
      <path v-for="s in L.lines" :key="'p' + s.name" :d="s.d" fill="none" :stroke="s.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <g v-if="hover < 0">
        <g v-for="s in L.lines" :key="'e' + s.name">
          <circle :cx="L.x(L.n - 1)" :cy="s.endY" r="4" :fill="s.color" stroke="#fff" stroke-width="2"/>
          <text v-if="L.endLabels" class="end-label num" :x="L.x(L.n - 1) + 8" :y="s.endY + 4">{{ s.end }}</text>
        </g>
      </g>
      <g v-else>
        <circle v-for="s in L.lines" :key="'h' + s.name" :cx="L.x(hover)" :cy="L.y(s.values[hover])" r="4" :fill="s.color" stroke="#fff" stroke-width="2"/>
      </g>
      <rect class="hit" :x="L.pad.l - 12" y="0" :width="L.pw + 24" :height="L.H" tabindex="0"
        aria-label="趋势图，可用左右方向键查看每天数据" @keydown="onKey" @focus="hover = L.n - 1" @blur="hover = -1"/>
    </svg>
    <div v-if="hover >= 0" class="chart-tip" :style="tipStyle">
      <div class="tip-title">{{ formatTitle(labels[hover]) }}</div>
      <div class="tip-row" v-for="s in series" :key="s.name">
        <i class="key-line" :style="{ background: s.color }"></i><b class="num">{{ s.values[hover] }}</b><span>{{ s.name }}{{ unit }}</span>
      </div>
    </div>
  </div>`,
};

/** 单系列柱状图 */
export const ColumnChart = {
  props: {
    labels: { type: Array, required: true },
    values: { type: Array, required: true },
    color: { type: String, default: SERIES[0] },
    formatX: { type: Function, default: (k) => k },
    formatTitle: { type: Function, default: (k) => k },
    name: { type: String, default: '' },
    labelEvery: { type: Number, default: 1 },
    height: { type: Number, default: 200 },
  },
  setup(props) {
    const { el, width } = useWidth();
    const hover = ref(-1);

    const L = computed(() => {
      const W = width.value;
      const H = props.height;
      const n = props.values.length;
      const max = Math.max(0, ...props.values);
      const { top, ticks } = yScale(max);
      const pad = { l: Math.max(...ticks.map((t) => fmtTick(t).length)) * 7 + 12, r: 8, t: 20, b: 26 };
      const pw = Math.max(10, W - pad.l - pad.r);
      const ph = H - pad.t - pad.b;
      const slot = pw / n;
      const bw = Math.max(2, Math.min(24, slot * 0.62));
      const base = pad.t + ph;
      const maxIdx = max > 0 ? props.values.indexOf(max) : -1;
      const bars = props.values.map((v, i) => {
        const h = (v / top) * ph;
        const x = pad.l + i * slot + (slot - bw) / 2;
        const yTop = base - h;
        const r = Math.min(4, h, bw / 2);
        // 顶部圆角、底部直角
        const d =
          h <= 0
            ? ''
            : `M${x},${base}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + bw - r}Q${x + bw},${yTop} ${x + bw},${yTop + r}V${base}Z`;
        return { i, v, x, bw, yTop, d, cx: x + bw / 2, slotX: pad.l + i * slot, slot };
      });
      const y = (v) => base - (v / top) * ph;
      return { W, H, pad, pw, ph, base, ticks, bars, y, maxIdx };
    });

    const tipStyle = computed(() => {
      const b = L.value.bars[hover.value];
      if (!b) return {};
      const left = Math.min(Math.max(0, b.cx - 60), L.value.W - 130);
      return { left: `${left}px`, top: `${Math.max(0, b.yTop - 62)}px` };
    });

    return { el, width, hover, L, tipStyle, fmtTick, AXIS, GRID };
  },
  template: `
  <div class="chart" ref="el">
    <svg v-if="width" :width="L.W" :height="L.H" role="img" @pointerleave="hover = -1">
      <g v-for="t in L.ticks" :key="'t' + t">
        <line :x1="L.pad.l" :x2="L.W - L.pad.r" :y1="L.y(t)" :y2="L.y(t)" :stroke="t === 0 ? AXIS : GRID" shape-rendering="crispEdges"/>
        <text :x="L.pad.l - 8" :y="L.y(t) + 4" text-anchor="end" class="num">{{ fmtTick(t) }}</text>
      </g>
      <g v-for="b in L.bars" :key="b.i">
        <path v-if="b.d" :d="b.d" :fill="color" :opacity="hover >= 0 && hover !== b.i ? 0.55 : 1"/>
        <text v-if="b.i % labelEvery === 0" :x="b.cx" :y="L.H - 8" text-anchor="middle">{{ formatX(labels[b.i]) }}</text>
        <text v-if="b.i === L.maxIdx && hover < 0" class="end-label num" :x="b.cx" :y="b.yTop - 6" text-anchor="middle">{{ b.v }}</text>
        <rect class="bar-hit" :x="b.slotX" :y="L.pad.t" :width="b.slot" :height="L.ph" tabindex="0"
          :aria-label="formatTitle(labels[b.i]) + ' ' + b.v"
          @pointerenter="hover = b.i" @focus="hover = b.i" @blur="hover = -1"/>
      </g>
    </svg>
    <div v-if="hover >= 0" class="chart-tip" :style="tipStyle">
      <div class="tip-title">{{ formatTitle(labels[hover]) }}</div>
      <div class="tip-row"><i class="key-rect" :style="{ background: color }"></i><b class="num">{{ values[hover] }}</b><span>{{ name }}</span></div>
    </div>
  </div>`,
};

/** 横向条形列表（数值直接标在条形末端） rows: [{ key, name, value, sub, title }] */
export const BarList = {
  props: {
    rows: { type: Array, required: true },
    color: { type: String, default: SERIES[0] },
  },
  setup(props) {
    const max = computed(() => Math.max(1, ...props.rows.map((r) => r.value)));
    return { max };
  },
  template: `
  <div class="bar-list">
    <div v-for="r in rows" :key="r.key" class="bar-row" tabindex="0" :title="r.title">
      <span class="name">{{ r.name }}</span>
      <div class="bar-track"><div class="bar-fill" :style="{ width: (r.value / max * 100) + '%', background: color }"></div></div>
      <span class="val">{{ r.value }}<small v-if="r.sub">{{ r.sub }}</small></span>
    </div>
  </div>`,
};
