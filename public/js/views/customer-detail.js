import { api } from '../api.js';
import { store } from '../store.js';
import { confirm, toast, toastError } from '../ui.js';
import { firstChar, fmtDateTime, fmtTime, money } from '../utils.js';
import { CustomerForm } from './customers.js';

const { computed, ref, watch } = Vue;
const { useRoute, useRouter } = VueRouter;

export default {
  components: { CustomerForm },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const c = ref(null);
    const orders = ref({ total: 0, page: 1, page_size: 20, items: [] });
    const loading = ref(false);
    const editing = ref(false);
    const usage = ref(null);
    const isPackage = computed(() => c.value?.member_type === 'package');
    // 设为包期会员后的编码（只有 4 位编码可以设）
    const upgradeCode = computed(() => (/^\d{4}$/.test(c.value?.code || '') ? `88${c.value.code}` : ''));
    const limitsText = computed(() => {
      const limits = store.settings.package_limits || {};
      const parts = store.categories
        .filter((cat) => Number.isInteger(limits[cat.id]))
        .map((cat) => `${cat.name} ${limits[cat.id]} ${cat.name.includes('鞋') ? '双' : '件'}`);
      return parts.length ? parts.join('、') : '未设置';
    });

    async function loadOrders(page = 1) {
      loading.value = true;
      try {
        orders.value = await api.get('/orders', { customer_id: route.params.id, page });
      } catch (e) {
        toastError(e);
      } finally {
        loading.value = false;
      }
    }

    async function load() {
      try {
        c.value = await api.get(`/customers/${route.params.id}`);
        usage.value = isPackage.value ? await api.get(`/customers/${c.value.id}/package-usage`) : null;
        await loadOrders();
      } catch (e) {
        toastError(e);
      }
    }

    async function remove() {
      if (!(await confirm(`确定删除客户「${c.value.name}」吗？`, { danger: true, okText: '删除' }))) return;
      try {
        await api.del(`/customers/${c.value.id}`);
        toast('客户已删除', 'success');
        router.replace('/customers');
      } catch (e) {
        toastError(e);
      }
    }

    function newOrder() {
      const { id, name, code, member_type: member } = c.value;
      router.push({ path: '/new', query: { cid: id, name, code, member } });
    }

    // 设为 / 取消包期会员
    async function setMembership(type) {
      const cur = c.value;
      const msg =
        type === 'package'
          ? `设为包期会员后，编码由 ${cur.code} 变为 88${cur.code}，每周额度：${limitsText.value}。确定吗？`
          : `取消包期会员后，编码恢复为 ${cur.base_code || cur.code.slice(2)}。确定吗？`;
      if (!(await confirm(msg, { title: type === 'package' ? '设为包期会员' : '取消包期会员' }))) return;
      try {
        await api.post(`/customers/${cur.id}/membership`, { type });
        toast(type === 'package' ? '已设为包期会员' : '已改为普通会员', 'success');
        load();
      } catch (e) {
        toastError(e);
      }
    }

    function onSaved() {
      editing.value = false;
      load();
    }

    watch(() => route.params.id, (id) => id && load(), { immediate: true });

    const openOrder = (o) => router.push(`/orders/${o.id}`);

    return {
      store,
      c,
      orders,
      loading,
      editing,
      usage,
      isPackage,
      upgradeCode,
      limitsText,
      loadOrders,
      remove,
      newOrder,
      setMembership,
      onSaved,
      openOrder,
      firstChar,
      fmtDateTime,
      fmtTime,
      money,
    };
  },
  template: `
  <div class="page" v-if="c">
    <section class="card">
      <div class="detail-head">
        <div class="avatar" style="width:52px;height:52px;font-size:22px">{{ firstChar(c.name) }}</div>
        <div class="grow">
          <div class="title">{{ c.name }} <span class="code-badge" style="font-size:15px">{{ c.code }}</span></div>
          <div class="muted small">
            <template v-if="c.phone">电话 {{ c.phone }} · </template>建档于 {{ fmtDateTime(c.created_at) }}
          </div>
          <div v-if="c.note" class="small" style="margin-top:4px">备注：{{ c.note }}</div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn primary" @click="newOrder"><Icon name="filePlus" :size="16"/>为TA开单</button>
          <button type="button" class="btn" @click="editing = true"><Icon name="edit" :size="16"/>编辑</button>
          <button type="button" class="btn danger" v-if="!c.order_count" @click="remove"><Icon name="trash" :size="16"/>删除</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h3>会员</h3>
        <span class="tag" :class="isPackage ? 'info' : 'plain'">{{ isPackage ? '包期会员' : '普通会员' }}</span>
        <span class="spacer"></span>
        <button v-if="isPackage" type="button" class="btn sm danger" @click="setMembership('regular')">取消包期会员</button>
        <button v-else type="button" class="btn sm" @click="setMembership('package')">设为包期会员</button>
      </div>
      <template v-if="isPackage">
        <div class="muted small" style="margin-bottom:10px">
          {{ c.member_since ? '自 ' + fmtDateTime(c.member_since).slice(0, 10) + ' 起，' : '' }}原编码 {{ c.base_code }}，学期结束后恢复
        </div>
        <PackageQuota v-if="usage" :usage="usage"/>
      </template>
      <div v-else class="muted small">设为包期会员后，编码前自动加 88（{{ upgradeCode || '需要 4 位编码' }}），每周额度：{{ limitsText }}</div>
    </section>

    <div class="kpis">
      <div class="kpi"><span class="label">送洗次数</span><span class="value">{{ c.order_count }}<small>单</small></span></div>
      <div class="kpi"><span class="label">累计件数</span><span class="value">{{ c.total_qty }}<small>件</small></span></div>
      <div class="kpi" :class="{ alert: c.pending_count }"><span class="label">在店未取</span><span class="value">{{ c.pending_count }}<small>单</small></span></div>
      <div class="kpi" v-if="store.settings.enable_price"><span class="label">累计金额</span><span class="value">{{ money(c.total_amount) }}</span></div>
      <div class="kpi"><span class="label">最近送来</span><span class="value" style="font-size:20px">{{ c.last_received_at ? fmtTime(c.last_received_at) : '—' }}</span></div>
    </div>

    <section class="card flush">
      <div class="card-head"><h3>送取记录</h3><span class="muted small">什么时间送来了什么、什么时间取走</span></div>
      <OrderList :orders="orders.items" :show-customer="false" :loading="loading" @open="openOrder"/>
      <Pager :page="orders.page" :page-size="orders.page_size" :total="orders.total" @change="loadOrders"/>
    </section>

    <CustomerForm v-if="editing" :customer="c" @close="editing = false" @saved="onSaved"/>
  </div>`,
};
