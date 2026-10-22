import { api } from '../api.js';
import { dialog, prompt, toast } from '../ui.js';
import { CODE_RE, debounce, firstChar, fmtTime, money } from '../utils.js';

const { computed, nextTick, ref, watch } = Vue;

/**
 * 开单/改单时编码已有其他客户（接口返回 409）：让用户选择是哪一位老客户，或新建客户
 * 返回要合并进请求体的字段，取消返回 null
 */
export function chooseOnCodeConflict(err, newName) {
  const actions = err.data.conflict.map((c) => ({
    text: `${c.name}（${c.code}）`,
    value: { customer_id: c.id },
    primary: true,
  }));
  if (err.data.can_force && newName) actions.push({ text: `新建客户「${newName}」`, value: { force_new: true } });
  return dialog({ title: '请选择客户', message: `${err.message}，请选择：`, actions });
}

export const isCodeConflict = (err) => err?.status === 409 && Array.isArray(err.data?.conflict);

/**
 * 客户选择：输入编码或姓名，联想出老客户；不选则按新客户处理
 * 编码可以重复：输完编码后，如果这个编码有多位客户，会弹出姓名让店员选择，也可以选“新客户”
 * v-model: { id, name, code, pending_count, isNew }
 *   id 有值 = 选中了老客户；isNew = 明确选择了“用这个编码登记新客户”
 */
