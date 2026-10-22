import { api } from '../api.js';
import { loadAppData, store } from '../store.js';

const { computed, reactive, ref } = Vue;
const { useRoute, useRouter } = VueRouter;

export default {
  setup() {
    const router = useRouter();
    const route = useRoute();
    const form = reactive({ username: '', password: '', password2: '', display_name: '' });
    const loading = ref(false);
    const error = ref('');
    const setupMode = computed(() => store.needSetup);

    async function submit() {
      error.value = '';
      if (setupMode.value && form.password !== form.password2) {
        error.value = '两次输入的密码不一致';
        return;
      }
      loading.value = true;
      try {
        const r = setupMode.value
          ? await api.post('/auth/setup', {
              username: form.username,
              password: form.password,
              display_name: form.display_name,
            })
          : await api.post('/auth/login', { username: form.username, password: form.password });
        await loadAppData();
        store.needSetup = false;
        store.user = r.user;
        const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
        router.replace(redirect.startsWith('/') ? redirect : '/');
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    return { store, form, loading, error, setupMode, submit };
  },
  template: `
  <div class="login-page">
    <form class="login-card" @submit.prevent="submit">
      <div class="brand-logo"><Icon name="shirt" :size="26"/></div>
      <h1>{{ store.shopName }}</h1>
      <p class="muted">{{ setupMode ? '首次使用，请先创建店长账号（拥有全部权限）' : '洗衣房管理系统 · 请登录' }}</p>
      <label class="field">
        <span>用户名</span>
        <input v-model.trim="form.username" autocomplete="username" autocapitalize="off" required>
      </label>
      <label class="field" v-if="setupMode">
        <span>店长姓名</span>
        <input v-model.trim="form.display_name" placeholder="例如：王店长" maxlength="20">
      </label>
      <label class="field">
        <span>密码</span>
        <input v-model="form.password" type="password" :autocomplete="setupMode ? 'new-password' : 'current-password'" required>
      </label>
      <label class="field" v-if="setupMode">
        <span>确认密码</span>
        <input v-model="form.password2" type="password" autocomplete="new-password" required>
      </label>
      <p class="form-error" v-if="error">{{ error }}</p>
      <button class="btn primary block lg" :disabled="loading">{{ loading ? '请稍候…' : (setupMode ? '创建并登录' : '登录') }}</button>
    </form>
  </div>`,
};
