import { api } from './api.js';

const { reactive } = Vue;

export const store = reactive({
  ready: false,
  error: '',
  user: null,
  needSetup: false,
  shopName: '洗衣房',
  settings: null,
  categories: [],
});

export const isManager = () => store.user?.role === 'manager';

export async function loadAppData() {
  const [settings, categories] = await Promise.all([api.get('/settings'), api.get('/categories')]);
  store.settings = settings;
  store.shopName = settings.shop_name;
  store.categories = categories;
}

export async function loadStatus() {
  const s = await api.get('/auth/status');
  store.needSetup = s.need_setup;
  store.shopName = s.shop_name;
  // 先加载设置和品类，再设置当前用户（依赖设置的功能以用户登录为开始信号）
  if (s.user) await loadAppData();
  store.user = s.user;
  store.ready = true;
}

export async function reloadCategories() {
  store.categories = await api.get('/categories');
}
