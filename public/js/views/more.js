// 手机端“更多”菜单（店长）
export default {
  setup() {
    const links = [
      { to: '/customers', label: '客户管理', icon: 'users' },
      { to: '/categories', label: '品类管理', icon: 'tag' },
      { to: '/users', label: '账号管理', icon: 'shield' },
      { to: '/settings', label: '系统设置', icon: 'sliders' },
      { to: '/print-station', label: '打印站', icon: 'printer' },
      { to: '/me', label: '我的', icon: 'user' },
    ];
    return { links };
  },
  template: `
  <div class="page">
    <div class="menu-grid">
      <RouterLink v-for="l in links" :key="l.to" :to="l.to"><Icon :name="l.icon" :size="26"/>{{ l.label }}</RouterLink>
    </div>
  </div>`,
};
