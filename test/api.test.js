// 接口集成测试：用临时数据目录启动一个真实服务，按业务流程逐项验证
// 运行：npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const PORT = 4100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}/api`;
let server;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laundry-test-'));
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, PRINT_LEASE_MS: '400' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${BASE}/auth/status`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('服务没有启动');
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// 带 Cookie 的简易客户端，模拟一个浏览器
function client() {
  let cookie = '';
  async function call(method, url, body, { csrf = true } = {}) {
    const headers = {};
    if (csrf) headers['X-Requested-With'] = 'fetch';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      if (kv.startsWith('laundry_token=')) cookie = kv;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (u) => call('GET', u),
    post: (u, b = {}, o) => call('POST', u, b, o),
    put: (u, b = {}) => call('PUT', u, b),
    del: (u) => call('DELETE', u),
  };
}

const manager = client();
const clerk = client();
let cats;

describe('登录与初始化', () => {
  test('首次使用需要创建店长账号', async () => {
    const s = await manager.get('/auth/status');
    assert.equal(s.data.need_setup, true);
    const r = await manager.post('/auth/setup', { username: 'boss', password: 'boss123', display_name: '王店长' });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'manager');
    const again = await client().post('/auth/setup', { username: 'x', password: '123456' });
    assert.equal(again.status, 400);
  });

  test('写操作必须带防伪造请求头', async () => {
    const r = await manager.post('/orders', {}, { csrf: false });
    assert.equal(r.status, 403);
  });

  test('店长创建店员，店员可以登录（用户名不区分大小写）', async () => {
    const r = await manager.post('/users', { username: 'xiaoli', password: '123456', display_name: '小李', role: 'clerk' });
    assert.equal(r.status, 201);
    assert.equal((await clerk.post('/auth/login', { username: 'xiaoli', password: 'wrong' })).status, 400);
    const ok = await clerk.post('/auth/login', { username: 'XiaoLi', password: '123456' });
    assert.equal(ok.data.user.role, 'clerk');
  });

  test('默认有 12 个品类且顺序正确', async () => {
    cats = (await manager.get('/categories')).data;
    assert.deepEqual(
      cats.map((c) => c.name),
      ['衣物', '鞋子', '床单', '被套', '枕头套', '毛巾', '书包', '浴巾', '毛毯', '凉被', '围巾', '帽子'],
    );
  });
});

describe('权限', () => {
  test('店员不能访问店长功能', async () => {
    for (const [method, url] of [
      ['get', '/stats'],
      ['get', '/orders'],
      ['get', '/orders/export'],
      ['get', '/customers'],
      ['get', '/users'],
      ['get', '/settings/backup'],
    ]) {
      assert.equal((await clerk[method](url)).status, 403, url);
    }
    assert.equal((await clerk.put('/settings', { shop_name: 'x' })).status, 403);
    assert.equal((await clerk.post('/categories', { name: 'x' })).status, 403);
  });

  test('未登录访问接口返回 401', async () => {
    assert.equal((await client().get('/orders/pending')).status, 401);
  });
});

const catId = (name) => cats.find((c) => c.name === name).id;
let order1;
let order2;

describe('开单', () => {
  test('新客户开单：自动建档，单号为 日期-流水号', async () => {
    const r = await clerk.post('/orders', {
      customer: { name: '张三', code: '1234' },
      items: [
        { category_id: catId('衣物'), quantity: 3 },
        { category_id: catId('鞋子'), quantity: 1 },
      ],
      note: '白衬衫有污渍',
    });
    assert.equal(r.status, 201);
    order1 = r.data;
    assert.match(order1.order_no, /^\d{6}-001$/);
    assert.equal(order1.customer_name, '张三');
    assert.equal(order1.total_qty, 4);
    assert.equal(order1.status, 'pending');
    assert.equal(order1.created_by_name, '小李');
  });

  test('编码必须是 4 位或 6 位数字', async () => {
    for (const code of ['123', '12345', '1234567', '12a4']) {
      const r = await clerk.post('/orders', { customer: { name: '李四', code }, items: [{ category_id: catId('衣物'), quantity: 1 }] });
      assert.equal(r.status, 400, code);
    }
    const ok = await clerk.post('/orders', {
      customer: { name: '王五', code: '123456' },
      items: [{ category_id: catId('毛巾'), quantity: 2 }],
    });
    assert.equal(ok.status, 201);
    order2 = ok.data;
  });

  test('编码已被别人使用时返回冲突，可选择老客户', async () => {
    const r = await clerk.post('/orders', { customer: { name: '李四', code: '1234' }, items: [{ category_id: catId('床单'), quantity: 1 }] });
    assert.equal(r.status, 409);
    assert.equal(r.data.conflict[0].name, '张三');
    assert.equal(r.data.can_force, true); // 编码可以重复，也可以选择新建
    const reuse = await clerk.post('/orders', { customer_id: r.data.conflict[0].id, items: [{ category_id: catId('床单'), quantity: 1 }] });
    assert.equal(reuse.data.customer_name, '张三');
  });

  test('只填编码时自动找到老客户', async () => {
    const r = await clerk.post('/orders', { customer: { code: '1234' }, items: [{ category_id: catId('帽子'), quantity: 1 }] });
    assert.equal(r.status, 201);
    assert.equal(r.data.customer_name, '张三');
  });

  test('没有物品不能开单；送来时间不能晚于现在', async () => {
    assert.equal((await clerk.post('/orders', { customer: { name: '张三', code: '1234' }, items: [] })).status, 400);
    const future = await clerk.post('/orders', {
      customer: { code: '1234' },
      items: [{ category_id: catId('衣物'), quantity: 1 }],
      received_at: '2099-01-01T10:00',
    });
    assert.equal(future.status, 400);
  });

  test('补录昨天的单，单号用送来日期', async () => {
    const d = new Date(Date.now() - 86400000);
    const local = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
    const r = await clerk.post('/orders', {
      customer: { code: '123456' },
      items: [{ category_id: catId('被套'), quantity: 1 }],
      received_at: `${day}T09:30`,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.order_no, `${day.slice(2).replaceAll('-', '')}-001`);
    assert.equal(r.data.received_at, `${day} 09:30:00`);
  });

  test('姓名、编码模糊搜索客户', async () => {
    const byCode = await clerk.get(`/customers/search?q=${encodeURIComponent('123')}`);
    assert.deepEqual(byCode.data.map((c) => c.code).sort(), ['1234', '123456']);
    const byName = await clerk.get(`/customers/search?q=${encodeURIComponent('张')}`);
    assert.equal(byName.data[0].name, '张三');
    assert.ok(byName.data[0].pending_count >= 1);
  });
});

describe('取货', () => {
  test('按编码查询在店待取订单', async () => {
    const r = await clerk.get('/orders/pending?q=1234');
    assert.ok(r.data.items.length >= 3);
    assert.ok(r.data.items.every((o) => o.customer_code.includes('1234') && o.status === 'pending'));
    assert.ok(r.data.items[0].items.length > 0);
  });

  test('取走时间不能早于送来时间', async () => {
    const r = await clerk.post('/orders/pickup', { ids: [order1.id], picked_at: '2020-01-01T08:00' });
    assert.equal(r.status, 400);
  });

  test('确认取件后不能重复取件', async () => {
    const r = await clerk.post('/orders/pickup', { ids: [order1.id, order2.id] });
    assert.equal(r.status, 200);
    assert.equal(r.data.count, 2);
    const again = await clerk.post('/orders/pickup', { ids: [order1.id] });
    assert.equal(again.status, 409);
    const detail = await manager.get(`/orders/${order1.id}`);
    assert.equal(detail.data.status, 'picked');
    assert.equal(detail.data.picked_by_name, '小李');
    assert.ok(detail.data.picked_at);
  });
});

describe('店长：查询、修改、统计', () => {
  test('按状态、品类、关键词查询订单', async () => {
    const picked = await manager.get('/orders?status=picked');
    assert.equal(picked.data.total, 2);
    const shoes = await manager.get(`/orders?category_id=${catId('鞋子')}`);
    assert.equal(shoes.data.total, 1);
    const kw = await manager.get(`/orders?q=${encodeURIComponent('王五')}`);
    assert.equal(kw.data.total, 2);
    const byCustomer = await manager.get(`/orders?customer_id=${order1.customer_id}`);
    assert.equal(byCustomer.data.total, 3);
  });

  test('查询合计不含作废单', async () => {
    const all = await manager.get('/orders');
    const cancelled = await manager.get('/orders?status=cancelled');
    assert.equal(all.data.total, all.data.orders + cancelled.data.total);
    const byCat = await manager.get(`/orders?category_id=${catId('衣物')}`);
    assert.equal(byCat.data.category_qty, 3);
  });

  test('导出 Excel（CSV，带 BOM，编码保留前导零）', async () => {
    const r = await manager.get('/orders/export');
    assert.equal(r.status, 200);
    const textOut = r.data.toString('utf8');
    assert.ok(textOut.startsWith('﻿单号,客户姓名,编码'));
    assert.ok(textOut.includes('="1234"'));
  });

  test('修改订单物品与时间', async () => {
    const r = await manager.put(`/orders/${order2.id}`, {
      items: [{ category_id: catId('浴巾'), quantity: 2 }],
      note: '已核对',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.total_qty, 2);
    assert.equal(r.data.items[0].category_name, '浴巾');
    const bad = await manager.put(`/orders/${order2.id}`, { picked_at: '2000-01-01T00:00' });
    assert.equal(bad.status, 400);
  });

  test('撤销取件、作废、恢复', async () => {
    assert.equal((await manager.post(`/orders/${order2.id}/unpickup`)).data.status, 'pending');
    const c = await manager.post(`/orders/${order2.id}/cancel`, { reason: '录错了' });
    assert.equal(c.data.status, 'cancelled');
    assert.equal(c.data.cancel_reason, '录错了');
    assert.equal((await manager.post(`/orders/${order2.id}/restore`)).data.status, 'pending');
  });

  test('经营数据统计', async () => {
    const r = await manager.get('/stats');
    assert.equal(r.status, 200);
    const s = r.data.summary;
    assert.equal(s.received.orders, 4); // 今天开的 4 单（补录的那单在昨天）
    assert.equal(s.picked.orders, 1);
    assert.equal(s.pending.orders, 4); // order1 已取，其余 4 单待取
    assert.equal(r.data.trend.length, 1);
    assert.equal(r.data.hours.length, 24);
    assert.ok(r.data.categories.some((c) => c.name === '衣物' && c.qty === 3));
    assert.ok(r.data.staff.some((u) => u.display_name === '小李' && u.picked_orders === 1));
  });
});

describe('金额与设置', () => {
  test('开启金额后按品类单价计算，也可手动改金额', async () => {
    assert.equal((await manager.put('/settings', { enable_price: true })).data.enable_price, true);
    await manager.put(`/categories/${catId('衣物')}`, { price: 1500 });
    const r = await clerk.post('/orders', { customer: { code: '1234' }, items: [{ category_id: catId('衣物'), quantity: 2 }] });
    assert.equal(r.data.amount, 3000);
    assert.equal(r.data.items[0].unit_price, 1500);
    const discount = await clerk.post('/orders', {
      customer: { code: '1234' },
      items: [{ category_id: catId('衣物'), quantity: 2 }],
      amount: 2500,
    });
    assert.equal(discount.data.amount, 2500);
  });

  test('同一编码可以有多位客户：只填编码时要求选择', async () => {
    const body = { customer: { name: '李四', code: '1234' }, items: [{ category_id: catId('衣物'), quantity: 1 }] };
    const conflict = await clerk.post('/orders', body);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.can_force, true);
    const forced = await clerk.post('/orders', { ...body, force_new: true });
    assert.equal(forced.data.customer_name, '李四');
    assert.equal(forced.data.customer_code, '1234');
    // 按编码精确查找：两位客户
    const same = await clerk.get('/customers/search?code=1234');
    assert.deepEqual(same.data.map((c) => c.name).sort(), ['张三', '李四']);
    // 只填编码：对应多位客户，返回名单让店员选
    const onlyCode = await clerk.post('/orders', { customer: { code: '1234' }, items: [{ category_id: catId('衣物'), quantity: 1 }] });
    assert.equal(onlyCode.status, 409);
    assert.equal(onlyCode.data.conflict.length, 2);
    assert.equal(onlyCode.data.can_force, false);
    // 编码 + 姓名对得上：直接用这位客户，不再询问
    const li = await clerk.post('/orders', { customer: { name: '李四', code: '1234' }, items: [{ category_id: catId('衣物'), quantity: 1 }] });
    assert.equal(li.status, 201);
    assert.equal(li.data.customer_id, forced.data.customer_id);
  });

  test('同一姓名可以有不同编码', async () => {
    const r = await clerk.post('/orders', { customer: { name: '张三', code: '5678' }, items: [{ category_id: catId('帽子'), quantity: 1 }] });
    assert.equal(r.status, 201);
    assert.notEqual(r.data.customer_id, order1.customer_id);
    const both = await clerk.get(`/customers/search?q=${encodeURIComponent('张三')}`);
    assert.deepEqual(both.data.map((c) => c.code).sort(), ['1234', '5678']);
    // 店长新建客户、改编码也不限制重复
    assert.equal((await manager.post('/customers', { name: '王五', code: '1234' })).status, 201);
  });

  test('只改备注时保留手动优惠过的金额', async () => {
    const r = await clerk.post('/orders', {
      customer_id: order1.customer_id,
      items: [{ category_id: catId('衣物'), quantity: 3 }],
      amount: 4000,
    });
    assert.equal(r.data.amount, 4000);
    const edited = await manager.put(`/orders/${r.data.id}`, {
      items: [{ category_id: catId('衣物'), quantity: 3 }],
      note: '老顾客优惠',
    });
    assert.equal(edited.data.amount, 4000);
    assert.equal(edited.data.note, '老顾客优惠');
    assert.equal(edited.data.received_at, r.data.received_at);
    // 物品变了才按单价重新计算
    const changed = await manager.put(`/orders/${r.data.id}`, { items: [{ category_id: catId('衣物'), quantity: 2 }] });
    assert.equal(changed.data.amount, 3000);
  });

  test('品类：新增、停用、已使用的不能删除', async () => {
    const r = await manager.post('/categories', { name: '羽绒服', price: 3000 });
    assert.equal(r.status, 201);
    assert.equal((await manager.post('/categories', { name: '羽绒服' })).status, 409);
    await manager.put(`/categories/${r.data.id}`, { active: false });
    assert.ok(!(await clerk.get('/categories')).data.some((c) => c.name === '羽绒服'));
    assert.equal((await manager.del(`/categories/${catId('衣物')}`)).status, 400);
    assert.equal((await manager.del(`/categories/${r.data.id}`)).status, 200);
  });
});

describe('包期会员', () => {
  let a;
  let b;
  // 店铺时区的日期
  const shDate = (offsetDays = 0) => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    d.setDate(d.getDate() + offsetDays);
    const pad = (n) => String(n).padStart(2, '0');
    return { str: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, dow: (d.getDay() + 6) % 7 };
  };
  const order = (customer, items, extra = {}) =>
    clerk.post('/orders', { customer_id: customer.id, items: items.map(([name, quantity]) => ({ category_id: catId(name), quantity })), ...extra });

  test('设为包期会员：编码前自动加 88，只有店长能操作', async () => {
    a = (await manager.post('/customers', { name: '学生甲', code: '2001' })).data;
    b = (await manager.post('/customers', { name: '学生乙', code: '2002' })).data;
    const six = (await manager.post('/customers', { name: '学生丙', code: '300001' })).data;
    assert.equal((await clerk.post(`/customers/${a.id}/membership`, { type: 'package' })).status, 403);
    const r = await manager.post(`/customers/${a.id}/membership`, { type: 'package' });
    assert.equal(r.data.code, '882001');
    assert.equal(r.data.base_code, '2001');
    assert.equal(r.data.member_type, 'package');
    assert.equal((await manager.post(`/customers/${a.id}/membership`, { type: 'package' })).status, 400); // 已经是
    assert.equal((await manager.post(`/customers/${six.id}/membership`, { type: 'package' })).status, 400); // 6 位编码
    // 新建时直接设为包期会员
    b = (await manager.post(`/customers/${b.id}/membership`, { type: 'package' })).data;
    assert.equal(b.code, '882002');
    const list = await manager.get('/customers?member=package');
    assert.equal(list.data.package_count, 2);
    assert.deepEqual(list.data.items.map((c) => c.name).sort(), ['学生乙', '学生甲']);
  });

  test('报原来的 4 位编码也能找到包期会员', async () => {
    const found = await clerk.get('/customers/search?code=2001');
    assert.equal(found.data[0].name, '学生甲');
    assert.equal(found.data[0].member_type, 'package');
    const r = await clerk.post('/orders', { customer: { code: '2001' }, items: [{ category_id: catId('帽子'), quantity: 1 }] });
    assert.equal(r.status, 201);
    assert.equal(r.data.customer_code, '882001');
    assert.equal(r.data.customer_member_type, 'package');
  });

  // 某位会员这一周每项额度的 [已送, 超出]
  const usageOf = (week, name) => {
    const c = week.items.find((x) => x.name === name);
    return Object.fromEntries(week.quotas.map((g, i) => [g.name, [c.usage[i].used, c.usage[i].over]]));
  };

  let first;
  test('包期会员开单不提示超额：超出额度也直接开单，包期内的品类不收费', async () => {
    first = await order(a, [['衣物', 7]]);
    assert.equal(first.status, 201);
    assert.equal(first.data.amount, 0); // 包期内免费（已开启金额，衣物单价 15 元）
    const over = await order(a, [['衣物', 3], ['鞋子', 2]]);
    assert.equal(over.status, 201); // 本周衣物 10 件、鞋子 2 双，超额也直接开单
    assert.equal(over.data.amount, 0);
    assert.equal(over.data.excess, undefined);
    // 不在包期内的品类照常收费
    await manager.put(`/categories/${catId('床单')}`, { price: 2000 });
    assert.equal((await order(a, [['床单', 1]])).data.amount, 2000);
    // 店员开单时可以自己填金额
    assert.equal((await order(a, [['帽子', 1]], { amount: 500 })).data.amount, 500);
  });

  test('额度按周一至周日、以送来时间计算', async () => {
    const t = shDate();
    const lastSunday = shDate(-t.dow - 1).str;
    assert.equal((await order(b, [['衣物', 12]], { received_at: `${lastSunday}T20:00` })).status, 201);
    assert.equal((await order(b, [['衣物', 9]])).status, 201);
    // 上周日的 12 件算在上周：本周 9 件刚好用完，不算超额
    const usage = await manager.get(`/customers/${b.id}/package-usage`);
    assert.equal(usage.data.member, true);
    assert.equal(usage.data.week.start, shDate(-t.dow).str);
    assert.equal(usage.data.items.find((i) => i.name === '衣物+浴巾').used, 9);
    const thisWeek = (await manager.get('/customers/package-week')).data;
    assert.deepEqual(usageOf(thisWeek, '学生乙')['衣物+浴巾'], [9, 0]);
    // 查看上周：学生乙上周超出 3 件
    const lastWeek = (await manager.get(`/customers/package-week?date=${lastSunday}`)).data;
    assert.deepEqual([lastWeek.week.ago, lastWeek.week.end, lastWeek.week.next], [1, lastSunday, shDate(-t.dow).str]);
    assert.deepEqual(lastWeek.items.map((c) => [c.name, c.over]), [['学生乙', 3], ['学生甲', 0]]);
    assert.equal(lastWeek.excess_count, 1);
    // 额度情况只有店长能看
    assert.equal((await clerk.get(`/customers/${b.id}/package-usage`)).status, 403);
    assert.equal((await clerk.get('/customers/package-week')).status, 403);
  });

  test('浴巾和衣物合并计算：加起来超过 9 件算超额', async () => {
    assert.deepEqual((await clerk.get('/settings')).data.package_quotas, [
      { category_ids: [catId('衣物'), catId('浴巾')], limit: 9 },
      { category_ids: [catId('鞋子')], limit: 1 },
    ]);
    // 学生乙本周已送 9 件衣物，再送 1 条浴巾：合计 10 件，超出 1 件
    await manager.put(`/categories/${catId('浴巾')}`, { price: 800 });
    const towel = await order(b, [['浴巾', 1]]);
    assert.equal(towel.status, 201);
    assert.equal(towel.data.amount, 0); // 浴巾也在包期内，不收费
    const week = (await manager.get('/customers/package-week')).data;
    assert.deepEqual(week.quotas.map((g) => `${g.name}${g.limit}${g.unit}`), ['衣物+浴巾9件', '鞋子1双']);
    assert.deepEqual(usageOf(week, '学生乙'), { '衣物+浴巾': [10, 1], 鞋子: [0, 0] });
    const usage = await manager.get(`/customers/${b.id}/package-usage`);
    assert.deepEqual(usage.data.items.map((i) => [i.name, i.used, i.limit]), [['衣物+浴巾', 10, 9], ['鞋子', 0, 1]]);
    await manager.post(`/orders/${towel.data.id}/cancel`, { reason: '测试' });
  });

  test('周末查看：本周超额的包期会员置顶，超得多的在前', async () => {
    let week = (await manager.get('/customers/package-week')).data;
    assert.deepEqual([week.week.ago, week.week.next], [0, null]);
    assert.equal(week.excess_count, 1);
    assert.equal(week.items[0].name, '学生甲');
    assert.equal(week.items[0].over, 2);
    assert.deepEqual(usageOf(week, '学生甲'), { '衣物+浴巾': [10, 1], 鞋子: [2, 1] });
    assert.equal((await manager.get('/customers')).data.package_excess, 1);
    // 学生乙再送 4 件：超出 4 件，比学生甲多，排到最前面
    const more = await order(b, [['衣物', 4]]);
    week = (await manager.get('/customers/package-week')).data;
    assert.deepEqual(week.items.map((c) => [c.name, c.over]), [['学生乙', 4], ['学生甲', 2]]);
    assert.equal((await manager.get('/customers')).data.package_excess, 2);
    // 按姓名查找
    const found = (await manager.get(`/customers/package-week?q=${encodeURIComponent('学生甲')}`)).data;
    assert.deepEqual(found.items.map((c) => c.name), ['学生甲']);
    // 作废的订单不算
    await manager.post(`/orders/${more.data.id}/cancel`, { reason: '录错了' });
    week = (await manager.get('/customers/package-week')).data;
    assert.deepEqual(week.items.map((c) => [c.name, c.over]), [['学生甲', 2], ['学生乙', 0]]);
  });

  test('改单也不提示超额，周统计跟着更新', async () => {
    const r = await manager.put(`/orders/${first.data.id}`, { items: [{ category_id: catId('衣物'), quantity: 8 }] });
    assert.equal(r.status, 200);
    assert.equal(r.data.amount, 0);
    const week = (await manager.get('/customers/package-week')).data;
    assert.deepEqual(usageOf(week, '学生甲')['衣物+浴巾'], [11, 2]); // 8 + 本周另一单 3 件
  });

  test('设置每周额度：同一项里的品类合并计算', async () => {
    const quotas = (list) => list.map(([names, limit]) => ({ category_ids: names.map(catId), limit }));
    // 衣物、浴巾、毛巾合计 12 件；鞋子 2 双；床单单独 1 件
    const r = await manager.put('/settings', {
      package_quotas: quotas([[['衣物', '浴巾', '毛巾'], 12], [['鞋子'], 2], [['床单'], 1]]),
    });
    assert.equal(r.status, 200);
    const usage = await manager.get(`/customers/${b.id}/package-usage`);
    assert.deepEqual(usage.data.items.map((i) => `${i.name}${i.limit}`), ['衣物+毛巾+浴巾12', '鞋子2', '床单1']);
    const week = (await manager.get('/customers/package-week')).data;
    assert.equal(week.excess_count, 0); // 额度调高后没人超额
    assert.deepEqual(usageOf(week, '学生甲'), { '衣物+毛巾+浴巾': [11, 0], 鞋子: [2, 0], 床单: [1, 0] });
    // 同一个品类不能放在两项里；每项至少选一个品类；数量要是 0~999 的整数
    const bad = async (body) => (await manager.put('/settings', { package_quotas: body })).data.error;
    assert.equal(await bad(quotas([[['衣物'], 9], [['衣物', '鞋子'], 1]])), '「衣物」不能同时放在两项额度里');
    assert.equal(await bad(quotas([[['衣物'], 9], [[], 1]])), '第 2 项额度还没有选品类');
    assert.equal(await bad(quotas([[['衣物'], -1]])), '第 1 项额度的数量不正确');
    assert.equal(await bad({ 1: 9 }), '包期额度设置不正确');
    // 恢复默认
    await manager.put('/settings', { package_quotas: quotas([[['衣物', '浴巾'], 9], [['鞋子'], 1]]) });
  });

  test('新建客户时直接设为包期会员', async () => {
    const c = await manager.post('/customers', { name: '学生丁', code: '2004', member_type: 'package' });
    assert.equal(c.status, 201);
    assert.equal(c.data.code, '882004');
    assert.equal(c.data.base_code, '2004');
    assert.equal((await manager.post('/customers', { name: '学生戊', code: '200005', member_type: 'package' })).status, 400);
    // 修改包期会员编码：填 4 位或 88 开头的 6 位都可以
    assert.equal((await manager.put(`/customers/${c.data.id}`, { code: '2014' })).data.code, '882014');
  });

  test('学期结束：要输入登录密码，一键把包期会员降为普通会员，编码恢复 4 位，并自动备份', async () => {
    assert.equal((await clerk.post('/customers/semester-end', { password: '123456' })).status, 403);
    assert.equal((await manager.post('/customers/semester-end')).status, 400); // 没填密码
    const wrong = await manager.post('/customers/semester-end', { password: 'boss1234' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.error, '登录密码不正确');
    assert.equal((await manager.get('/customers?member=package')).data.total, 3); // 密码不对时什么都不改
    const r = await manager.post('/customers/semester-end', { password: 'boss123' });
    assert.equal(r.status, 200);
    assert.equal(r.data.count, 3);
    const back = await manager.get(`/customers/${a.id}`);
    assert.equal(back.data.code, '2001');
    assert.equal(back.data.member_type, 'regular');
    assert.equal(back.data.base_code, null);
    assert.equal((await manager.get('/customers?member=package')).data.total, 0);
    assert.equal((await manager.get('/customers/package-week')).data.total, 0);
    const backups = fs.readdirSync(path.join(dataDir, 'backups'));
    assert.ok(backups.some((f) => f.startsWith('laundry-before-semester-end-')));
    // 降级后按普通单价收费
    assert.equal((await order(a, [['衣物', 2]])).data.amount, 3000);
  });
});

describe('账号管理', () => {
  test('不能取消自己的店长权限', async () => {
    const me = (await manager.get('/auth/status')).data.user;
    assert.equal((await manager.put(`/users/${me.id}`, { role: 'clerk' })).status, 400);
  });

  test('停用店员后其登录立即失效', async () => {
    const users = (await manager.get('/users')).data;
    const li = users.find((u) => u.username === 'xiaoli');
    await manager.put(`/users/${li.id}`, { active: false });
    assert.equal((await clerk.get('/orders/pending')).status, 401);
    assert.equal((await clerk.post('/auth/login', { username: 'xiaoli', password: '123456' })).status, 403);
    await manager.put(`/users/${li.id}`, { active: true, password: '654321' });
    assert.equal((await clerk.post('/auth/login', { username: 'xiaoli', password: '654321' })).status, 200);
  });

  test('重置密码不能为空', async () => {
    const users = (await manager.get('/users')).data;
    const li = users.find((u) => u.username === 'xiaoli');
    assert.equal((await manager.put(`/users/${li.id}`, { password: '' })).status, 400);
  });

  test('修改自己的密码', async () => {
    assert.equal((await clerk.post('/auth/password', { old_password: 'bad', new_password: '111111' })).status, 400);
    assert.equal((await clerk.post('/auth/password', { old_password: '654321', new_password: '111111' })).status, 200);
  });
});

describe('打印站与备份', () => {
  const pc = client();
  const PC = { station_id: 'pc-1', station_name: '王店长 · Windows 电脑' };

  test('手机开单发送到打印站，等待中的打印站立即收到', async () => {
    await pc.post('/auth/login', { username: 'boss', password: 'boss123' });
    const waiting = pc.post('/print-jobs/claim?wait=1', PC);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await clerk.get('/print-jobs/status')).data.station_online, true);
    const created = await clerk.post('/orders', {
      customer: { code: '123456' },
      items: [{ category_id: catId('书包'), quantity: 1 }],
      print: 'station',
    });
    assert.equal(created.data.station_online, true);
    const got = await waiting;
    assert.equal(got.data.order.id, created.data.id);
    assert.equal(got.data.settings.label.width, 50);
    // 只返回标签需要的字段
    assert.equal(got.data.order.cancel_reason, undefined);
    assert.equal(got.data.order.created_by_name, undefined);
    await pc.post(`/print-jobs/${got.data.job.id}/done`);
    assert.equal((await pc.post('/print-jobs/claim', PC)).data.job, null);
  });

  test('打印单张、整单：打印站收到对应的任务类型', async () => {
    const created = await clerk.post('/orders', {
      customer: { code: '123456' },
      items: [{ category_id: catId('衣物'), quantity: 3 }],
    });
    const id = created.data.id;
    assert.equal((await clerk.post('/print-jobs', { order_id: id, kind: 'piece', piece: 4 })).status, 400); // 只有 3 件
    assert.equal((await clerk.post('/print-jobs', { order_id: id, kind: 'xx' })).status, 400);
    assert.equal((await clerk.post('/print-jobs', { order_id: id, kind: 'piece', piece: 2 })).status, 201);
    assert.equal((await clerk.post('/print-jobs', { order_id: id, kind: 'order' })).status, 201);
    const one = await pc.post('/print-jobs/claim', PC);
    assert.deepEqual(one.data.job, { id: one.data.job.id, kind: 'piece', piece: 2 });
    await pc.post(`/print-jobs/${one.data.job.id}/done`);
    const whole = await pc.post('/print-jobs/claim', PC);
    assert.equal(whole.data.job.kind, 'order');
    assert.equal(whole.data.job.piece, null);
    await pc.post(`/print-jobs/${whole.data.job.id}/done`);
  });

  test('领取后没确认打印完成的任务会重新排队', async () => {
    const created = await clerk.post('/orders', {
      customer: { code: '123456' },
      items: [{ category_id: catId('浴巾'), quantity: 1 }],
      print: 'station',
    });
    const first = await pc.post('/print-jobs/claim', PC);
    assert.equal(first.data.order.id, created.data.id);
    assert.equal((await pc.post('/print-jobs/claim', PC)).data.job, null);
    await new Promise((r) => setTimeout(r, 500));
    const again = await pc.post('/print-jobs/claim', PC);
    assert.equal(again.data.job.id, first.data.job.id);
    await pc.post(`/print-jobs/${again.data.job.id}/done`);
  });

  test('同一时间只允许一台打印站，换设备需要接管', async () => {
    const phone = client();
    await phone.post('/auth/login', { username: 'boss', password: 'boss123' });
    const PHONE = { station_id: 'phone-1', station_name: '王店长 · 安卓手机/平板' };
    const pcWaiting = pc.post('/print-jobs/claim?wait=1', PC);
    await new Promise((r) => setTimeout(r, 150));
    const refused = await phone.post('/print-jobs/claim', PHONE);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.station, PC.station_name);
    const taken = await phone.post('/print-jobs/claim', { ...PHONE, takeover: true });
    assert.equal(taken.status, 200);
    const pcResult = await pcWaiting;
    assert.equal(pcResult.data.replaced, true);
    assert.equal((await pc.post('/print-jobs/claim', PC)).status, 409);
    // 换回电脑
    assert.equal((await pc.post('/print-jobs/claim', { ...PC, takeover: true })).status, 200);
  });

  test('店员不能打印作废/已取的订单，不能清空队列', async () => {
    assert.equal((await clerk.post('/print-jobs', { order_id: order1.id })).status, 403); // 已取
    await manager.post(`/orders/${order2.id}/cancel`, { reason: '测试' });
    assert.equal((await manager.post('/print-jobs', { order_id: order2.id })).status, 400); // 作废
    assert.equal((await clerk.post('/print-jobs/clear')).status, 403);
    assert.equal((await manager.post('/print-jobs/clear')).status, 200);
  });

  test('超期按自然日计算（送来满 N 天）', async () => {
    const pad = (n) => String(n).padStart(2, '0');
    const dayAgo = (n) => {
      const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      d.setDate(d.getDate() - n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const make = (day, time) =>
      clerk.post('/orders', { customer: { code: '123456' }, items: [{ category_id: catId('毛巾'), quantity: 1 }], received_at: `${day}T${time}` });
    const late = (await make(dayAgo(7), '23:50')).data; // 第 7 天（不足 7×24 小时）
    const fresh = (await make(dayAgo(6), '00:10')).data; // 第 6 天
    const overdue = (await manager.get('/orders?overdue=1&page_size=100')).data.items.map((o) => o.id);
    assert.ok(overdue.includes(late.id));
    assert.ok(!overdue.includes(fresh.id));
  });

  test('下载数据备份', async () => {
    const r = await manager.get('/settings/backup');
    assert.equal(r.status, 200);
    assert.equal(r.data.subarray(0, 15).toString(), 'SQLite format 3');
  });
});
