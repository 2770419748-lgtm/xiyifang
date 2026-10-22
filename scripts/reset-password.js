// 忘记密码时使用：node scripts/reset-password.js <用户名> <新密码>
// 会同时启用该账号，并让它在所有设备上重新登录。请在服务器所在电脑上运行。
const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.log('用法：npm run reset-password -- <用户名> <新密码>');
  console.log('例如：npm run reset-password -- admin 123456');
  process.exit(1);
}

const { q, tx } = await import('../server/db.js');
const { hashPassword, validatePassword } = await import('../server/auth.js');

const user = q.get('SELECT * FROM users WHERE username = ?', username);
if (!user) {
  const names = q.all('SELECT username, display_name, role FROM users ORDER BY id');
  console.log(`找不到用户「${username}」。现有账号：`);
  for (const u of names) console.log(`  ${u.username}（${u.display_name}，${u.role === 'manager' ? '店长' : '店员'}）`);
  process.exit(1);
}

try {
  validatePassword(password);
} catch (e) {
  console.log(e.message);
  process.exit(1);
}

tx(() => {
  q.run('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', hashPassword(password), user.id);
  q.run('DELETE FROM sessions WHERE user_id = ?', user.id);
});
console.log(`已重置「${user.display_name}」(${user.username}) 的密码。`);
