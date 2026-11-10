'use strict';
const U = require('./lib/util');
const DB = require('./lib/db');
const D = require('./modules/discover');
const R = require('./modules/remix');
const A = require('./lib/auth');

let timer = null;
let pumping = false;

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
  ensureInitialSync().then(() => tick());
  timer = setInterval(() => tick().catch(e => console.error('[cron] tick error', e.message)), 15000);
  timer.unref?.();
  console.log('[cron] 定时任务已启动（同步 / 日报 / 混剪队列）');
}
function stop() { if (timer) clearInterval(timer); }
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
module.exports = { start, stop, tick, pump, status, ensureInitialSync };
