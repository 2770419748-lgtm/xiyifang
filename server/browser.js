// Windows：start.bat 启动系统后自动打开浏览器，用“直接打印”方式（--kiosk-printing，打印不弹预览，直接送到默认打印机）
// 使用单独的浏览器配置目录，已经开着的 Edge / Chrome 不影响；地址带 ?direct=1，页面据此标明这是直接打印的窗口
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function findBrowser(env = process.env) {
  const candidates = [
    [env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'],
  ];
  return candidates
    .filter(([base]) => base)
    .map((parts) => path.join(...parts))
    .find((p) => fs.existsSync(p));
}

export function openBrowser(url, env = process.env) {
  const exe = findBrowser(env);
  if (!exe) {
    console.log(`没有找到 Edge 或 Chrome，请手动打开浏览器访问 ${url}`);
    return null;
  }
  const profile = path.join(env.LOCALAPPDATA || env.TEMP || '.', 'LaundrySystemBrowser');
  const child = spawn(exe, ['--kiosk-printing', '--no-first-run', `--user-data-dir=${profile}`, url], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => console.log(`打开浏览器失败（${err.message}），请手动打开浏览器访问 ${url}`));
  child.unref();
  return exe;
}
