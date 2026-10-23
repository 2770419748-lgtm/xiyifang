import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { authenticate } from './auth.js';
import { startMaintenance } from './backup.js';
import { openBrowser } from './browser.js';
import { config } from './config.js';
import { db } from './db.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import customerRoutes from './routes/customers.js';
import orderRoutes from './routes/orders.js';
import printRoutes from './routes/print.js';
import settingsRoutes from './routes/settings.js';
import statsRoutes from './routes/stats.js';
import userRoutes from './routes/users.js';
import { HttpError } from './util.js';

const app = express();
app.disable('x-powered-by');
// 如果用 nginx 等反向代理部署在同一台机器上，可以正确获取客户端 IP
app.set('trust proxy', 'loopback');

app.use('/api', express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => {
  req.body ??= {};
  res.set('Cache-Control', 'no-store');
  // 防跨站请求伪造：写操作必须带自定义请求头（其他网站无法伪造）
  if (!['GET', 'HEAD'].includes(req.method) && req.get('x-requested-with') !== 'fetch') {
    throw new HttpError(403, '非法请求');
  }
  next();
});
app.use('/api', authenticate);
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/print-jobs', printRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 前端页面与依赖（Vue 已放在 public/vendor，不依赖外网 CDN）
app.use(express.static(path.join(config.root, 'public')));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: '请求数据格式错误' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: '请求数据过大' });
  console.error(err);
  res.status(500).json({ error: '服务器出错了，请稍后重试' });
});

startMaintenance();

const server = app.listen(config.port, config.host, () => {
  const urls = [`http://localhost:${config.port}`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${config.port}`);
    }
  }
  console.log('洗衣房管理系统已启动，访问地址：');
  for (const u of urls) console.log(`  ${u}`);
  console.log('手机和电脑连同一个 WiFi，用手机浏览器打开上面的局域网地址（192.168 开头）即可使用。');
  // start.bat 启动时自动打开“直接打印”的浏览器窗口（打印不弹预览）
  if (process.env.OPEN_BROWSER === '1' && process.platform === 'win32') {
    if (openBrowser(`http://localhost:${config.port}/?direct=1`)) {
      console.log('已打开浏览器窗口（标题带“直接打印”），在这个窗口里打印不弹预览，直接出标签。');
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${config.port} 已被占用。可能系统已经在运行，或者换个端口：PORT=3001 npm start`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