export const CustomerPicker = {
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  setup(props, { emit, expose }) {
    const codeEl = ref(null);
    const nameEl = ref(null);
    const suggestions = ref([]);
    const open = ref(false);
    const active = ref(-1);
    const codeTouched = ref(false);
    const chooser = ref(null); // { code, list }：同一编码的多位客户
    let askedCode = ''; // 已经检查过的编码，避免反复弹窗
    let seq = 0;

    const codeError = computed(() => {
      const c = props.modelValue.code;
      if (!codeTouched.value || !c) return '';
      return CODE_RE.test(c) ? '' : '编码需为 4 位或 6 位数字';
    });

    const update = (patch) => emit('update:modelValue', { ...props.modelValue, id: null, ...patch });

    // 编码变了（包括开单后表单清空）就允许重新询问
    watch(
      () => props.modelValue.code,
      (code) => {
        if (code !== askedCode) askedCode = '';
      },
    );

    const search = debounce(async (kw) => {
      const mine = ++seq;
      if (!kw) {
        suggestions.value = [];
        return;
      }
      try {
        const rows = await api.get('/customers/search', { q: kw });
        if (mine !== seq) return;
        suggestions.value = rows;
        // 编码只对应一位客户时才默认高亮，回车直接选中；多位客户时要店员自己选
        const typed = props.modelValue.code;
        const exact = rows.filter((c) => c.code === typed || c.base_code === typed);
        active.value = exact.length === 1 ? rows.indexOf(exact[0]) : -1;
      } catch {
        // 联想失败不影响开单
      }
    }, 200);

    // 编码输完后：如果这个编码有多位客户，弹出姓名选择
    async function checkCode() {
      const code = props.modelValue.code;
      if (!CODE_RE.test(code) || props.modelValue.id || props.modelValue.isNew || askedCode === code) return false;
      askedCode = code;
      try {
        const list = await api.get('/customers/search', { code });
        if (props.modelValue.code !== code || props.modelValue.id) return false;
        if (list.length < 2) return false;
        open.value = false;
        chooser.value = { code, list };
        return true;
      } catch {
        return false;
      }
    }

    function onCode(e) {
      const v = e.target.value.replace(/\D/g, '').slice(0, 6);
      if (v !== e.target.value) e.target.value = v;
      update({ code: v, isNew: false });
      open.value = true;
      search(v);
    }

    function onName(e) {
      update({ name: e.target.value });
      open.value = true;
      search(e.target.value.trim());
    }

    function pick(c) {
      emit('update:modelValue', {
        id: c.id,
        name: c.name,
        code: c.code,
        member_type: c.member_type,
        pending_count: c.pending_count,
      });
      open.value = false;
      suggestions.value = [];
      chooser.value = null;
    }

    // 弹窗里选“新客户”：保留编码，填写姓名
    function chooseNew() {
      const { code } = chooser.value;
      chooser.value = null;
      emit('update:modelValue', { id: null, name: '', code, isNew: true });
      nextTick(() => nameEl.value?.focus());
    }

    function clear() {
      emit('update:modelValue', { id: null, name: '', code: '' });
      codeTouched.value = false;
      askedCode = '';
      nextTick(() => codeEl.value?.focus());
    }

    function onKey(e) {
      const n = suggestions.value.length;
      if (open.value && n) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          active.value = (active.value + 1) % n;
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          active.value = (active.value - 1 + n) % n;
          return;
        }
        if (e.key === 'Escape') {
          open.value = false;
          return;
        }
        if (e.key === 'Enter' && active.value >= 0) {
          e.preventDefault();
          pick(suggestions.value[active.value]);
          return;
        }
      }
      // 编码框回车：同编码多位客户时弹出选择，否则跳到姓名
      if (e.key === 'Enter' && e.target === codeEl.value) {
        e.preventDefault();
        checkCode().then((shown) => !shown && nameEl.value?.focus());
      }
    }

    const close = () => setTimeout(() => (open.value = false), 150);
    function onCodeBlur() {
      codeTouched.value = true;
      close();
      checkCode();
    }

    expose({ focus: () => codeEl.value?.focus() });
    return {
      codeEl,
      nameEl,
      suggestions,
      open,
      active,
      codeError,
      chooser,
      onCode,
      onName,
      pick,
      chooseNew,
      clear,
      onKey,
      close,
      onCodeBlur,
      firstChar,
      fmtTime,
    };
  },
  template: `
  <div class="customer-picker">
    <div v-if="modelValue.id" class="customer-chip">
      <div class="avatar">{{ firstChar(modelValue.name) }}</div>
      <div class="grow row wrap">
        <span class="name">{{ modelValue.name }}</span>
        <span class="code-badge">{{ modelValue.code }}</span>
        <span v-if="modelValue.member_type === 'package'" class="tag info">包期会员</span>
        <span v-else class="tag plain">老客户</span>
        <span v-if="modelValue.pending_count" class="tag warn">在店 {{ modelValue.pending_count }} 单未取</span>
      </div>
      <button type="button" class="btn sm" @click="clear">更换</button>
    </div>
    <template v-else>
      <div class="customer-inputs">
        <label class="field">
          <span>编码 <span class="hint">4 位或 6 位数字</span></span>
          <input ref="codeEl" class="code-input" :class="{ invalid: codeError }" :value="modelValue.code"
            inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="输入编码" autocomplete="off"
            @input="onCode" @keydown="onKey" @focus="open = true" @blur="onCodeBlur">
          <span class="field-error" v-if="codeError">{{ codeError }}</span>
        </label>
        <label class="field">
          <span>姓名 <span v-if="modelValue.isNew" class="hint">新客户，与老客户共用编码 {{ modelValue.code }}</span></span>
          <input ref="nameEl" :value="modelValue.name" maxlength="30" placeholder="输入姓名" autocomplete="off"
            @input="onName" @keydown="onKey" @focus="open = true" @blur="close">
        </label>
      </div>
      <ul class="suggest" v-if="open && suggestions.length">
        <li class="hint-row">选择老客户（新客户直接填写编码和姓名即可）</li>
        <li v-for="(c, i) in suggestions" :key="c.id" :class="{ active: i === active }"
          @mousedown.prevent @click="pick(c)">
          <div class="avatar">{{ firstChar(c.name) }}</div>
          <div class="grow row"><b>{{ c.name }}</b><span class="code-badge">{{ c.code }}</span>
            <span v-if="c.member_type === 'package'" class="tag info plain">包期</span></div>
          <span v-if="c.pending_count" class="tag warn">在店 {{ c.pending_count }} 单</span>
        </li>
      </ul>
    </template>

    <Modal v-if="chooser" :title="'编码 ' + chooser.code + ' 有 ' + chooser.list.length + ' 位客户'" width="440px" @close="chooser = null">
      <p class="muted small" style="margin:0 0 12px">请选择是哪一位；如果都不是，选“新客户”</p>
      <div class="choose-list">
        <button v-for="c in chooser.list" :key="c.id" type="button" class="choose-item" @click="pick(c)">
          <span class="avatar">{{ firstChar(c.name) }}</span>
          <span class="grow">
            <b>{{ c.name }}<span v-if="c.member_type === 'package'" class="tag info plain" style="margin-left:6px">包期 {{ c.code }}</span></b>
            <span class="muted small">{{ c.last_received_at ? '最近送洗 ' + fmtTime(c.last_received_at) : '还没有送洗记录' }}</span>
          </span>
          <span v-if="c.pending_count" class="tag warn">在店 {{ c.pending_count }} 单</span>
        </button>
      </div>
      <button type="button" class="btn block" style="margin-top:12px" @click="chooseNew">
        <Icon name="plus" :size="16"/>新客户（使用编码 {{ chooser.code }}）
      </button>
    </Modal>
  </div>`,
};

