import { api } from '../api.js';
import { PRINT_METHODS, buildPages, getPrintMethod, printPages, sampleOrder, setPrintMethod } from '../print.js';
import { isManager, store } from '../store.js';
import { confirm, toast, toastError } from '../ui.js';
import { firstChar } from '../utils.js';

const { onMounted, reactive, ref, watch } = Vue;
const { useRouter } = VueRouter;

export default {
  setup() {
    const router = useRouter();
    const method = ref(getPrintMethod());
    const station = ref(null);
    const pw = reactive({ old_password: '', new_password: '', new_password2: '' });
    const saving = ref(false);

    watch(method, (v) => {
      setPrintMethod(v);
      toast('本机打印方式已保存', 'success');
    });

    async function loadStation() {
      try {
        station.value = await api.get('/print-jobs/status');
      } catch {
        station.value = null;
      }
    }

    function testPrint() {
      printPages(buildPages(sampleOrder(), store.settings, { kind: 'piece', piece: 1 }), store.settings);
    }

    async function changePassword() {
      if (pw.new_password !== pw.new_password2) return toast('两次输入的新密码不一致', 'error');
      saving.value = true;
      try {
        await api.post('/auth/password', { old_password: pw.old_password, new_password: pw.new_password });
        Object.assign(pw, { old_password: '', new_password: '', new_password2: '' });
        toast('密码已修改，其他设备需要重新登录', 'success');
      } catch (e) {
        toastError(e);
      } finally {
        saving.value = false;
      }
    }

    async function logout() {
      if (!(await confirm('确定退出登录吗？'))) return;
      await api.post('/auth/logout').catch(() => {});
      store.user = null;
      router.replace('/login');
    }

    onMounted(loadStation);

    return { store, method, station, pw, saving, PRINT_METHODS, isManager, firstChar, testPrint, changePassword, logout };
  },
  template: `
  <div class="page">
    <section class="card">
      <div class="row" style="gap:14px">
        <div class="avatar" style="width:48px;height:48px;font-size:20px">{{ firstChar(store.user.display_name) }}</div>
        <div class="grow">
          <div style="font-size:18px;font-weight:700">{{ store.user.display_name }}</div>
          <div class="muted small">账号 {{ store.user.username }} · {{ isManager() ? '店长（全部权限）' : '店员（开单、取货）' }}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h3>本机打印方式</h3>
        <span class="spacer"></span>
        <span v-if="station" class="tag" :class="station.station_online ? 'good' : ''">打印站{{ station.station_online ? '在线' : '未在线' }}</span>
      </div>
      <div class="form-stack">
        <label v-for="m in PRINT_METHODS" :key="m.value" class="check" style="align-items:flex-start">
          <input type="radio" name="print-method" :value="m.value" v-model="method" style="margin-top:2px">
          <span><b>{{ m.label }}</b><br><span class="muted small">{{ m.desc }}</span></span>
        </label>
      </div>
      <div class="btn-row" style="margin-top:16px">
        <button type="button" class="btn" @click="testPrint"><Icon name="printer" :size="16"/>本机打印测试标签</button>
        <RouterLink class="btn" to="/print-station"><Icon name="printer" :size="16"/>把这台设备设为打印站</RouterLink>
      </div>
      <p class="muted small" style="margin:12px 0 0">此设置只对当前这台设备（浏览器）有效。标签尺寸、内容由店长在“系统设置”中统一设置。</p>
    </section>

    <section class="card">
      <div class="card-head"><h3>修改密码</h3></div>
      <form class="form-grid" @submit.prevent="changePassword">
        <label class="field"><span>原密码</span><input v-model="pw.old_password" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>新密码</span><input v-model="pw.new_password" type="password" autocomplete="new-password" minlength="6" required placeholder="至少 6 位"></label>
        <label class="field"><span>确认新密码</span><input v-model="pw.new_password2" type="password" autocomplete="new-password" required></label>
        <div class="field" style="justify-content:flex-end"><button class="btn primary" :disabled="saving">保存新密码</button></div>
      </form>
    </section>

    <button type="button" class="btn danger lg block" @click="logout"><Icon name="logout" :size="18"/>退出登录</button>
  </div>`,
};
