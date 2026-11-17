'use strict';
/**
 * Electron 主进程：起本地 Node 服务 → 用 BrowserWindow 装载 → 退出时优雅停服。
 * 所有业务逻辑都在 launcher.js 与 server/ 里，这里只是壳，升级时替换 resources/app 即可。
 */
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const launcher = require('./launcher');

let win = null;
let info = null;
let quitting = false;

function packagedRoot() {
  const p = path.join(process.resourcesPath || '', 'app');
  return fs.existsSync(path.join(p, 'server', 'index.js')) ? p : undefined;
}
function packagedRuntime() {
  const p = path.join(process.resourcesPath || '', 'runtime');
  return fs.existsSync(p) ? p : undefined;
}

function buildMenu() {
  const template = [
    {
      label: '工作台',
      submenu: [
        { label: '在浏览器中打开', click: () => info && shell.openExternal(info.url) },
        { label: '打开数据目录', click: () => info && shell.openPath(info.dataDir) },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '帮助',
      submenu: [{
        label: '运行状态',
        click: () => dialog.showMessageBox({
          type: 'info', title: '运行状态',
          message: info ? `服务地址 ${info.url}\n数据目录 ${info.dataDir}` : '服务尚未就绪',
          detail: info
            ? `Node：${info.nodeBin}\nffmpeg：${info.ffmpeg || '未找到（批量混剪不可用）'}\n` +
              `监听：${info.host}:${info.port}${info.host === '0.0.0.0' ? '（局域网模式）' : '（仅本机）'}`
            : ''
        })
      }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showFirstRunCredentials() {
  if (!info || !info.initial.isNew) return;
  const { email, password, noteFile } = info.initial;
  const r = await dialog.showMessageBox({
    type: 'warning',
    title: '请保存首次登录凭据',
    message: `管理员邮箱：${email}\n初始密码：${password}`,
    detail: '这份凭据只显示这一次，服务端只保存 PBKDF2 摘要，之后无法找回。\n' +
      '请存入密码管理器，登录后立即在「头像 → 账户信息 → 修改密码」改密。\n' +
      '其他成员由管理员在「管理后台 → 云服务器管理 → 成员与角色」邀请。',
    buttons: ['我已保存，开始使用', '同时打开凭据文件'],
    defaultId: 0, cancelId: 0
  });
  if (r.response === 1 && noteFile) shell.openPath(noteFile);
}

async function boot() {
  const root = packagedRoot();
  const runtime = packagedRuntime();
  info = await launcher.start({
    ...(root ? { appRoot: root } : {}),
    ...(runtime ? { runtimeRoot: runtime } : {}),
    dataDir: path.join(app.getPath('userData'), 'data'),
    host: process.env.SV_APP_HOST || '127.0.0.1',
    port: parseInt(process.env.SV_APP_PORT, 10) || undefined
  });

  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1080, minHeight: 680,
    title: '短视频工作台',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  win.loadURL(info.url);
  win.on('closed', () => { win = null; });

  buildMenu();
  await showFirstRunCredentials();

  if (info.host === '0.0.0.0') {
    console.log('[desktop] 局域网访问地址：', info.lanIPs.map(ip => `http://${ip}:${info.port}/`).join(' '));
  }
  if (!info.ffmpeg) {
    console.warn('[desktop] 未找到 ffmpeg：批量混剪不可用，请安装后设置 SV_FFMPEG_PATH');
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('ready', () => {
    boot().catch(e => {
      dialog.showErrorBox('启动失败', e.message);
      app.quit();
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', e => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    launcher.stop().finally(() => app.exit(0));
  });
}
