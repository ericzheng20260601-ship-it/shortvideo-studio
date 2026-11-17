'use strict';
/**
 * 短视频工作台 · 桌面启动器（纯 Node，不依赖 Electron）
 *
 * 职责：定位运行时 → 准备数据目录/首次管理员凭据 → 拉起 server/index.js
 *       → 等健康检查 → 优雅关闭。Electron 主进程直接 require 复用；
 *       也可 `node desktop/launcher.js` 单独运行，用于本机验证与「绿色版」。
 *
 * 关键约束：server 用 node:sqlite（Node >= 22.5），因此必须用一个带
 * node:sqlite 的 Node 运行时，不能想当然用 Electron 内置的 Node。
 */
const { spawn, spawnSync, exec } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

const DEFAULTS = {
  adminEmail: 'ericzheng20260601@gmail.com',
  port: 17800,
  host: '127.0.0.1',
  tz: 'Asia/Shanghai'
};

let state = null;

function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function defaultDataDir() { return path.join(os.homedir(), '.shortvideo-studio', 'data'); }

/** 应用资源根目录：打包态由 Electron 显式传入，源码态用 staging 或工程根。 */
function appRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  const staged = path.join(__dirname, 'staging', 'app');
  if (fs.existsSync(path.join(staged, 'server', 'index.js'))) return staged;
  return path.resolve(__dirname, '..');
}

/** 随包运行时目录：Electron 打包后是 resources/runtime，源码态是 desktop/runtime。 */
function runtimeRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'runtime'))) {
    return path.join(process.resourcesPath, 'runtime');
  }
  return path.join(__dirname, 'runtime');
}

/* ---------------- Node 运行时解析与能力探测 ---------------- */

function nodeCandidates(opts) {
  const rt = runtimeRoot(opts.runtimeRoot);
  const packed = process.platform === 'win32'
    ? path.join(rt, 'node.exe')
    : path.join(rt, 'bin', 'node');
  const cands = [
    { bin: opts.nodeBin || process.env.SV_NODE_BIN, shell: false },
    { bin: packed, shell: false },
    { bin: process.execPath, shell: false },
    { bin: 'node', shell: process.platform === 'win32' }
  ].filter(c => c.bin);
  for (const c of cands) c.electronMode = /electron/i.test(path.basename(c.bin));
  return cands;
}

function runProbe(c) {
  const env = { ...process.env };
  if (c.electronMode) env.ELECTRON_RUN_AS_NODE = '1';
  const r = spawnSync(c.bin, ['--no-warnings', '-e', 'require("node:sqlite"); process.stdout.write("ok")'], {
    env, encoding: 'utf8', timeout: 15000, windowsHide: true, shell: c.shell
  });
  return r.status === 0 && String(r.stdout || '').trim() === 'ok';
}

function resolveNode(opts) {
  const tried = [];
  for (const c of nodeCandidates(opts)) {
    tried.push(c.bin);
    if (fs.existsSync(c.bin) || c.bin === 'node' || c.bin === process.execPath) {
      if (runProbe(c)) return c;
    }
  }
  throw new Error(
    '未找到可用的 Node >= 22.5 运行时（需支持 node:sqlite）。\n' +
    '已尝试：' + tried.join('、') + '\n' +
    '请在构建机执行 `node desktop/prepare-runtime.js` 生成随包运行时，或安装 Node 22 后设置 SV_NODE_BIN。'
  );
}

/* ---------------- 数据目录与首次登录凭据 ---------------- */

function initialCredentials(dataDir, opts) {
  const dbFile = path.join(dataDir, 'studio.sqlite');
  const email = opts.adminEmail || process.env.SV_ADMIN_EMAIL || DEFAULTS.adminEmail;
  const configured = opts.adminPassword || process.env.SV_ADMIN_PASSWORD;
  if (fs.existsSync(dbFile)) {
    return { email, password: configured || null, isNew: false, noteFile: null };
  }
  // 随机密码末尾固定带数字，满足服务端「字母 + 数字」的改密校验规则
  const password = configured || `Sv@${crypto.randomBytes(6).toString('hex')}9`;
  const noteFile = path.join(dataDir, '初始管理员.txt');
  fs.writeFileSync(noteFile,
    '短视频工作台 · 首次登录凭据（请保存到密码管理器后删除本文件）\n' +
    `管理员邮箱：${email}\n` +
    `初始密码：${password}\n` +
    '首次登录后请立刻在「右上角头像 → 账户信息 → 修改密码」改密。\n' +
    '其他成员由管理员在「管理后台 → 云服务器管理 → 成员与角色」邀请。\n',
    { mode: 0o600 });
  return { email, password, isNew: true, noteFile };
}

/* ---------------- ffmpeg ---------------- */

