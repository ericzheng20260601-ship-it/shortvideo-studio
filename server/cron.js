'use strict';
const fs = require('node:fs');
const path = require('node:path');
const U = require('./lib/util');
const DB = require('./lib/db');
const D = require('./modules/discover');
const R = require('./modules/remix');
const A = require('./lib/auth');

let timer = null;
let pumping = false;
let lastRecover = 0;

/* 进程重启 / 容器漂移 / OOM 后，status='running' 的任务会永久卡死：
   nextQueued 只捞 queued，pump 又把 running 计入并发槽，队列从此不再推进。
   启动时把这些任务放回 queued；运行时每 5 分钟兜底扫一次。
   重跑是幂等的：已生成的画幅会被复用，中断写坏的半成品直接清掉重渲。 */
function staleMinutes() { return U.clamp(U.int(DB.getConfig('remix.staleMinutes'), 30), 5, 240); }
function recoverStaleJobs({ all = false } = {}) {
  const cutoff = new Date(Date.now() - staleMinutes() * 60000).toISOString();
  const rows = all
    ? DB.all("SELECT id,batch_id FROM remix_jobs WHERE status='running'")
    : DB.all("SELECT id,batch_id FROM remix_jobs WHERE status='running' AND updated_at < ?", cutoff);
  for (const j of rows) {
    // 被强杀的 ffmpeg 可能留下可播放但截断的 MP4，清掉未完成的画幅避免当成成片复用
    try {
      const dir = path.join(U.OUTPUT_DIR, j.id);
      for (const f of fs.readdirSync(dir)) if (/^output_.*\.mp4$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    } catch { /* 目录不存在时忽略 */ }
    DB.update('remix_jobs', j.id, { status: 'queued', stage: '等待续跑', progress: 10, error: null, updated_at: U.now() });
    DB.insert('job_events', { job_id: j.id, ts: U.now(), stage: '恢复', message: all ? '进程退出，任务放回队列' : '检测到僵死任务，自动放回队列' });
    R.syncBatchCounts(j.batch_id);
  }
  if (rows.length) console.log(`[queue] 恢复 ${rows.length} 个中断任务`);
  return rows.length;
}

function hourNow() {
  const tz = U.str(DB.getConfig('discover.timezone')) || 'Asia/Shanghai';
  try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date())); }
  catch { return new Date().getHours(); }
}
function dayInTz() {
  const tz = U.str(DB.getConfig('discover.timezone')) || 'Asia/Shanghai';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return U.day(); }
}

async function ensureInitialSync() {
  if (!DB.getConfig('discover.lastSyncDay')) {
    try { const r = await D.sync({ manual: false, actor: 'boot' }); console.log(`[boot] 首次数据同步完成：${r.total} 条 / ${r.source}`); }
    catch (e) { console.error('[boot] 首次同步失败：', e.message); }
  }
}
async function tick() {
  if (Date.now() - lastRecover > 5 * 60000) { lastRecover = Date.now(); recoverStaleJobs(); }
  const d = dayInTz(), h = hourNow();
  const syncHour = U.int(DB.getConfig('discover.syncHour'), 8);
  const digestHour = U.int(DB.getConfig('discover.digestHour'), 9);
  if (h >= syncHour && DB.getConfig('discover.lastSyncDay') !== d) {
    try { const r = await D.sync({ actor: 'cron' }); console.log(`[cron] 每日同步 ${d}：${r.total} 条`); }
    catch (e) { console.error('[cron] 同步失败：', e.message); }
  }
  if (h >= digestHour && DB.getConfig('discover.lastDigestDay') !== d) {
    try { const r = await D.sendDigest(d); console.log(`[cron] 日报 ${d}：${r.delivered ? '已推送' : '站内收件箱'}`); DB.setConfig('discover.lastDigestDay', d); }
    catch (e) { console.error('[cron] 日报失败：', e.message); }
  }
  await pump();
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const max = U.clamp(DB.getConfig('remix.maxConcurrent'), 1, 8);
    const active = DB.get("SELECT count(*) AS n FROM remix_jobs WHERE status='running'")?.n || 0;
    const slots = Math.max(0, max - active);
    if (!slots) return;
    const queued = R.nextQueued(slots);
    for (const j of queued) R.processJob(j.id).catch(e => console.error('[queue] job error', j.id, e.message));
  } finally { pumping = false; }
}
function start() {
  recoverStaleJobs();
  lastRecover = Date.now();
  ensureInitialSync().then(() => tick());
  timer = setInterval(() => tick().catch(e => console.error('[cron] tick error', e.message)), 15000);
  timer.unref?.();
  console.log('[cron] 定时任务已启动（同步 / 日报 / 混剪队列 / 僵死任务恢复）');
}
function stop() {
  if (timer) clearInterval(timer);
  // 优雅退出：把仍在跑的任务放回队列，避免下次启动后永久卡在 running
  recoverStaleJobs({ all: true });
}
function status() {
  return {
    timezone: U.str(DB.getConfig('discover.timezone')),
    hourNow: hourNow(), dayInTz: dayInTz(),
    syncHour: U.int(DB.getConfig('discover.syncHour'), 8),
    digestHour: U.int(DB.getConfig('discover.digestHour'), 9),
    lastSyncDay: DB.getConfig('discover.lastSyncDay') || null,
    lastDigestDay: DB.getConfig('discover.lastDigestDay') || null,
    queueActive: DB.get("SELECT count(*) AS n FROM remix_jobs WHERE status='running'")?.n || 0,
    queueWaiting: DB.get("SELECT count(*) AS n FROM remix_jobs WHERE status='queued'")?.n || 0
  };
}
module.exports = { start, stop, tick, pump, status, ensureInitialSync, recoverStaleJobs };