/**
 * 品类选择：点一下数量 +1，点 − 减少，长按可直接输入数量
 * v-model: { [categoryId]: quantity }
 */
export const CategoryPicker = {
  props: {
    modelValue: { type: Object, required: true },
    categories: { type: Array, required: true },
    showPrice: Boolean,
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    function set(id, qty) {
      const next = { ...props.modelValue };
      if (qty > 0) next[id] = qty;
      else delete next[id];
      emit('update:modelValue', next);
    }
    const inc = (c) => set(c.id, Math.min(999, (props.modelValue[c.id] || 0) + 1));
    const dec = (c) => set(c.id, (props.modelValue[c.id] || 0) - 1);
    async function edit(c) {
      const v = await prompt(`「${c.name}」数量`, {
        value: props.modelValue[c.id] || '',
        type: 'number',
        inputmode: 'numeric',
      });
      if (v === null) return;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 999) return toast('请输入 0~999 之间的整数', 'error');
      set(c.id, n);
    }

    // 长按（约 0.5 秒）弹出数量输入；连续快速点击只会累加
    let timer = null;
    let longPressed = false;
    function pressStart(c) {
      longPressed = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        longPressed = true;
        edit(c);
      }, 550);
    }
    const pressEnd = () => clearTimeout(timer);
    function tap(c) {
      if (longPressed) {
        longPressed = false;
        return;
      }
      inc(c);
    }
    return { tap, dec, inc, pressStart, pressEnd, money };
  },
  template: `
  <div class="cat-grid">
    <button v-for="c in categories" :key="c.id" type="button" class="cat-tile" :class="{ on: modelValue[c.id] }"
      title="点击加 1 件，长按输入数量" @click="tap(c)" @pointerdown="pressStart(c)" @pointerup="pressEnd"
      @pointerleave="pressEnd" @pointercancel="pressEnd" @contextmenu.prevent>
      <span class="cat-name">{{ c.name }}</span>
      <span v-if="modelValue[c.id]" class="cat-stepper">
        <span class="step" role="button" aria-label="减少一件" @pointerdown.stop @click.stop="dec(c)"><Icon name="minus" :size="16"/></span>
        <span class="cat-qty">{{ modelValue[c.id] }}</span>
        <span class="step" role="button" aria-label="增加一件" @pointerdown.stop @click.stop="inc(c)"><Icon name="plus" :size="16"/></span>
      </span>
      <span v-else-if="showPrice" class="price">{{ c.price ? money(c.price) : '未定价' }}</span>
    </button>
  </div>`,
};
