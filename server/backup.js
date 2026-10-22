import fs from 'node:fs';
import path from 'node:path';
import { purgeExpiredSessions } from './auth.js';
import { config } from './config.js';
import { db, q } from './db.js';
import { addDays, now, shiftMinutes, today } from './time.js';

export const backupDir = path.join(config.dataDir, 'backups');

// 生成一份一致的数据库快照（运行中也可安全执行）
export function snapshotTo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
}

// 每天一份自动备份，保留最近 N 天
export function dailyBackup() {
  const file = path.join(backupDir, `laundry-${today()}.db`);
  if (!fs.existsSync(file)) snapshotTo(file);
  const keepFrom = addDays(today(), -config.backupKeepDays);
  for (const name of fs.readdirSync(backupDir)) {
    const m = name.match(/^laundry-(\d{4}-\d{2}-\d{2})\.db$/);
    if (m && m[1] < keepFrom) fs.rmSync(path.join(backupDir, name), { force: true });
  }
}

function maintenance() {
  try {
    dailyBackup();
  } catch (err) {
    console.error('自动备份失败：', err.message);
  }
  try {
    purgeExpiredSessions();
    q.run('DELETE FROM print_jobs WHERE created_at < ?', shiftMinutes(now(), -30 * 24 * 60));
  } catch (err) {
    console.error('数据清理失败：', err.message);
  }
}

export function startMaintenance() {
  maintenance();
  setInterval(maintenance, 60 * 60 * 1000).unref();
}
