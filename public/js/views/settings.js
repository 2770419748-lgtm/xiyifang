import { api } from '../api.js';
import { quotaUnit } from '../components/member.js';
import { buildPages, fitText, printPages, sampleOrder } from '../print.js';
import { store } from '../store.js';
import { toast, toastError } from '../ui.js';

const { computed, nextTick, reactive, ref, watch } = Vue;

const PAPERS = [
  { key: '40x30', label: '不干胶标签 40×30mm', width: 40, height: 30 },
  { key: '50x30', label: '不干胶标签 50×30mm', width: 50, height: 30 },
  { key: '60x40', label: '不干胶标签 60×40mm', width: 60, height: 40 },
  { key: '70x50', label: '不干胶标签 70×50mm', width: 70, height: 50 },
  { key: 'r58', label: '热敏小票 58mm', width: 58, height: 0 },
  { key: 'r80', label: '热敏小票 80mm', width: 80, height: 0 },
];

const FIELDS = [
  { key: 'show_shop', label: '店铺名称' },
  { key: 'show_time', label: '送来时间' },
  { key: 'show_items', label: '物品明细' },
  { key: 'show_order_no', label: '单号和件数' },
  { key: 'show_note', label: '备注' },
];

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
    const previewEl = ref(null);
    const findPaper = () => PAPERS.find((p) => p.width === s.label.width && p.height === s.label.height)?.key || 'custom';
    const paperSel = ref(findPaper());

    function onPaper() {
      const p = PAPERS.find((x) => x.key === paperSel.value);
      if (p) Object.assign(s.label, { width: p.width, height: p.height });
    }

    const isReceipt = computed(() => !Number(s.label.height));
    // 预览：单件标签（全部打印、打印单张用）或整单标签（小票纸为取件小票）
    const previewKind = ref('piece');
    const previewJob = computed(() => (previewKind.value === 'piece' ? { kind: 'piece', piece: 1 } : { kind: 'order' }));
    const previewHTML = computed(() => buildPages(sampleOrder(), s, previewJob.value)[0]);
    const previewZoom = computed(() => (isReceipt.value ? 1.2 : Math.min(3, 300 / (s.label.width * 3.78))));

    watch(
      previewHTML,
      async () => {
        await nextTick();
        if (previewEl.value) fitText(previewEl.value);
      },
      { immediate: true, flush: 'post' },
    );

    async function save() {
      saving.value = true;
      try {
        const r = await api.put('/settings', s);
        store.settings = r;
        store.shopName = r.shop_name;
        Object.assign(s, clone(r));
        paperSel.value = findPaper();
        toast('设置已保存', 'success');
      } catch (e) {
        toastError(e);
      } finally {
        saving.value = false;
      }
    }

    // 测试打印当前预览的那一张
    function testPrint() {
      printPages(buildPages(sampleOrder(), s, previewJob.value).slice(0, 1), s);
    }

    return {
      s,
      saving,
      previewEl,
      paperSel,
      PAPERS,
      FIELDS,
      store,
      ownerOf,
      toggleCat,
      unitOfQuota,
      addQuota,
      removeQuota,
      isReceipt,
      previewKind,
      previewHTML,
      previewZoom,
      onPaper,
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
      <div class="card-head"><h3>标签打印</h3></div>
      <div class="two-col">
        <div class="form-stack">
          <label class="field">
            <span>纸张</span>
            <select v-model="paperSel" @change="onPaper">
              <option v-for="p in PAPERS" :key="p.key" :value="p.key">{{ p.label }}</option>
              <option value="custom">自定义尺寸</option>
            </select>
          </label>
          <div class="customer-inputs" v-if="paperSel === 'custom'">
            <label class="field"><span>宽度（毫米）</span><input v-model.number="s.label.width" type="number" min="20" max="120"></label>
            <label class="field"><span>高度（毫米，0 = 小票）</span><input v-model.number="s.label.height" type="number" min="0" max="200"></label>
          </div>
          <div class="customer-inputs">
            <label class="field"><span>每张打印份数 <span class="hint">全部打印、整单时</span></span><input v-model.number="s.label.copies" type="number" min="1" max="10"></label>
            <label class="field">
              <span>字体大小</span>
              <select v-model.number="s.label.font_scale">
                <option :value="0.8">小</option>
                <option :value="0.9">较小</option>
                <option :value="1">标准</option>
                <option :value="1.15">较大</option>
                <option :value="1.3">大</option>
              </select>
            </label>
          </div>
          <label class="field"><span>页边距（毫米）</span><input v-model.number="s.label.padding" type="number" min="0" max="10" step="0.5"></label>
          <div class="field">
            <span>打印内容 <span class="hint">姓名和编码始终打印</span></span>
            <div class="row wrap" style="gap:14px">
              <label v-for="f in FIELDS" :key="f.key" class="check"><input type="checkbox" v-model="s.label[f.key]">{{ f.label }}</label>
            </div>
          </div>
        </div>
        <div class="form-stack">
          <div class="seg" style="align-self:flex-start">
            <button type="button" :class="{ active: previewKind === 'piece' }" @click="previewKind = 'piece'">单件标签</button>
            <button type="button" :class="{ active: previewKind === 'order' }" @click="previewKind = 'order'">{{ isReceipt ? '整单取件小票' : '整单汇总标签' }}</button>
          </div>
          <div class="label-preview-wrap">
            <div ref="previewEl" class="label-preview" :style="{ zoom: previewZoom }" v-html="previewHTML"></div>
          </div>
          <button type="button" class="btn" @click="testPrint"><Icon name="printer" :size="16"/>按当前设置打印一张测试</button>
          <p class="muted small" style="margin:0">开单后的“全部打印”“打印单张”使用单件标签（每件衣物一张）；整单标签可在打印窗口中选择。预览为放大显示，测试满意后记得点击下方“保存设置”。</p>
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
