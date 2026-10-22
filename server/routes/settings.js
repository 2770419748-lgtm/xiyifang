import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { requireLogin, requireManager } from '../auth.js';
import { snapshotTo } from '../backup.js';
import { config } from '../config.js';
import { getSettings, saveSettings } from '../settings.js';
import { now } from '../time.js';

const router = Router();

router.get('/', requireLogin, (req, res) => {
  res.json(getSettings());
});

router.put('/', requireManager, (req, res) => {
  res.json(saveSettings(req.body));
});

// 下载数据备份（SQLite 数据库文件）
router.get('/backup', requireManager, (req, res, next) => {
  const stamp = now().slice(0, 16).replace(/[-: ]/g, '');
  const file = path.join(config.dataDir, 'tmp', `backup-${stamp}-${process.pid}-${Date.now()}.db`);
  snapshotTo(file);
  res.download(file, `洗衣房数据备份-${stamp}.db`, (err) => {
    fs.rm(file, { force: true }, () => {});
    if (err && !res.headersSent) next(err);
  });
});

export default router;
