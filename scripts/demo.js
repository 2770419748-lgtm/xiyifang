// 演示模式：使用独立的 data-demo 目录，自动生成近 45 天的示例数据后启动系统。
// 不会影响正式数据（正式数据在 data 目录）。演示账号：店长 admin / admin123，店员 xiaoli / 123456
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.resolve(root, process.env.DEMO_DATA_DIR || 'data-demo');
const realDir = path.resolve(root, process.env.DATA_DIR || 'data');
if (demoDir === realDir) {
  console.error('演示数据目录不能和正式数据目录相同，请修改 DEMO_DATA_DIR。');
  process.exit(1);
}
// 无论环境里有没有设置 DATA_DIR，演示模式都只读写演示目录
process.env.DATA_DIR = demoDir;

const { q, tx } = await import('../server/db.js');
const { hashPassword } = await import('../server/auth.js');
const { saveSettings } = await import('../server/settings.js');
const { packageLimits } = await import('../server/services/members.js');
const { nextOrderNo } = await import('../server/services/orders.js');
const { addDays, now, shiftMinutes } = await import('../server/time.js');

const PRICES = { 衣物: 1500, 鞋子: 2000, 床单: 1500, 被套: 2000, 枕头套: 500, 毛巾: 500, 书包: 2500, 浴巾: 800, 毛毯: 3000, 凉被: 2500, 围巾: 1000, 帽子: 1000 };
const WEIGHTS = { 衣物: 30, 鞋子: 12, 床单: 8, 被套: 7, 枕头套: 6, 毛巾: 8, 书包: 4, 浴巾: 6, 毛毯: 3, 凉被: 4, 围巾: 3, 帽子: 3 };
const SURNAMES = [...'王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高'];
const GIVEN = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '洋', '艳', '勇', '军', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平', '浩然', '子轩', '欣怡', '雨涵', '梓萱', '一诺', '思远', '嘉怡'];
const HOURS = [8, 9, 9, 10, 10, 11, 11, 12, 13, 14, 15, 16, 17, 17, 18, 18, 18, 19, 19, 20, 21];

// 固定种子的随机数，每次生成的数据一样
let seed = 20261022;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');

