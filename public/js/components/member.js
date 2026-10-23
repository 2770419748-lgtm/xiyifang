// 包期会员：每周额度面板（客户详情页）
const { computed } = Vue;

const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
export const weekText = (week) => `${md(week.start)}（周一）至 ${md(week.end)}（周日）`;

// 一项额度的单位：全是鞋子按“双”，否则按“件”
export const quotaUnit = (cats) => (cats.length && cats.every((c) => c.name.includes('鞋')) ? '双' : '件');

/**
 * 系统设置里的包期额度 → [{ name: '衣物+浴巾', unit: '件', limit: 9 }]（与服务器的 packageQuotas 一致）
 * 同一项里的品类合并计算
 */
export function quotaList(quotas, categories) {
  return (quotas || [])
    .map((g) => {
      const cats = categories.filter((c) => g.category_ids.includes(c.id));
      return { name: cats.map((c) => c.name).join('+'), unit: quotaUnit(cats), limit: g.limit };
    })
    .filter((g) => g.name);
}

/**
 * 本周额度面板
 * usage：接口 /customers/:id/package-usage 的返回
 */
export const PackageQuota = {
  props: { usage: { type: Object, required: true } },
  setup(props) {
    const rows = computed(() => props.usage.items.map((i) => ({ ...i, over: Math.max(0, i.used - i.limit) })));
    const anyOver = computed(() => rows.value.some((r) => r.over > 0));
    const range = computed(() => weekText(props.usage.week));
    const pct = (r) => (r.limit ? Math.min(100, (r.used / r.limit) * 100) : r.used ? 100 : 0);
    return { rows, anyOver, range, pct };
  },
  template: `
  <div class="quota" :class="{ over: anyOver }">
    <div class="quota-head">
      <b>本周额度</b>
      <span class="muted small">{{ range }}，按送来时间计算</span>
    </div>
    <div v-if="!rows.length" class="muted small">还没有设置每周额度（系统设置 → 包期会员）</div>
    <div v-for="r in rows" :key="r.name" class="quota-row" :class="{ over: r.over }">
      <span class="q-name">{{ r.name }}</span>
      <div class="q-track"><div class="q-fill" :style="{ width: pct(r) + '%' }"></div></div>
      <span class="q-num">已送 {{ r.used }} / {{ r.limit }} {{ r.unit }}</span>
      <span v-if="r.over" class="tag danger">超出 {{ r.over }} {{ r.unit }}</span>
      <span v-else-if="r.limit && r.used >= r.limit" class="tag warn plain">已满</span>
    </div>
  </div>`,
};
