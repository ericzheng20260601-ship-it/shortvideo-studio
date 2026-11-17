'use strict';
/**
 * 为桌面安装包准备「随包运行时」：Node >= 22.5（含 node:sqlite）+ ffmpeg 二进制。
 *
 *   node desktop/prepare-runtime.js                 # 按当前平台下载
 *   node desktop/prepare-runtime.js --dry-run       # 只打印计划，不联网
 *   node desktop/prepare-runtime.js --node-version v22.22.2 --skip-ffmpeg
 *   node desktop/prepare-runtime.js --platform win32 --arch x64 --ffmpeg-from /path/ffmpeg.exe
 *
 * 产物：desktop/runtime/bin/node（win: runtime/node.exe）、desktop/runtime/ffmpeg[.exe]
 * 构建机需要联网；目标设备不需要预装 Node 或 ffmpeg。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const RUNTIME = path.join(__dirname, 'runtime');
const CACHE = path.join(__dirname, '.cache');

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const eq = process.argv.find(a => a.startsWith(prefix));
  if (eq) return eq.slice(prefix.length);
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}
const flag = name => process.argv.includes(`--${name}`);
const platform = arg('platform', process.platform);
const arch = arg('arch', process.arch);
const dryRun = flag('dry-run');
const skipFFmpeg = flag('skip-ffmpeg');

async function download(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`下载失败 ${r.status}：${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log(`[runtime] 已下载 ${(buf.length / 1024 / 1024).toFixed(1)} MB → ${path.basename(dest)}`);
  return dest;
}

async function latestV22() {
  const explicit = arg('node-version', '');
  if (explicit) return explicit.startsWith('v') ? explicit : `v${explicit}`;
  if (dryRun) return 'v22.x.x'; // dry-run 不联网
  console.log('[runtime] 查询 Node 22 最新版本号…');
  const r = await fetch('https://nodejs.org/dist/index.json', { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`无法读取 Node 版本列表（${r.status}），请用 --node-version 指定`);
  const hit = (await r.json()).find(x => x.version.startsWith('v22.'));
  if (!hit) throw new Error('版本列表里没有 v22.x');
  return hit.version;
}

function unpack(archive, dest, isZip) {
  fs.mkdirSync(dest, { recursive: true });
  if (isZip) {
    if (platform === 'win32') {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${dest}" -Force`], { stdio: 'inherit' });
    } else {
      execFileSync('unzip', ['-q', '-o', archive, '-d', dest], { stdio: 'inherit' });
    }
  } else {
    execFileSync('tar', ['-xJf', archive, '-C', dest], { stdio: 'inherit' });
  }
}

function probe(nodeBin) {
  const r = spawnSync(nodeBin, ['--no-warnings', '-e', 'require("node:sqlite"); console.log(process.version)'],
    { encoding: 'utf8', timeout: 15000 });
  return r.status === 0 ? String(r.stdout || '').trim() : null;
}

async function prepareNode() {
  const version = await latestV22();
  const isWin = platform === 'win32';
  const pkg = `node-${version}-${isWin ? 'win' : platform}-${arch}`;
  const ext = isWin ? '.zip' : '.tar.xz';
  const url = `https://nodejs.org/dist/${version}/${pkg}${ext}`;
  console.log(`[runtime] 平台 ${platform}/${arch}，Node ${version}`);
  console.log(`[runtime] URL ${url}`);
  if (dryRun) return;

  const archive = await download(url, path.join(CACHE, `${pkg}${ext}`));
  const tmp = path.join(CACHE, `unpack-${pkg}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  unpack(archive, tmp, isWin);

  const src = isWin ? path.join(tmp, pkg, 'node.exe') : path.join(tmp, pkg, 'bin', 'node');
  if (!fs.existsSync(src)) throw new Error(`解压后未找到 ${src}`);
  const dst = isWin ? path.join(RUNTIME, 'node.exe') : path.join(RUNTIME, 'bin', 'node');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if (!isWin) fs.chmodSync(dst, 0o755);
  const v = probe(dst);
  if (!v) throw new Error('随包 Node 缺少 node:sqlite，请使用 Node >= 22.5');
  console.log(`[runtime] Node 就绪：${path.relative(__dirname, dst)}（${v}，node:sqlite 通过）`);
}

async function prepareFFmpeg() {
  const ext = platform === 'win32' ? '.exe' : '';
  const dst = path.join(RUNTIME, `ffmpeg${ext}`);
  const from = arg('ffmpeg-from', '');
  console.log(`[runtime] ffmpeg 目标 ${path.relative(__dirname, dst)}`);
  if (dryRun) return;
  if (from) {
    if (!fs.existsSync(from)) throw new Error(`--ffmpeg-from 指向的文件不存在：${from}`);
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.copyFileSync(from, dst);
  } else if (process.platform === platform && process.arch === arch) {
    // stage-app.js 已经把本机 ffmpeg-static 二进制放进 runtime/，直接复用
    if (fs.existsSync(dst)) { console.log('[runtime] 复用 stage-app.js 准备的本机 ffmpeg'); return; }
    const local = path.resolve(__dirname, '..', 'server', 'node_modules', 'ffmpeg-static', `ffmpeg${ext}`);
    if (!fs.existsSync(local)) throw new Error('本机也没有 ffmpeg-static；请提供 --ffmpeg-from 或先 npm install');
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.copyFileSync(local, dst);
  } else {
    throw new Error(
      `交叉构建 ${platform}/${arch} 需要该平台的 ffmpeg 二进制。` +
      '请在对应平台执行 `npm install ffmpeg-static` 后用 --ffmpeg-from 指定其路径。'
    );
  }
  if (platform !== 'win32') fs.chmodSync(dst, 0o755);
  const r = spawnSync(dst, ['-version'], { encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) throw new Error(`ffmpeg 不可执行：${r.stderr || r.error?.message}`);
  console.log(`[runtime] ffmpeg 就绪：${String(r.stdout || '').split('\n')[0]}`);
}

(async () => {
  fs.mkdirSync(RUNTIME, { recursive: true });
  await prepareNode();
  if (!skipFFmpeg) await prepareFFmpeg();
  if (dryRun) console.log('[runtime] dry-run 完成，未下载任何文件。');
  else console.log(`[runtime] 完成。产物目录：${RUNTIME}（构建时由 electron-builder 放入 resources/runtime）`);
})().catch(e => { console.error('[runtime] 失败：', e.message); process.exitCode = 1; });