function seedDemo() {
  const t = now();
  const today = t.slice(0, 10);
  tx(() => {
    const addUser = (username, password, name, role) =>
      Number(
        q.run(
          'INSERT INTO users (username, password_hash, display_name, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)',
          username,
          hashPassword(password),
          name,
          role,
          t,
          t,
        ).lastInsertRowid,
      );
    const staff = [addUser('admin', 'admin123', '王店长', 'manager'), addUser('xiaoli', '123456', '小李', 'clerk'), addUser('xiaozhang', '123456', '小张', 'clerk')];

    for (const c of q.all('SELECT id, name FROM categories')) q.run('UPDATE categories SET price = ? WHERE id = ?', PRICES[c.name] ?? 1000, c.id);
    const cats = q.all('SELECT id, name, price FROM categories');
    const weighted = cats.flatMap((c) => Array(WEIGHTS[c.name] || 2).fill(c));

    const customers = [];
    const codes = new Set();
    for (let i = 0; i < 42; i++) {
      let code;
      do {
        code = rand() < 0.6 ? String(int(1000, 9999)) : String(int(100000, 999999));
      } while (codes.has(code));
      codes.add(code);
      const created = `${addDays(today, -int(46, 60))} 09:00:00`;
      const id = Number(
        q.run(
          'INSERT INTO customers (name, code, phone, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          pick(SURNAMES) + pick(GIVEN),
          code,
          rand() < 0.5 ? `13${int(100000000, 999999999)}` : '',
          '',
          created,
          created,
        ).lastInsertRowid,
      );
      customers.push(id);
    }
    // 演示“同一编码多位客户”：前 3 位客户共用编码 8888（比如同一宿舍）
    for (const id of customers.slice(0, 3)) q.run(`UPDATE customers SET code = '8888' WHERE id = ?`, id);
    // 演示“包期会员”：8 位 4 位编码的客户设为包期会员，编码前加 88
    const members = customers
      .slice(3)
      .filter((id) => /^\d{4}$/.test(q.get('SELECT code FROM customers WHERE id = ?', id).code))
      .slice(0, 8);
    for (const id of members) {
      q.run(
        `UPDATE customers SET member_type = 'package', base_code = code, code = '88' || code, member_since = ? WHERE id = ?`,
        `${addDays(today, -50)} 09:00:00`,
        id,
      );
    }
    // 包期会员：包期内的品类（衣物、鞋子）不收费
    const memberSet = new Set(members);
    const limited = new Set(packageLimits().map((l) => l.category_id));
    const amountOf = (customerId, items) =>
      items.reduce((s, i) => (memberSet.has(customerId) && limited.has(i.c.id) ? s : s + i.qty * i.c.price), 0);

    for (let d = 45; d >= 0; d--) {
      const day = addDays(today, -d);
      const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
      const count = int(4, 11) + (weekend ? 4 : 0);
      const times = Array.from({ length: count }, () => `${day} ${pad(pick(HOURS))}:${pad(int(0, 59))}:${pad(int(0, 59))}`)
        .filter((x) => x <= t)
        .sort();
      times.forEach((receivedAt, k) => {
        const lines = new Map();
        for (let j = int(1, 3); j > 0; j--) {
          const c = pick(weighted);
          lines.set(c.id, { c, qty: (lines.get(c.id)?.qty || 0) + (c.name === '衣物' ? int(1, 6) : int(1, 3)) });
        }
        const items = [...lines.values()];
        const qty = items.reduce((s, i) => s + i.qty, 0);
        const pickAt = shiftMinutes(receivedAt, int(1, 6) * 1440 + int(-240, 240));
        let status = 'pending';
        let pickedAt = null;
        let pickedBy = null;
        if (pickAt < t && rand() < 0.93) {
          status = 'picked';
          pickedAt = pickAt;
          pickedBy = pick(staff);
        }
        const cancelled = rand() < 0.02;
        const customerId = pick(customers);
        const orderId = Number(
          q.run(
            `INSERT INTO orders (order_no, customer_id, status, total_qty, amount, note, received_at, picked_at, created_by, picked_by,
               cancelled_at, cancelled_by, cancel_reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            `${day.slice(2).replaceAll('-', '')}-${String(k + 1).padStart(3, '0')}`,
            customerId,
            cancelled ? 'cancelled' : status,
            qty,
            amountOf(customerId, items),
            rand() < 0.15 ? pick(['白衬衫领口有污渍', '羽绒服请轻洗', '鞋子有破损', '加急', '深浅色分开洗']) : '',
            receivedAt,
            pickedAt,
            pick(staff),
            pickedBy,
            cancelled ? shiftMinutes(receivedAt, 20) : null,
            cancelled ? staff[0] : null,
            cancelled ? '录错了' : '',
            receivedAt,
            pickedAt || receivedAt,
          ).lastInsertRowid,
        );
        for (const i of items) {
          q.run('INSERT INTO order_items (order_id, category_id, quantity, unit_price) VALUES (?, ?, ?, ?)', orderId, i.c.id, i.qty, i.c.price);
        }
      });
    }

    // 演示“周末查看超额”：本周有 2 位包期会员超额，上周有 1 位
    const addOrder = (customerId, receivedAt, list, pickedAt = null) => {
      if (receivedAt > t) return;
      const items = list.map(([name, qty]) => ({ c: cats.find((c) => c.name === name), qty }));
      const orderId = Number(
        q.run(
          `INSERT INTO orders (order_no, customer_id, status, total_qty, amount, note, received_at, picked_at, created_by, picked_by,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
          nextOrderNo(receivedAt),
          customerId,
          pickedAt ? 'picked' : 'pending',
          items.reduce((s, i) => s + i.qty, 0),
          amountOf(customerId, items),
          receivedAt,
          pickedAt,
          staff[1],
          pickedAt ? staff[1] : null,
          receivedAt,
          pickedAt || receivedAt,
        ).lastInsertRowid,
      );
      for (const i of items) {
        q.run('INSERT INTO order_items (order_id, category_id, quantity, unit_price) VALUES (?, ?, ?, ?)', orderId, i.c.id, i.qty, i.c.price);
      }
    };
    const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    addOrder(members[0], shiftMinutes(t, -50), [['衣物', 12]]);
    addOrder(members[1], shiftMinutes(t, -130), [['衣物', 4], ['鞋子', 2]]);
    addOrder(members[2], `${addDays(monday, -4)} 10:20:00`, [['衣物', 11]], `${addDays(monday, -2)} 17:40:00`);
  });
  saveSettings({ enable_price: true, shop_name: '阳光洗衣房（演示）' });
  console.log('已生成演示数据。演示账号：店长 admin / admin123，店员 xiaoli / 123456（编码 8888 有 3 位客户；有 8 位包期会员，本周 2 位超额）');
}

if (q.get('SELECT COUNT(*) AS n FROM users').n === 0) seedDemo();

await import('../server/index.js');
