import { ui } from '../ui.js';
import { STATUS } from '../utils.js';

const { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } = Vue;

// 线条图标（24×24，参考 Lucide 风格）
const ICONS = {
  filePlus:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 12v6"/>',
  packageCheck:
    '<path d="m16 16 2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m7.5 4.27 9 5.15"/><path d="M3.29 7 12 12l8.71-5"/><path d="M12 22V12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  tag: '<path d="M12 2H2v10l9.29 9.29a2.41 2.41 0 0 0 3.42 0l6.58-6.58a2.41 2.41 0 0 0 0-3.42Z"/><path d="M7 7h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
  sliders:
    '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
  printer:
    '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  shirt:
    '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  refresh:
    '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
  play: '<path d="m6 3 14 9-14 9V3z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
};

export const Icon = {
  props: { name: { type: String, required: true }, size: { type: [Number, String], default: 20 } },
  setup(props) {
    return { paths: computed(() => ICONS[props.name] || '') };
  },
  template: `<svg class="icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="paths"></svg>`,
};

let openModals = 0;

export const Modal = {
  props: { title: String, width: { type: String, default: '480px' }, cls: String },
  emits: ['close'],
  setup(props, { emit }) {
    const onKey = (e) => {
      if (e.key === 'Escape') emit('close');
    };
    onMounted(() => {
      openModals++;
      document.body.classList.add('modal-open');
      document.addEventListener('keydown', onKey);
    });
    onBeforeUnmount(() => {
      openModals--;
      if (!openModals) document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKey);
    });
    return {};
  },
  template: `
  <teleport to="body">
    <div class="modal-mask" @mousedown.self="$emit('close')">
      <div class="modal" :class="cls" :style="{ '--w': width }" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>{{ title }}</h3>
          <button type="button" class="icon-btn" aria-label="关闭" @click="$emit('close')"><Icon name="x"/></button>
        </div>
        <div class="modal-body"><slot/></div>
        <div class="modal-foot" v-if="$slots.footer"><slot name="footer"/></div>
      </div>
    </div>
  </teleport>`,
};

export const DialogHost = {
  setup() {
    const inputEl = ref(null);
    const d = computed(() => ui.dialog);
    watch(d, async (v) => {
      if (v?.input) {
        await nextTick();
        inputEl.value?.focus();
        inputEl.value?.select();
      }
    });
    const ok = () => d.value.resolve(d.value.input ? d.value.value : true);
    return { d, inputEl, ok };
  },
  template: `
  <Modal v-if="d" :title="d.title" cls="dialog" width="420px" @close="d.resolve(null)">
    <p class="dialog-message" v-if="d.message">{{ d.message }}</p>
    <div class="field" v-if="d.input" :style="{ marginTop: d.message ? '12px' : 0 }">
      <input ref="inputEl" v-model="d.value" :type="d.input.type" :inputmode="d.input.inputmode"
        :placeholder="d.input.placeholder" @keydown.enter.prevent="ok">
    </div>
    <div class="dialog-actions" v-if="d.actions">
      <button v-for="(a, i) in d.actions" :key="i" type="button" class="btn block"
        :class="{ primary: a.primary, danger: a.danger }" @click="d.resolve(a.value)">{{ a.text }}</button>
    </div>
    <template #footer>
      <button type="button" class="btn" @click="d.resolve(null)">{{ d.cancelText }}</button>
      <button v-if="!d.actions" type="button" class="btn" :class="d.danger ? 'danger solid' : 'primary'" @click="ok">{{ d.okText }}</button>
    </template>
  </Modal>`,
};

export const ToastHost = {
  setup() {
    const icon = { success: 'checkCircle', error: 'alert', warn: 'alert', info: 'info' };
    return { ui, icon };
  },
  template: `
  <div class="toasts" aria-live="polite">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.type">
      <Icon :name="icon[t.type] || 'info'" :size="18"/><span>{{ t.message }}</span>
    </div>
  </div>`,
};

export const StatusTag = {
  props: { status: String },
  setup(props) {
    return { s: computed(() => STATUS[props.status] || { text: props.status, cls: '' }) };
  },
  template: `<span class="tag" :class="s.cls">{{ s.text }}</span>`,
};

export const Pager = {
  props: { page: Number, pageSize: Number, total: Number },
  emits: ['change'],
  setup(props) {
    return { pages: computed(() => Math.max(1, Math.ceil(props.total / props.pageSize))) };
  },
  template: `
  <div class="pager" v-if="total > pageSize">
    <span class="grow">共 {{ total }} 条</span>
    <button type="button" class="btn sm" :disabled="page <= 1" @click="$emit('change', page - 1)">上一页</button>
    <span class="num">{{ page }} / {{ pages }}</span>
    <button type="button" class="btn sm" :disabled="page >= pages" @click="$emit('change', page + 1)">下一页</button>
  </div>`,
};

// 开关
export const Toggle = {
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue'],
  template: `
  <label class="switch">
    <input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)">
    <span class="track"></span>
    <slot/>
  </label>`,
};
