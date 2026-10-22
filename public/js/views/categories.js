import { api } from '../api.js';
import { reloadCategories, store } from '../store.js';
import { confirm, prompt, toast, toastError } from '../ui.js';
import { fenToYuan, money, yuanToFen } from '../utils.js';

const { computed, onMounted, ref } = Vue;

export default {
  setup() {
    const list = ref([]);
    const newName = ref('');
    const busy = ref(false);
    const enablePrice = computed(() => store.settings.enable_price);

    async function load() {
      try {
        list.value = await api.get('/categories', { all: 1 });
      } catch (e) {
        toastError(e);
      }
    }

    // 修改后同步刷新开单页使用的品类
    async function run(fn, message) {
      busy.value = true;
      try {
        await fn();
        if (message) toast(message, 'success');
        await Promise.all([load(), reloadCategories()]);
      } catch (e) {
        toastError(e);
      } finally {
        busy.value = false;
      }
    }

    function add() {
      const name = newName.value.trim();
      if (!name) return toast('请输入品类名称', 'error');
      run(async () => {
        await api.post('/categories', { name });
        newName.value = '';
      }, `已添加「${name}」`);
    }

    async function rename(c) {
      const name = await prompt('修改品类名称', { value: c.name });
      if (name === null || name.trim() === c.name) return;
      run(() => api.put(`/categories/${c.id}`, { name }), '名称已修改');
    }

    async function setPrice(c) {
      const v = await prompt(`「${c.name}」单价（元）`, { value: c.price ? fenToYuan(c.price) : '', inputmode: 'decimal', placeholder: '例如 15' });
      if (v === null) return;
      const fen = yuanToFen(v);
      if (Number.isNaN(fen)) return toast('价格格式不正确', 'error');
      run(() => api.put(`/categories/${c.id}`, { price: fen ?? 0 }), '单价已修改');
    }

    function toggle(c) {
      run(() => api.put(`/categories/${c.id}`, { active: !c.active }), c.active ? `已停用「${c.name}」` : `已启用「${c.name}」`);
    }

    function move(i, dir) {
      const ids = list.value.map((c) => c.id);
      const j = i + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      run(() => api.post('/categories/reorder', { ids }));
    }

    async function remove(c) {
      if (!(await confirm(`确定删除品类「${c.name}」吗？`, { danger: true, okText: '删除' }))) return;
      run(() => api.del(`/categories/${c.id}`), '已删除');
    }

    onMounted(load);

    return { list, newName, busy, enablePrice, add, rename, setPrice, toggle, move, remove, money };
  },
  template: `
  <div class="page">
    <form class="row" @submit.prevent="add">
      <input class="input grow" v-model="newName" maxlength="10" placeholder="新品类名称，例如：羽绒服、窗帘">
      <button class="btn primary" :disabled="busy"><Icon name="plus" :size="16"/>添加</button>
    </form>
    <div class="notice info" v-if="!enablePrice">
      <Icon name="info"/>
      <div class="grow small">目前未启用金额功能。如需记录价格、统计营业额，请到“系统设置”中开启，然后在这里设置单价。</div>
    </div>
    <section class="card flush">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th style="width:84px">排序</th><th>名称</th><th v-if="enablePrice" class="num">单价</th><th class="num">使用次数</th><th>状态</th><th class="r">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in list" :key="c.id" :style="c.active ? '' : 'color:var(--ink-3)'">
              <td class="nowrap">
                <button type="button" class="icon-btn" :disabled="i === 0 || busy" aria-label="上移" @click="move(i, -1)"><Icon name="chevronUp" :size="18"/></button>
                <button type="button" class="icon-btn" :disabled="i === list.length - 1 || busy" aria-label="下移" @click="move(i, 1)"><Icon name="chevronDown" :size="18"/></button>
              </td>
              <td><b>{{ c.name }}</b></td>
              <td v-if="enablePrice" class="num"><button type="button" class="link" @click="setPrice(c)">{{ c.price ? money(c.price) : '设置' }}</button></td>
              <td class="num">{{ c.used }}</td>
              <td><span class="tag" :class="c.active ? 'good' : ''">{{ c.active ? '启用' : '停用' }}</span></td>
              <td class="r nowrap">
                <button type="button" class="btn sm ghost" @click="rename(c)">改名</button>
                <button type="button" class="btn sm ghost" @click="toggle(c)">{{ c.active ? '停用' : '启用' }}</button>
                <button v-if="!c.used" type="button" class="btn sm ghost" style="color:var(--danger-ink)" @click="remove(c)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <p class="muted small" style="margin:0 4px">停用的品类不会出现在开单页面，但历史订单和统计中仍会保留；已被订单使用过的品类不能删除。</p>
  </div>`,
};
