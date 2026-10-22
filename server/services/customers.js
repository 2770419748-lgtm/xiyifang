import { q } from '../db.js';
import { now } from '../time.js';
import { CODE_RE, HttpError, text } from '../util.js';

const brief = (c) => ({ id: c.id, name: c.name, code: c.code, member_type: c.member_type });

export function validateCode(value) {
  const code = String(value ?? '').trim();
  if (!CODE_RE.test(code)) throw new HttpError(400, '编码必须是 4 位或 6 位数字');
  return code;
}

export function validateCustomer(input) {
  return {
    name: text(input.name, { label: '客户姓名', max: 30, required: true }),
    code: validateCode(input.code),
    phone: text(input.phone, { label: '电话', max: 20 }),
    note: text(input.note, { label: '备注', max: 200 }),
  };
}

export function createCustomer({ name, code, phone = '', note = '', member_type = 'regular', base_code = null }) {
  const t = now();
  const id = Number(
    q.run(
      `INSERT INTO customers (name, code, phone, note, member_type, base_code, member_since, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name,
      code,
      phone,
      note,
      member_type,
      base_code,
      member_type === 'package' ? t : null,
      t,
      t,
    ).lastInsertRowid,
  );
  return q.get('SELECT * FROM customers WHERE id = ?', id);
}

/**
 * 开单/改单时确定客户（编码可以重复，同名也可以有不同编码）：
 * 1. 传了 customer_id：直接使用选中的客户
 * 2. 编码 + 姓名与老客户一致：使用老客户
 * 3. 只填编码：编码只对应一位客户就用他；对应多位客户返回 409，由前端弹出姓名选择
 * 4. 编码没人用过：新建客户
 * 5. 编码已有其他客户、姓名是新的：返回 409 让店员确认是老客户还是新客户；force_new 表示确认新建
 */
export function resolveCustomer(body) {
  if (body.customer_id != null && body.customer_id !== '') {
    const c = q.get('SELECT * FROM customers WHERE id = ?', Number(body.customer_id));
    if (!c) throw new HttpError(404, '客户不存在');
    return c;
  }
  const input = body.customer || {};
  const code = validateCode(input.code);
  const name = String(input.name ?? '').trim();
  // 包期会员报原来的 4 位编码也能找到（base_code）
  const sameCode = q.all('SELECT * FROM customers WHERE code = ? OR base_code = ? ORDER BY id', code, code);

  if (!name) {
    if (sameCode.length === 1) return sameCode[0];
    if (sameCode.length > 1) {
      throw new HttpError(409, `编码 ${code} 有 ${sameCode.length} 位客户`, { conflict: sameCode.map(brief), can_force: false });
    }
    throw new HttpError(400, '新客户请填写姓名');
  }

  const exact = sameCode.find((c) => c.name === name);
  if (exact) return exact;

  const data = validateCustomer({ ...input, code });
  if (sameCode.length && !body.force_new) {
    const names = sameCode.map((c) => c.name).join('、');
    throw new HttpError(409, `编码 ${code} 已有客户「${names}」`, { conflict: sameCode.map(brief), can_force: true });
  }
  return createCustomer(data);
}
