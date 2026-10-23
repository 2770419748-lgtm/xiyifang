import { api, onUnauthorized } from './api.js';
import { BarList, ColumnChart, LineChart } from './components/charts.js';
import { DialogHost, Icon, Modal, Pager, StatusTag, ToastHost, Toggle } from './components/common.js';
import { OrderList } from './components/order-list.js';
import { PrintDialogHost } from './components/print-dialog.js';
import { isDirectPrint, markDirectPrint } from './print.js';
import { PackageQuota } from './components/member.js';
import { CategoryPicker, CustomerPicker } from './components/pickers.js';
import { resumeStationIfNeeded, station } from './station.js';
import { isManager, loadAppData, loadStatus, store } from './store.js';
import { confirm, toast } from './ui.js';
import { firstChar } from './utils.js';
import CategoriesView from './views/categories.js';
import CustomerDetailView from './views/customer-detail.js';
import CustomersView from './views/customers.js';
import LoginView from './views/login.js';
import MoreView from './views/more.js';
import NewOrderView from './views/new-order.js';
import OrderDetailView from './views/order-detail.js';
import OrdersView from './views/orders.js';
import PickupView from './views/pickup.js';
import PrintStationView from './views/print-station.js';
import ProfileView from './views/profile.js';
import SettingsView from './views/settings.js';
import StatsView from './views/stats.js';
import UsersView from './views/users.js';

const { computed, createApp, watch } = Vue;

// 记下“直接打印”窗口并去掉地址里的 ?direct=1（要在创建路由之前，哈希路由会把当前查询参数当作基础地址）
markDirectPrint();
const { createRouter, createWebHashHistory, useRoute, useRouter } = VueRouter;

