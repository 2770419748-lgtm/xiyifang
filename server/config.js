import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 所有配置都可以通过环境变量覆盖
export const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(root, process.env.DATA_DIR || 'data'),
  // 店铺所在时区，决定“今天”的划分和时间显示
  timeZone: process.env.APP_TIMEZONE || 'Asia/Shanghai',
  // 登录有效期（天），期间有操作会自动续期
  sessionDays: 30,
  // 自动备份保留天数
  backupKeepDays: 30,
  // 打印站领取任务后多久未确认打印完成就重新排队（毫秒）
  printLeaseMs: Number(process.env.PRINT_LEASE_MS) || 60000,
};
