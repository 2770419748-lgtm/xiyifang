import { api } from '../api.js';
import { quotaUnit } from '../components/member.js';
import { buildPages, fitText, isTurned, printPages, sampleOrder, tagSize } from '../print.js';
import { store } from '../store.js';
import { toast, toastError } from '../ui.js';

const { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } = Vue;

// 编号、姓名的默认位置和字号（与服务器默认值一致）
const DEFAULT_TAG = { code: { x: 50, y: 34, size: 7 }, name: { x: 50, y: 68, size: 7.5 } };
const TAG_ITEMS = [
  { key: 'code', label: '编号' },
  { key: 'name', label: '姓名' },
];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round1 = (v) => Math.round(v * 10) / 10;

const clone = (o) => JSON.parse(JSON.stringify(o));

export default {
  setup() {
    const s = reactive(clone(store.settings));
    if (!Array.isArray(s.package_quotas)) s.package_quotas = [];
    const saving = ref(false);

    // 包期额度：每项可以放多个品类，合并计算；一个品类只能放在一项里
    const ownerOf = (id) => s.package_quotas.findIndex((g) => g.category_ids.includes(id));
    function toggleCat(g, id) {
      const i = g.category_ids.indexOf(id);
      if (i >= 0) g.category_ids.splice(i, 1);
      else g.category_ids.push(id);
    }
    const unitOfQuota = (g) => quotaUnit(store.categories.filter((c) => g.category_ids.includes(c.id)));
    const addQuota = () => s.package_quotas.push({ category_ids: [], limit: 1 });
    const removeQuota = (i) => s.package_quotas.splice(i, 1);

    // 布带标签编辑：编号、姓名可拖动调整位置（按剪下后横着看的方向），字号分开调
    const sample = sampleOrder();
    const textOf = (key) => (key === 'code' ? sample.customer_code : sample.customer_name);
    const tagEl = ref(null);
    const wrapEl = ref(null);
    const wrapW = ref(400);
    const selected = ref('code');
    const dragging = ref(null);
    const turned = computed(() => isTurned(s.label));
    const size = computed(() => tagSize(s.label));
    // 编辑区每毫米多少像素：按编辑区宽度放大显示
    const k = computed(() => Math.min(14, Math.min(wrapW.value, 460) / Math.max(size.value.w, 1), 340 / Math.max(size.value.h, 1)));

    let ro = null;
    onMounted(() => {
      ro = new ResizeObserver(([e]) => (wrapW.value = e.contentRect.width));
      if (wrapEl.value) ro.observe(wrapEl.value);
    });
    onBeforeUnmount(() => ro?.disconnect());

    // 与打印时相同：中心点在 (x%, y%)，最大宽度按离左右两边的距离算
    function itemStyle(key) {
      const p = s.label[key];
      const room = 2 * Math.min(p.x, 100 - p.x);
      return { left: `${p.x}%`, top: `${p.y}%`, fontSize: `${p.size * k.value}px`, maxWidth: `calc(${room}% - ${k.value}px)` };
    }

    // 过长的编号、姓名和打印时一样自动缩小
    watch(
      [() => s.label, k],
      async () => {
        await nextTick();
        if (!tagEl.value) return;
        for (const el of tagEl.value.querySelectorAll('.tg-item')) el.style.fontSize = `${s.label[el.dataset.key].size * k.value}px`;
        fitText(tagEl.value);
      },
      { deep: true, immediate: true, flush: 'post' },
    );

    // 拖动：记下按下时指针和中心点的偏移，移动时保持不变；拖到水平中线附近自动居中
    let drag = null;
    function startDrag(key, e) {
      selected.value = key;
      e.currentTarget.focus();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const rect = tagEl.value.getBoundingClientRect();
      const p = s.label[key];
      drag = { key, rect, dx: e.clientX - rect.left - (p.x / 100) * rect.width, dy: e.clientY - rect.top - (p.y / 100) * rect.height };
      dragging.value = key;
    }
    function onDrag(e) {
      if (!drag) return;
      const { key, rect, dx, dy } = drag;
      const x = ((e.clientX - rect.left - dx) / rect.width) * 100;
      const y = ((e.clientY - rect.top - dy) / rect.height) * 100;
      s.label[key].x = round1(clamp(Math.abs(x - 50) < 2 ? 50 : x, 0, 100));
      s.label[key].y = round1(clamp(y, 0, 100));
    }
    function endDrag() {
      drag = null;
      dragging.value = null;
    }
    const showGuide = computed(() => dragging.value && s.label[dragging.value].x === 50);

    // 选中后用方向键微调，按住 Shift 移动更多
    function nudge(key, e) {
      const step = e.shiftKey ? 5 : 0.5;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      const p = s.label[key];
      p.x = round1(clamp(p.x + d[0], 0, 100));
      p.y = round1(clamp(p.y + d[1], 0, 100));
    }

    function centerAll() {
      s.label.code.x = 50;
      s.label.name.x = 50;
    }
    const resetTag = () => Object.assign(s.label, clone(DEFAULT_TAG));

    async function save() {
      saving.value = true;
      try {
        const r = await api.put('/settings', s);
        store.settings = r;
        store.shopName = r.shop_name;
        Object.assign(s, clone(r));
        toast('设置已保存', 'success');
      } catch (e) {
        toastError(e);
      } finally {
        saving.value = false;
      }
    }

    // 按当前设置（未保存也可以）打印一张测试
    function testPrint() {
      printPages(buildPages(sample, s, { kind: 'piece', piece: 1 }), s);
    }

    return {
      s,
      saving,
      store,
      ownerOf,
      toggleCat,
      unitOfQuota,
      addQuota,
      removeQuota,
      TAG_ITEMS,
      textOf,
      tagEl,
      wrapEl,
      selected,
      dragging,
      turned,
      size,
      k,
      itemStyle,
      startDrag,
      onDrag,
      endDrag,
      showGuide,
      nudge,
      centerAll,
      resetTag,
      save,
      testPrint,
      backupHref: api.href('/settings/backup'),
    };
  },
  template: `
  <div class="page has-action-bar">
    <section class="card">
      <div class="card-head"><h3>基本设置</h3></div>
      <div class="form-grid">
        <label class="field"><span>店铺名称</span><input v-model="s.shop_name" maxlength="30"></label>
        <label class="field"><span>超期提醒（送来满几天未取算超期）</span><input v-model.number="s.overdue_days" type="number" min="1" max="365"></label>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>开单设置</h3></div>
      <div class="setting-row">
        <div class="desc"><b>启用金额</b><div class="muted">开启后可在“品类管理”设置单价，开单时自动计算金额，经营数据中统计营业额</div></div>
        <Toggle v-model="s.enable_price"/>
      </div>
      <div class="setting-row">
        <div class="desc"><b>开单后弹出打印选项</b><div class="muted">开单成功后弹出“全部打印 / 打印单张（点一下打一张）”。每台设备的打印方式可在“我的 → 本机打印方式”中单独设置</div></div>
        <Toggle v-model="s.auto_print"/>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>包期会员</h3></div>
      <p class="muted small" style="margin:0 0 14px">
        <span>每周从周一到周日，按送来时间计算。同一项额度里的品类合并计算，例如衣物和浴巾放在一项、每周 9 件，两样加起来超过 9 件就算超额；没放进任何一项的品类不在包期内。</span>
        <span>开单时不提示超额，店长在“客户管理 → 包期会员”里按周查看，超额的会员排在最前面。开启金额时，包期会员开单时包期内的品类不收费，其他品类按单价计算。</span>
        <span>学期结束时，到“客户管理”点击“学期结束”，输入登录密码后一键清除包期会员。</span>
      </p>
      <div class="quota-list">
        <div v-for="(g, i) in s.package_quotas" :key="i" class="quota-item">
          <div class="quota-item-head">
            <b>额度 {{ i + 1 }}</b>
            <span class="muted small">点选这一项包含的品类</span>
            <span class="spacer"></span>
            <button type="button" class="btn sm" @click="removeQuota(i)"><Icon name="trash" :size="14"/>删除</button>
          </div>
          <div class="cat-chips">
            <button v-for="c in store.categories" :key="c.id" type="button" class="cat-chip"
              :class="{ on: g.category_ids.includes(c.id) }"
              :disabled="ownerOf(c.id) >= 0 && ownerOf(c.id) !== i"
              :title="ownerOf(c.id) >= 0 && ownerOf(c.id) !== i ? '已在额度 ' + (ownerOf(c.id) + 1) + ' 里' : ''"
              @click="toggleCat(g, c.id)">{{ c.name }}</button>
          </div>
          <label class="quota-limit">
            每周合计不超过
            <input v-model.number="g.limit" class="input" type="number" min="0" max="999" inputmode="numeric">
            {{ unitOfQuota(g) }}
          </label>
        </div>
        <button type="button" class="btn" @click="addQuota"><Icon name="plus" :size="16"/>添加一项额度</button>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>标签打印（水洗唛布带）</h3></div>
      <div class="two-col">
        <div class="form-stack">
          <div class="customer-inputs">
            <label class="field"><span>布带宽度（毫米）</span><input v-model.number="s.label.width" type="number" min="10" max="110"></label>
            <label class="field"><span>每张长度（毫米）</span><input v-model.number="s.label.height" type="number" min="10" max="200"></label>
          </div>
          <div v-for="it in TAG_ITEMS" :key="it.key" class="size-row">
            <div class="size-head"><span>{{ it.label }}字号</span><b>{{ s.label[it.key].size }} 毫米</b></div>
            <input type="range" min="3" max="20" step="0.5" v-model.number="s.label[it.key].size" :aria-label="it.label + '字号'">
          </div>
          <label class="field"><span>每张打印份数 <span class="hint">全部打印、整单时</span></span><input v-model.number="s.label.copies" type="number" min="1" max="10"></label>
          <label class="check"><input type="checkbox" v-model="s.label.cut_line">每张末尾打一条裁切虚线（整卷布带不分段时用，沿虚线剪开）</label>
          <p class="muted small" style="margin:0">打印机驱动的“打印首选项”里：纸张设成宽 {{ s.label.width }}mm × 高 {{ s.label.height }}mm，介质类型选“连续”，打印方式选“热转印”。</p>
        </div>
        <div class="form-stack">
          <div ref="wrapEl" class="tag-editor-wrap">
            <div ref="tagEl" class="tag-editor" :class="{ 'cut-end': s.label.cut_line && turned, 'cut-bottom': s.label.cut_line && !turned }"
              :style="{ width: size.w * k + 'px', height: size.h * k + 'px' }" @pointermove="onDrag" @pointerup="endDrag" @pointercancel="endDrag">
              <div v-if="showGuide" class="tag-guide"></div>
              <div v-for="it in TAG_ITEMS" :key="it.key" class="tg-item fit" :data-key="it.key" tabindex="0"
                :class="{ sel: selected === it.key, dragging: dragging === it.key }" :style="itemStyle(it.key)" :title="'拖动调整' + it.label + '的位置'"
                @pointerdown.prevent="startDrag(it.key, $event)" @focus="selected = it.key" @keydown="nudge(it.key, $event)">{{ textOf(it.key) }}</div>
            </div>
          </div>
          <p class="muted small" style="margin:0">
            用鼠标或手指拖动编号、姓名调整打印位置；点一下选中后也可以用方向键微调（按住 Shift 移动更多）。<template v-if="turned">布带竖着走纸，打印时文字会自动转 90°，这里显示的是剪下后横着看的样子。</template>
          </p>
          <div class="btn-row">
            <button type="button" class="btn" @click="centerAll">水平居中</button>
            <button type="button" class="btn" @click="resetTag">恢复默认位置</button>
            <button type="button" class="btn" @click="testPrint"><Icon name="printer" :size="16"/>打印一张测试</button>
          </div>
          <p class="muted small" style="margin:0">调整满意后记得点击下方“保存设置”。</p>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>数据备份</h3></div>
      <div class="setting-row">
        <div class="desc">
          <b>下载完整数据备份</b>
          <div class="muted">系统每天自动在服务器的 data/backups 目录备份一次，保留 30 天。建议每周下载一份保存到 U 盘或网盘。</div>
        </div>
        <a class="btn" :href="backupHref"><Icon name="download" :size="16"/>下载备份</a>
      </div>
    </section>

    <div class="action-bar">
      <div class="summary muted">修改后请保存</div>
      <button type="button" class="btn primary lg" :disabled="saving" @click="save"><Icon name="check" :size="18"/>保存设置</button>
    </div>
  </div>`,
};
