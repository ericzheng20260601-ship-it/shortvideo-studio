'use strict';
/**
 * 把运行桌面版所需的「应用资源」复制到 desktop/staging/app/。
 * 只带静态前端 + 服务端源码 + 账号名单，不带任何运行时数据、git、部署脚本。
 *
 * electron-builder 的 extraResources 直接指向 staging/app → resources/app，
 * 这样 server/lib/util.js 里 ROOT(= server/lib/../..) 正好落在 resources/app，
 * 静态资源路径与源码态完全一致，无需改服务端一行代码。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'staging', 'app');
const RUNTIME = path.join(__dirname, 'runtime');

const ROOT_FILES = ['index.html', 'styles.css', 'package.json'];
const DATA_FILES = ['data/accounts.json'];
const SERVER_TOP_FILES = ['index.js', 'cron.js', 'package.json'];
const SERVER_DIRS = ['lib', 'modules'];
const SERVER_KEEP_SCRIPTS = ['backup.js'];

function copyFile(rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) throw new Error(`缺少必需文件：${rel}`);
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyDir(rel, skip = new Set()) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) throw new Error(`缺少必需目录：${rel}`);
  fs.mkdirSync(path.join(OUT, rel), { recursive: true });
  let count = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(OUT, rel, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); count += copyTree(s, d, skip); }
    else if (e.isFile()) { fs.copyFileSync(s, d); count++; }
  }
  return count;
}
function copyTree(src, dst, skip) {
  let count = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); count += copyTree(s, d, skip); }
    else if (e.isFile()) { fs.copyFileSync(s, d); count++; }
  }
  return count;
}
function treeSize(dir) {
  let n = 0, bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = treeSize(p); n += s.n; bytes += s.bytes; }
    else if (e.isFile()) { n++; bytes += fs.statSync(p).size; }
  }
  return { n, bytes };
}

/** 当前平台的 ffmpeg 二进制可直接复用，省去构建机另行下载。跨平台构建须替换成对应平台版本。 */
function stageFFmpeg() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const src = [
    path.join(ROOT, 'server', 'node_modules', 'ffmpeg-static', `ffmpeg${ext}`),
    path.join(ROOT, 'node_modules', 'ffmpeg-static', `ffmpeg${ext}`)
  ].find(p => fs.existsSync(p));
  if (!src) {
    console.log('[stage] 未找到本机 ffmpeg-static 二进制，跳过；请用 prepare-runtime.js 准备。');
    return;
  }
  fs.mkdirSync(RUNTIME, { recursive: true });
  const dst = path.join(RUNTIME, `ffmpeg${ext}`);
  fs.copyFileSync(src, dst);
  if (process.platform !== 'win32') fs.chmodSync(dst, 0o755);
  console.log(`[stage] ffmpeg(${process.platform}/${process.arch}) → ${path.relative(ROOT, dst)}`);
}

(function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let n = 0;
  for (const f of ROOT_FILES) { copyFile(f); n++; }
  for (const f of DATA_FILES) { copyFile(f); n++; }
  for (const f of SERVER_TOP_FILES) { copyFile(path.join('server', f)); n++; }
  for (const d of SERVER_DIRS) n += copyDir(path.join('server', d), new Set(['data', 'node_modules']));
  for (const f of SERVER_KEEP_SCRIPTS) { copyFile(path.join('server', 'scripts', f)); n++; }
  n += copyDir('js');
  stageFFmpeg();
  const s = treeSize(OUT);
  console.log(`[stage] 应用资源 ${s.n} 个文件 / ${(s.bytes / 1024).toFixed(0)} KB → ${path.relative(ROOT, OUT)}`);
  console.log('[stage] 已排除：运行时数据、node_modules、.git、deploy/、Dockerfile、测试脚本。');
})();