// meta.manager：仅店长可访问；meta.nav / meta.tab：菜单高亮项；meta.back：显示返回按钮
const routes = [
  { path: '/login', component: LoginView, meta: { public: true, title: '登录' } },
  { path: '/', redirect: '/new' },
  { path: '/new', component: NewOrderView, meta: { title: '开单' } },
  { path: '/pickup', component: PickupView, meta: { title: '取货' } },
  { path: '/orders', component: OrdersView, meta: { title: '订单查询', manager: true } },
  { path: '/orders/:id', component: OrderDetailView, meta: { title: '订单详情', manager: true, nav: '/orders', back: '/orders' } },
  { path: '/customers', component: CustomersView, meta: { title: '客户管理', manager: true, tab: '/more' } },
  { path: '/customers/:id', component: CustomerDetailView, meta: { title: '客户详情', manager: true, nav: '/customers', tab: '/more', back: '/customers' } },
  { path: '/stats', component: StatsView, meta: { title: '经营数据', manager: true } },
  { path: '/categories', component: CategoriesView, meta: { title: '品类管理', manager: true, tab: '/more' } },
  { path: '/users', component: UsersView, meta: { title: '账号管理', manager: true, tab: '/more' } },
  { path: '/settings', component: SettingsView, meta: { title: '系统设置', manager: true, tab: '/more' } },
  { path: '/more', component: MoreView, meta: { title: '更多', manager: true } },
  { path: '/me', component: ProfileView, meta: { title: '我的' } },
  { path: '/print-station', component: PrintStationView, meta: { title: '打印站' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  if (!store.ready) {
    try {
      await loadStatus();
    } catch (e) {
      store.error = e.message;
      return false;
    }
  }
  if (to.meta.public) return store.user ? '/' : true;
  if (!store.user) return { path: '/login', query: to.fullPath === '/' || to.fullPath === '/new' ? {} : { redirect: to.fullPath } };
  if (to.meta.manager && !isManager()) return '/new';
  return true;
});

const titleSuffix = isDirectPrint() ? ' · 直接打印' : '';

router.afterEach((to) => {
  document.title = `${to.meta.title || ''} - ${store.shopName}${titleSuffix}`;
});

onUnauthorized(() => {
  if (!store.user) return;
  store.user = null;
  toast('登录已失效，请重新登录', 'warn');
  router.replace('/login');
});

const MENU = [
  { to: '/new', label: '开单', icon: 'filePlus' },
  { to: '/pickup', label: '取货', icon: 'packageCheck' },
  { to: '/orders', label: '订单查询', icon: 'search', manager: true },
  { to: '/customers', label: '客户管理', icon: 'users', manager: true },
  { to: '/stats', label: '经营数据', icon: 'chart', manager: true },
  { group: '管理', manager: true },
  { to: '/categories', label: '品类管理', icon: 'tag', manager: true },
  { to: '/users', label: '账号管理', icon: 'shield', manager: true },
  { to: '/settings', label: '系统设置', icon: 'sliders', manager: true },
  { group: '本机' },
  { to: '/print-station', label: '打印站', icon: 'printer' },
  { to: '/me', label: '我的', icon: 'user' },
];

const TABS_MANAGER = [
  { to: '/new', label: '开单', icon: 'filePlus' },
  { to: '/pickup', label: '取货', icon: 'packageCheck' },
  { to: '/orders', label: '查询', icon: 'search' },
  { to: '/stats', label: '数据', icon: 'chart' },
  { to: '/more', label: '更多', icon: 'grid' },
];

const TABS_CLERK = [
  { to: '/new', label: '开单', icon: 'filePlus' },
  { to: '/pickup', label: '取货', icon: 'packageCheck' },
  { to: '/me', label: '我的', icon: 'user' },
];

const AppLayout = {
  setup() {
    const route = useRoute();
    const router = useRouter();
    const menu = computed(() => MENU.filter((m) => !m.manager || isManager()));
    const tabs = computed(() => (isManager() ? TABS_MANAGER : TABS_CLERK));
    const navKey = computed(() => route.meta.nav || route.path);
    const tabKey = computed(() => route.meta.tab || route.meta.nav || route.path);

    function back() {
      if (window.history.state?.back) router.back();
      else router.push(route.meta.back || '/');
    }

    async function logout() {
      if (!(await confirm('确定退出登录吗？'))) return;
      await api.post('/auth/logout').catch(() => {});
      store.user = null;
      router.replace('/login');
    }

    return { store, station, route, menu, tabs, navKey, tabKey, isManager, back, logout, firstChar };
  },
  template: `
  <aside class="sidebar">
    <div class="brand"><div class="brand-logo"><Icon name="shirt" :size="18"/></div><span class="ellipsis">{{ store.shopName }}</span></div>
    <nav class="nav">
      <template v-for="m in menu" :key="m.to || m.group">
        <div v-if="m.group" class="nav-group">{{ m.group }}</div>
        <RouterLink v-else :to="m.to" :class="{ active: navKey === m.to }"><Icon :name="m.icon" :size="19"/>{{ m.label }}</RouterLink>
      </template>
    </nav>
    <div class="sidebar-user">
      <div class="avatar">{{ firstChar(store.user.display_name) }}</div>
      <div class="grow">
        <div class="ellipsis" style="font-weight:600">{{ store.user.display_name }}</div>
        <div class="muted small">{{ isManager() ? '店长' : '店员' }}</div>
      </div>
      <button type="button" class="icon-btn" title="退出登录" aria-label="退出登录" @click="logout"><Icon name="logout" :size="18"/></button>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button v-if="route.meta.back" type="button" class="icon-btn back" aria-label="返回" @click="back"><Icon name="chevronLeft"/></button>
      <h1>{{ route.meta.title }}</h1>
      <RouterLink v-if="station.running" to="/print-station" class="station-pill" title="这台设备正在作为打印站运行">
        <span class="pulse on"></span>打印站
      </RouterLink>
    </header>
    <main class="content"><slot/></main>
  </div>
  <nav class="tabbar">
    <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" :class="{ active: tabKey === t.to }"><Icon :name="t.icon" :size="22"/><span>{{ t.label }}</span></RouterLink>
  </nav>`,
};

const App = {
  components: { AppLayout },
  setup() {
    const route = useRoute();
    const reload = () => window.location.reload();
    // 这台设备开启过打印站：登录后自动在后台继续打印
    watch(() => store.user, resumeStationIfNeeded, { immediate: true });
    // 切回本页面时刷新设置和品类（店长可能在其他设备上改过），最多每分钟一次
    let lastRefresh = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !store.user || Date.now() - lastRefresh < 60000) return;
      lastRefresh = Date.now();
      loadAppData().catch(() => {});
    });
    return { store, route, reload };
  },
  template: `
  <div v-if="store.error" class="boot" style="flex-direction:column;gap:12px">
    <div>无法连接服务器：{{ store.error }}</div>
    <button type="button" class="btn" @click="reload">重新加载</button>
  </div>
  <template v-else-if="store.ready">
    <RouterView v-if="route.meta.public"/>
    <AppLayout v-else-if="store.user"><RouterView :key="route.path"/></AppLayout>
  </template>
  <div v-else class="boot">加载中…</div>
  <PrintDialogHost/>
  <ToastHost/>
  <DialogHost/>`,
};

const app = createApp(App);
const components = {
  Icon,
  Modal,
  DialogHost,
  ToastHost,
  PrintDialogHost,
  PackageQuota,
  StatusTag,
  Pager,
  Toggle,
  CustomerPicker,
  CategoryPicker,
  OrderList,
  LineChart,
  ColumnChart,
  BarList,
};
for (const [name, c] of Object.entries(components)) app.component(name, c);
app.use(router);
app.mount('#app');
