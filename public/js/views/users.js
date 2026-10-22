import { api } from '../api.js';
import { store } from '../store.js';
import { confirm, prompt, toast, toastError } from '../ui.js';
import { firstChar, fmtTime, screen } from '../utils.js';

const { onMounted, reactive, ref } = Vue;

const ROLE_TEXT = { manager: '店长', clerk: '店员' };

const UserForm = {
  props: { user: { type: Object, required: true } },
  emits: ['close', 'saved'],
  setup(props, { emit }) {
    const isEdit = !!props.user.id;
    const form = reactive({
      username: props.user.username || '',
      display_name: props.user.display_name || '',
      role: props.user.role || 'clerk',
      password: '',
    });
    const saving = ref(false);
    const self = props.user.id === store.user.id;

    async function save() {
      saving.value = true;
      try {
        const r = isEdit
          ? await api.put(`/users/${props.user.id}`, { display_name: form.display_name, role: form.role })
          : await api.post('/users', form);
        toast(isEdit ? '账号已保存' : '账号已创建', 'success');
        emit('saved', r);
      } catch (e) {
        toastError(e);
      } finally {
        saving.value = false;
      }
    }

    return { isEdit, form, saving, self, save };
  },
  template: `
  <Modal :title="isEdit ? '编辑账号' : '新增账号'" @close="$emit('close')">
    <form id="user-form" class="form-stack" @submit.prevent="save">
      <label class="field"><span>姓名</span><input v-model="form.display_name" maxlength="20" required placeholder="例如：小李"></label>
      <label class="field"><span>登录用户名</span><input v-model.trim="form.username" :disabled="isEdit" maxlength="32" required autocapitalize="off" placeholder="例如：xiaoli 或手机号"></label>
      <label class="field" v-if="!isEdit"><span>初始密码</span><input v-model="form.password" type="text" minlength="6" required placeholder="至少 6 位，员工登录后可自行修改"></label>
      <div class="field">
        <span>角色</span>
        <label class="check"><input type="radio" value="clerk" v-model="form.role" :disabled="self">店员 <span class="muted small">— 只能开单、取货</span></label>
        <label class="check"><input type="radio" value="manager" v-model="form.role" :disabled="self">店长 <span class="muted small">— 全部权限</span></label>
      </div>
    </form>
    <template #footer>
      <button type="button" class="btn" @click="$emit('close')">取消</button>
      <button class="btn primary" form="user-form" :disabled="saving">保存</button>
    </template>
  </Modal>`,
};

export default {
  components: { UserForm },
  setup() {
    const list = ref([]);
    const editing = ref(null);

    async function load() {
      try {
        list.value = await api.get('/users');
      } catch (e) {
        toastError(e);
      }
    }

    async function resetPassword(u) {
      const pw = await prompt(`重置「${u.display_name}」的密码`, {
        message: '设置新密码后，该账号在所有设备上需要重新登录。',
        placeholder: '至少 6 位',
        okText: '重置密码',
      });
      if (pw === null) return;
      if (pw.length < 6) return toast('密码至少 6 位', 'error');
      try {
        await api.put(`/users/${u.id}`, { password: pw });
        toast('密码已重置', 'success');
      } catch (e) {
        toastError(e);
      }
    }

    async function toggleActive(u) {
      if (u.active && !(await confirm(`停用后「${u.display_name}」将无法登录，确定停用吗？`, { danger: true, okText: '停用' }))) return;
      try {
        await api.put(`/users/${u.id}`, { active: !u.active });
        toast(u.active ? '账号已停用' : '账号已启用', 'success');
        load();
      } catch (e) {
        toastError(e);
      }
    }

    function onSaved() {
      editing.value = null;
      load();
    }

    onMounted(load);

    return { store, list, editing, screen, ROLE_TEXT, resetPassword, toggleActive, onSaved, firstChar, fmtTime };
  },
  template: `
  <div class="page">
    <div class="row">
      <div class="grow muted small">店长拥有全部权限；店员只能使用“开单”和“取货”。</div>
      <button type="button" class="btn primary" @click="editing = {}"><Icon name="plus" :size="16"/>新增账号</button>
    </div>
    <section class="card flush">
      <div v-if="screen.mobile" class="list">
        <div v-for="u in list" :key="u.id" class="list-item" style="cursor:default;flex-wrap:wrap">
          <div class="avatar">{{ firstChar(u.display_name) }}</div>
          <div class="grow">
            <div class="list-title">{{ u.display_name }}<span class="tag plain" :class="u.role === 'manager' ? 'info' : ''">{{ ROLE_TEXT[u.role] }}</span>
              <span v-if="!u.active" class="tag danger">已停用</span></div>
            <div class="list-sub muted">{{ u.username }} · 最后登录 {{ u.last_login_at ? fmtTime(u.last_login_at) : '从未' }}</div>
            <div class="btn-row" style="margin-top:8px">
              <button type="button" class="btn sm" @click="editing = u">编辑</button>
              <button type="button" class="btn sm" @click="resetPassword(u)">重置密码</button>
              <button v-if="u.id !== store.user.id" type="button" class="btn sm" @click="toggleActive(u)">{{ u.active ? '停用' : '启用' }}</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead><tr><th>姓名</th><th>用户名</th><th>角色</th><th>状态</th><th>最后登录</th><th class="r">操作</th></tr></thead>
          <tbody>
            <tr v-for="u in list" :key="u.id">
              <td><b>{{ u.display_name }}</b><span v-if="u.id === store.user.id" class="muted small">（我）</span></td>
              <td>{{ u.username }}</td>
              <td><span class="tag plain" :class="u.role === 'manager' ? 'info' : ''">{{ ROLE_TEXT[u.role] }}</span></td>
              <td><span class="tag" :class="u.active ? 'good' : 'danger'">{{ u.active ? '正常' : '已停用' }}</span></td>
              <td class="nowrap">{{ u.last_login_at ? fmtTime(u.last_login_at) : '从未登录' }}</td>
              <td class="r nowrap">
                <button type="button" class="btn sm ghost" @click="editing = u">编辑</button>
                <button type="button" class="btn sm ghost" @click="resetPassword(u)">重置密码</button>
                <button v-if="u.id !== store.user.id" type="button" class="btn sm ghost" @click="toggleActive(u)">{{ u.active ? '停用' : '启用' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <UserForm v-if="editing" :user="editing" @close="editing = null" @saved="onSaved"/>
  </div>`,
};
