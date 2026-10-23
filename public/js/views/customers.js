import { api } from '../api.js';
import { weekText } from '../components/member.js';
import { toast, toastError } from '../ui.js';
import { CODE_RE, debounce, firstChar, fmtTime, screen } from '../utils.js';

const { computed, nextTick, onMounted, reactive, ref, watch } = Vue;
const { useRouter } = VueRouter;

// 新增 / 编辑客户
export const CustomerForm = {
  props: { customer: { type: Object, required: true } },
  emits: ['close', 'saved'],
  setup(props, { emit }) {
    const form = reactive({
      name: props.customer.name || '',
      code: props.customer.code || '',
      phone: props.customer.phone || '',
      note: props.customer.note || '',
      member_type: props.customer.member_type || 'regular',
    });
    const saving = ref(false);
    const isEdit = !!props.customer.id;
    const isPackage = computed(() => form.member_type === 'package');

    async function save() {
      if (!form.name.trim()) return toast('请填写姓名', 'error');
      if (!CODE_RE.test(form.code)) return toast('编码必须是 4 位或 6 位数字', 'error');
      if (!isEdit && isPackage.value && !/^\d{4}$/.test(form.code)) {
        return toast('包期会员请填写 4 位编码，系统会自动在前面加 88', 'error');
      }
      saving.value = true;
      try {
        const r = isEdit ? await api.put(`/customers/${props.customer.id}`, form) : await api.post('/customers', form);
        toast(isEdit ? '客户信息已保存' : `客户已添加，编码 ${r.code}`, 'success');
        emit('saved', r);
      } catch (e) {
        toastError(e);
      } finally {
        saving.value = false;
      }
    }

    const onCode = (e) => {
      form.code = e.target.value.replace(/\D/g, '').slice(0, 6);
      e.target.value = form.code;
    };

    return { form, saving, isEdit, isPackage, save, onCode };
  },
  template: `
  <Modal :title="isEdit ? '编辑客户' : '新增客户'" @close="$emit('close')">
    <form class="form-stack" @submit.prevent="save" id="customer-form">
      <div class="customer-inputs">
        <label class="field">
          <span>编码 <span class="hint">{{ isPackage ? (isEdit ? '包期会员 88 开头' : '填 4 位，自动加 88') : '4 或 6 位数字' }}</span></span>
          <input class="code-input" :value="form.code" @input="onCode" inputmode="numeric" maxlength="6" required>
        </label>
        <label class="field"><span>姓名</span><input v-model="form.name" maxlength="30" required></label>
      </div>
      <label v-if="!isEdit" class="check">
        <input type="checkbox" :checked="isPackage" @change="form.member_type = $event.target.checked ? 'package' : 'regular'">
        设为包期会员（编码前自动加 88，每周有洗衣额度）
      </label>
      <label class="field"><span>电话（选填）</span><input v-model="form.phone" type="tel" maxlength="20"></label>
      <label class="field"><span>备注（选填）</span><textarea v-model="form.note" maxlength="200" placeholder="例如：宿舍号、特殊要求"></textarea></label>
    </form>
    <template #footer>
      <button type="button" class="btn" @click="$emit('close')">取消</button>
      <button class="btn primary" form="customer-form" :disabled="saving">保存</button>
    </template>
  </Modal>`,
};