function findFFmpeg(opts) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const root = appRoot(opts.appRoot);
  const cands = [
    process.env.SV_FFMPEG_PATH,
    path.join(runtimeRoot(opts.runtimeRoot), `ffmpeg${ext}`),
    path.join(root, 'server', 'node_modules', 'ffmpeg-static', `ffmpeg${ext}`),
    path.join(root, 'node_modules', 'ffmpeg-static', `ffmpeg${ext}`)
  ].filter(Boolean);
  return cands.find(p => fs.existsSync(p)) || null;
}

/* ---------------- 端口 ---------------- */

function portFree(host, port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host === '0.0.0.0' ? '0.0.0.0' : host);
  });
}
async function pickPort(host, start) {
  for (let p = start; p < start + 20; p++) if (await portFree(host, p)) return p;
  throw new Error(`端口 ${start}~${start + 19} 均被占用，请设置 SV_APP_PORT`);
}
function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

/* ---------------- 启动 ---------------- */

async function waitHealth(port, child, timeoutMs = 20000) {
  const url = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`后端进程提前退出（code=${child.exitCode}）`);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return (await r.json());
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('后端健康检查超时，请查看上方 [sv-server] 日志');
}

async function start(opts = {}) {
  if (state) return state.info;
  const root = appRoot(opts.appRoot);
  const entry = path.join(root, 'server', 'index.js');
  if (!fs.existsSync(entry)) throw new Error(`未找到服务端入口：${entry}\n请先执行 node desktop/stage-app.js`);

  const dataDir = path.resolve(opts.dataDir || process.env.SV_APP_DATA_DIR || defaultDataDir());
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const node = resolveNode(opts);
  const cred = initialCredentials(dataDir, opts);
  const host = opts.host || process.env.SV_APP_HOST || DEFAULTS.host;
  const port = await pickPort(host, int(opts.port || process.env.SV_APP_PORT, DEFAULTS.port));
  const ffmpeg = findFFmpeg(opts);

  const env = { ...process.env, NODE_ENV: 'production' };
  env.SV_DATA_DIR = dataDir;
  env.SV_HOST = host;
  env.PORT = String(port);
  env.SV_TZ = opts.tz || process.env.SV_TZ || DEFAULTS.tz;
  env.SV_ADMIN_EMAIL = cred.email;
  if (cred.password) env.SV_ADMIN_PASSWORD = cred.password;
  else delete env.SV_ADMIN_PASSWORD;
  if (ffmpeg) env.SV_FFMPEG_PATH = ffmpeg;
  if (node.electronMode) env.ELECTRON_RUN_AS_NODE = '1';
  else delete env.ELECTRON_RUN_AS_NODE;

  const args = ['--no-warnings', entry];
  const child = spawn(node.bin, args, {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: node.shell
  });
  child.stdout.on('data', d => process.stdout.write(`[sv-server] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[sv-server] ${d}`));
  child.on('exit', code => { if (state && state.child === child) console.log(`[launcher] 后端已退出（code=${code}）`); });

  let health;
  try { health = await waitHealth(port, child); }
  catch (e) { try { child.kill('SIGTERM'); } catch { /* ignore */ } throw e; }

  const url = `http://127.0.0.1:${port}/`;
  state = { child, info: { url, host, port, dataDir, appRoot: root, nodeBin: node.bin, ffmpeg, health, initial: cred, lanIPs: lanIPs() } };
  return state.info;
}

async function stop() {
  if (!state) return;
  const { child } = state;
  state = null;
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 6000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => { /* 忽略：无桌面环境时由用户手输 URL */ });
}

if (require.main === module) {
  (async () => {
    const info = await start();
    console.log('\n================ 短视频工作台（桌面版） ================');
    console.log(`访问地址：${info.url}`);
    console.log(`数据目录：${info.dataDir}`);
    console.log(`Node 运行时：${info.nodeBin}`);
    console.log(`ffmpeg：${info.ffmpeg || '未找到（批量混剪不可用，请安装或设置 SV_FFMPEG_PATH）'}`);
    if (info.initial.isNew) {
      console.log(`首次登录凭据已写入：${info.initial.noteFile}`);
      console.log(`管理员邮箱：${info.initial.email}`);
    } else {
      console.log('检测到已有数据，沿用现有账号与密码。');
    }
    if (info.host === '0.0.0.0') {
      console.log('局域网模式：同事可用浏览器访问 ' + info.lanIPs.map(ip => `http://${ip}:${info.port}/`).join(' 或 '));
      console.log('注意：局域网为 HTTP 明文，请仅在可信网络使用，并放行系统防火墙。');
    }
    console.log('=======================================================\n');
    if (!process.env.SV_APP_NO_OPEN) openBrowser(info.url);
    const bye = async () => { await stop(); process.exit(0); };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  })().catch(e => { console.error('[launcher] 启动失败：', e.message); process.exit(1); });
}

module.exports = { start, stop, appRoot, runtimeRoot, resolveNode, findFFmpeg, lanIPs };