export default {
  components: { CustomerForm },
  setup() {
    const router = useRouter();
    const kw = ref('');
    const member = ref(''); // '' 全部 / package 包期会员 / regular 普通会员
    const data = ref({ total: 0, page: 1, page_size: 20, package_count: 0, package_excess: 0, items: [] });
    const weekly = ref(null); // 包期会员每周情况（/customers/package-week 的返回）
    const weekDate = ref(''); // 查看哪一周（周内任意一天），空 = 本周
    const loading = ref(false);
    const adding = ref(null);
    const ending = ref(null); // 学期结束确认：{ password, busy }
    const pwdEl = ref(null);
    let seq = 0;

    async function load(page = 1) {
      const mine = ++seq;
      loading.value = true;
      try {
        if (member.value === 'package') {
          const r = await api.get('/customers/package-week', { q: kw.value.trim(), date: weekDate.value, page });
          if (mine === seq) weekly.value = r;
        } else {
          const r = await api.get('/customers', { q: kw.value.trim(), member: member.value, page });
          if (mine === seq) data.value = r;
        }
      } catch (e) {
        toastError(e);
      } finally {
        if (mine === seq) loading.value = false;
      }
    }

    watch(kw, debounce(() => load(1), 300));
    watch(member, () => {
      weekDate.value = '';
      load(1);
    });
    onMounted(() => load());

    // 本周 / 上周 / N 周前
    const weekName = computed(() => {
      const n = weekly.value?.week.ago || 0;
      return n === 0 ? '本周' : n === 1 ? '上周' : `${n} 周前`;
    });

    function goWeek(date) {
      weekDate.value = date;
      load(1);
    }

    // 超额情况，如“衣物超出3件、鞋子超出1双”
    const overText = (c) =>
      c.usage
        .map((u, i) => (u.over ? `${weekly.value.quotas[i].name}超出${u.over}${weekly.value.quotas[i].unit}` : ''))
        .filter(Boolean)
        .join('、');

    // 学期结束：所有包期会员降为普通会员，编码恢复为原来的 4 位数；需要输入登录密码
    function openSemesterEnd() {
      ending.value = { password: '', busy: false };
      nextTick(() => pwdEl.value?.focus());
    }

    async function semesterEnd() {
      const e = ending.value;
      if (!e.password) return toast('请输入登录密码', 'error');
      e.busy = true;
      try {
        const r = await api.post('/customers/semester-end', { password: e.password });
        ending.value = null;
        toast(`已将 ${r.count} 位包期会员改为普通会员`, 'success', 3500);
        // 切回“全部”会触发重新加载；本来就在“全部”时手动刷新
        if (member.value) member.value = '';
        else await load(1);
      } catch (err) {
        toastError(err);
        e.password = '';
        nextTick(() => pwdEl.value?.focus());
      } finally {
        e.busy = false;
      }
    }

    const open = (c) => router.push(`/customers/${c.id}`);
    function onSaved(c) {
      adding.value = null;
      open(c);
    }

    return {
      kw,
      member,
      data,
      weekly,
      loading,
      adding,
      ending,
      pwdEl,
      screen,
      load,
      goWeek,
      overText,
      weekName,
      weekText,
      open,
      onSaved,
      openSemesterEnd,
      semesterEnd,
      firstChar,
      fmtTime,
    };
  },
  template: `
  <div class="page">
    <div class="row">
      <div class="search-box grow"><Icon name="search"/><input v-model="kw" type="search" placeholder="搜索姓名 / 编码 / 电话"></div>
      <button type="button" class="btn primary" style="height:50px" @click="adding = {}"><Icon name="plus" :size="18"/>新增</button>
    </div>

    <div class="member-bar">
      <div class="seg">
        <button type="button" :class="{ active: member === '' }" @click="member = ''">全部</button>
        <button type="button" :class="{ active: member === 'package' }" @click="member = 'package'">
          包期会员 {{ data.package_count }}<span v-if="data.package_excess" class="seg-badge" title="本周超额的包期会员">超额 {{ data.package_excess }}</span>
        </button>
        <button type="button" :class="{ active: member === 'regular' }" @click="member = 'regular'">普通会员</button>
      </div>
      <span class="spacer"></span>
      <button type="button" class="btn danger" :disabled="!data.package_count" @click="openSemesterEnd">
        <Icon name="refresh" :size="16"/>学期结束（清除包期会员）
      </button>
    </div>

    <!-- 包期会员：按周查看，超额的置顶 -->
    <template v-if="member === 'package'">
      <div v-if="!weekly" class="card empty"><Icon name="users" :size="32"/>加载中…</div>
      <template v-else>
        <div class="week-nav">
          <button type="button" class="icon-btn" aria-label="上一周" @click="goWeek(weekly.week.prev)"><Icon name="chevronLeft"/></button>
          <div class="week-label"><b>{{ weekName }}</b>{{ weekText(weekly.week) }}</div>
          <button type="button" class="icon-btn" aria-label="下一周" :disabled="!weekly.week.next" @click="goWeek(weekly.week.next)"><Icon name="chevronRight"/></button>
          <button v-if="weekly.week.ago" type="button" class="link" @click="goWeek('')">回到本周</button>
        </div>
        <div class="result-head">
          共 <b>{{ weekly.total }}</b> 位包期会员，<span v-if="weekly.excess_count" class="over-text">{{ weekName }} <b>{{ weekly.excess_count }}</b> 位超额，已排在最前面</span>
          <span v-else>{{ weekName }}没有超额</span>
        </div>
        <section class="card flush" :class="{ refetching: loading }">
          <div v-if="!weekly.items.length" class="empty"><Icon name="users" :size="32"/>{{ kw.trim() ? '没有找到包期会员' : '还没有包期会员' }}</div>
          <div v-else-if="screen.mobile" class="list">
            <div v-for="c in weekly.items" :key="c.id" class="list-item" :class="{ 'row-over': c.over }" @click="open(c)">
              <div class="avatar">{{ firstChar(c.name) }}</div>
              <div class="grow">
                <div class="list-title"><span class="ellipsis">{{ c.name }}</span><span class="code-badge">{{ c.code }}</span>
                  <span v-if="c.over" class="tag danger">超额</span>
                  <span class="spacer"></span><span v-if="c.pending_count" class="tag warn">在店 {{ c.pending_count }} 单</span></div>
                <div class="list-sub">
                  <template v-for="(u, i) in c.usage" :key="i"><template v-if="i"> · </template>{{ weekly.quotas[i].name }}
                    <span :class="{ 'over-text': u.over }">{{ u.used }}</span>/{{ weekly.quotas[i].limit }}</template>
                </div>
                <div v-if="c.over" class="list-sub over-text">{{ overText(c) }}</div>
              </div>
            </div>
          </div>
          <div v-else class="table-wrap">
            <table class="table clickable">
              <thead><tr>
                <th>姓名</th><th>编码</th>
                <th v-for="g in weekly.quotas" :key="g.name" class="num">{{ g.name }}（每周 {{ g.limit }} {{ g.unit }}）</th>
                <th>超额情况</th><th>在店未取</th><th>最近送来</th>
              </tr></thead>
              <tbody>
                <tr v-for="c in weekly.items" :key="c.id" :class="{ 'row-over': c.over }" @click="open(c)">
                  <td><b>{{ c.name }}</b></td>
                  <td><span class="code-badge">{{ c.code }}</span></td>
                  <td v-for="(u, i) in c.usage" :key="i" class="num"><span :class="{ 'over-text': u.over }">{{ u.used }}</span></td>
                  <td><span v-if="c.over" class="tag danger">{{ overText(c) }}</span><span v-else class="muted">—</span></td>
                  <td><span v-if="c.pending_count" class="tag warn">{{ c.pending_count }} 单</span><span v-else class="muted">—</span></td>
                  <td class="nowrap">{{ c.last_received_at ? fmtTime(c.last_received_at) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <Pager :page="weekly.page" :page-size="weekly.page_size" :total="weekly.total" @change="load"/>
        </section>
      </template>
    </template>

    <template v-else>
      <div class="result-head">共 <b>{{ data.total }}</b> 位客户</div>
      <section class="card flush" :class="{ refetching: loading }">
        <div v-if="!data.items.length" class="empty"><Icon name="users" :size="32"/>{{ loading ? '加载中…' : '没有找到客户' }}</div>
        <div v-else-if="screen.mobile" class="list">
          <div v-for="c in data.items" :key="c.id" class="list-item" @click="open(c)">
            <div class="avatar">{{ firstChar(c.name) }}</div>
            <div class="grow">
              <div class="list-title"><span class="ellipsis">{{ c.name }}</span><span class="code-badge">{{ c.code }}</span>
                <span v-if="c.member_type === 'package'" class="tag info plain">包期</span>
                <span class="spacer"></span><span v-if="c.pending_count" class="tag warn">在店 {{ c.pending_count }} 单</span></div>
              <div class="list-sub muted">送洗 {{ c.order_count }} 次<template v-if="c.last_received_at"> · 最近 {{ fmtTime(c.last_received_at) }}</template></div>
            </div>
          </div>
        </div>
        <div v-else class="table-wrap">
          <table class="table clickable">
            <thead><tr><th>姓名</th><th>编码</th><th>会员</th><th>电话</th><th class="num">送洗次数</th><th class="num">累计件数</th><th>在店未取</th><th>最近送来</th></tr></thead>
            <tbody>
              <tr v-for="c in data.items" :key="c.id" @click="open(c)">
                <td><b>{{ c.name }}</b></td>
                <td><span class="code-badge">{{ c.code }}</span></td>
                <td><span v-if="c.member_type === 'package'" class="tag info plain">包期会员</span><span v-else class="muted">普通</span></td>
                <td>{{ c.phone || '—' }}</td>
                <td class="num">{{ c.order_count }}</td>
                <td class="num">{{ c.total_qty }}</td>
                <td><span v-if="c.pending_count" class="tag warn">{{ c.pending_count }} 单</span><span v-else class="muted">—</span></td>
                <td class="nowrap">{{ c.last_received_at ? fmtTime(c.last_received_at) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Pager :page="data.page" :page-size="data.page_size" :total="data.total" @change="load"/>
      </section>
    </template>

    <CustomerForm v-if="adding" :customer="adding" @close="adding = null" @saved="onSaved"/>

    <Modal v-if="ending" title="学期结束" width="440px" @close="ending = null">
      <form class="form-stack" id="semester-form" @submit.prevent="semesterEnd">
        <p class="dialog-message">将把全部 <b>{{ data.package_count }}</b> 位包期会员改为普通会员，编码恢复为原来的 4 位数（例如 881234 → 1234）。操作前系统会自动备份数据。</p>
        <label class="field">
          <span>请输入你的登录密码确认</span>
          <input ref="pwdEl" v-model="ending.password" type="password" autocomplete="current-password" maxlength="64">
        </label>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="ending = null">取消</button>
        <button class="btn danger solid" form="semester-form" :disabled="ending.busy">确定学期结束</button>
      </template>
    </Modal>
  </div>`,
};
