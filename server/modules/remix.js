'use strict';
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/util');
const DB = require('../lib/db');
const P = require('../lib/providers');
const A = require('../lib/auth');
const B = require('./breakdown');

const GRADES = [
  { key: 'brand', label: '品牌硬广', hint: '门头 / Logo / 包装' },
  { key: 'product', label: '产品展示', hint: '特写 / 细节 / 使用' },
  { key: 'scene', label: '场景氛围', hint: '环境 / 互动 / 空镜' },
  { key: 'voice', label: '口播配合', hint: '真人口播 / 数字人' }
];
const HOOK_KINDS = ['反常识', '数字锚点', '痛点提问'];
const SUBTITLE_STYLES = ['简约白', '描边黑', '高亮黄'];
const BGM_MOODS = ['轻快', '舒缓', '无音乐'];
const RATIOS = {
  '9:16': { w: 1080, h: 1920, label: 'TikTok / Reels / 抖音' },
  '1:1': { w: 1080, h: 1080, label: '信息流方形' },
  '16:9': { w: 1920, h: 1080, label: 'YouTube / 横版' }
};
const processing = new Set();

function event(jobId, stage, message) {
  DB.insert('job_events', { job_id: jobId, ts: U.now(), stage, message: U.str(message, 500) });
}
function setJob(job, patch) {
  DB.update('remix_jobs', job.id, { ...patch, updated_at: U.now() });
  if (patch.stage || patch.status) event(job.id, patch.stage || patch.status, patch.error || `状态：${patch.status || patch.stage}`);
}
function assets(ctx, { grade = '', kind = '' } = {}) {
  let rows = DB.all('SELECT * FROM media_assets ORDER BY created_at DESC LIMIT 200');
  if (grade) rows = rows.filter(r => r.grade === grade);
  if (kind) rows = rows.filter(r => r.kind === kind);
  return rows.map(r => ({ ...r, licenseNote: r.license_note, hasLocal: !!(r.local_path && fs.existsSync(r.local_path)) }));
}
function addAsset(ctx, body) {
  A.need(U.str(body.title).trim(), 400, '素材标题不能为空');
  A.need(GRADES.some(g => g.key === body.grade), 400, '分级必须为 brand/product/scene/voice');
  const id = DB.insert('media_assets', {
    user_id: ctx.user.id, org_id: body.orgId || null, project_id: body.projectId || null,
    title: U.str(body.title, 200), kind: ['video', 'audio', 'image'].includes(body.kind) ? body.kind : 'video',
    grade: body.grade, file_name: U.str(body.fileName, 200), storage_path: U.str(body.storagePath, 500),
    local_path: U.str(body.localPath, 500), size: U.int(body.size), duration_sec: Number(body.duration) || 0,
    license_note: U.str(body.licenseNote, 300) || '自有 / 已授权', created_at: U.now()
  });
  A.audit(ctx, 'remix.asset.add', id, body.title);
  return { id };
}
function gradeAsset(ctx, id, grade) {
  A.need(GRADES.some(g => g.key === grade), 400, '分级不合法');
  DB.run('UPDATE media_assets SET grade=? WHERE id=?', grade, id);
  A.audit(ctx, 'remix.asset.grade', id, grade);
  return { id, grade };
}

function localStoryboard({ prompt, style, duration, report, product }) {
  const hook = report?.hook?.text || P.HOOKS[0];
  const pain = report?.structure?.[1]?.text || P.PAINS[0];
  const proof = report?.structure?.[2]?.text || P.PROOFS[0];
  const cta = report?.structure?.[4]?.text || P.CTAS[0];
  const d = U.clamp(duration, 12, 90);
  const cuts = [0, 3, d * 0.28, d * 0.7, Math.max(0, d - 5), d];
  const labels = ['钩子', '痛点', '演示与证据', '卖点密度', 'CTA'];
  const texts = [hook, pain, proof, `${product || '商品'} 的关键卖点：看得见的效果与可复现的用法。`, cta];
  const grades = ['product', 'scene', 'product', 'brand', 'voice'];
  const scenes = labels.map((label, i) => ({
    id: `s${i + 1}`, label, start: Math.round(cuts[i] * 10) / 10, end: Math.round(cuts[i + 1] * 10) / 10,
    grade: grades[i], text: U.str(texts[i], 300), camera: ['推镜', '固定', '手持', '快切', '定格'][i],
    needOriginalBroll: i === 1 || i === 2
  }));
  return {
    prompt: U.str(prompt, 2000), style: U.str(style, 60) || '带货口播', duration: d,
    product: U.str(product, 60) || undefined,
    script: { hook, body: `${pain}。${proof}。`, cta }, scenes,
    constraints: ['不加绝对化用语', '单 CTA', '每段不超过 20 字', '原创 B-roll 占比建议 ≥30%'],
    sourceMode: 'local'
  };
}
async function plan(ctx, body) {
  const report = body.reportId ? B.report(body.reportId) : null;
  let sb = localStoryboard({ prompt: body.prompt, style: body.style, duration: U.int(body.duration, 30), report, product: body.product });
  // 字幕/文案语言：跟随前端「配音语言」选择；外部 LLM 模式下让模型直接用该语言写全部文案
  const lang = U.str(body.lang, 12) || 'zh-CN';
  const llm = await P.chatLLM([
    { role: 'system', content: `只输出 JSON：{duration:number,script:{hook,body,cta},scenes:[{id,label,start,end,grade,text,camera,needOriginalBroll}],constraints:string[]}。grade 只能是 brand/product/scene/voice。保持镜头总时长等于 duration。所有文本字段（script 与 scenes[].text）必须使用语言 ${lang} 书写。` },
    { role: 'user', content: `提示词：${U.str(body.prompt, 2000)}\n时长：${sb.duration} 秒\n参考结构：${U.toJson(report?.structure || [])}` }
  ], { expectJSON: true }).catch(() => null);
  if (llm && Array.isArray(llm.scenes) && llm.scenes.length) {
    sb = { ...sb, ...llm, prompt: sb.prompt, style: sb.style, duration: U.int(llm.duration, sb.duration), lang, sourceMode: 'llm-external' };
  } else {
    sb = { ...sb, lang };
  }
  const id = DB.insert('remix_plans', {
    user_id: ctx.user.id, project_id: body.projectId || null, prompt: sb.prompt,
    style: sb.style, duration_sec: sb.duration, storyboard_json: U.toJson(sb),
    source_mode: sb.sourceMode, created_at: U.now()
  });
  A.audit(ctx, 'remix.plan', id, sb.prompt.slice(0, 80));
  return { id, ...sb };
}
function plans(ctx, limit = 20) {
  return DB.all('SELECT id,prompt,style,duration_sec,source_mode,created_at FROM remix_plans ORDER BY created_at DESC LIMIT ?', U.clamp(limit, 1, 60));
}
function getPlan(id) {
  const r = DB.get('SELECT * FROM remix_plans WHERE id=?', id);
  return r ? { id: r.id, ...U.jsonParse(r.storyboard_json, {}) } : null;
}

function matrixOf(body) {
  const hooks = Array.isArray(body.hooks) && body.hooks.length ? body.hooks.slice(0, 8) : HOOK_KINDS;
  const subs = Array.isArray(body.subtitles) && body.subtitles.length ? body.subtitles.slice(0, 8) : SUBTITLE_STYLES;
  const bgms = Array.isArray(body.bgm) && body.bgm.length ? body.bgm.slice(0, 8) : BGM_MOODS;
  const durs = Array.isArray(body.durations) && body.durations.length ? body.durations.slice(0, 4).map(d => U.clamp(d, 10, 90)) : [30];
  // 语言与画幅：全批次统一。画幅缺省渲染全部三种；语言写入 voice 供 TTS / 外部模型使用；delogo 为去水印开关
  const ratios = Array.isArray(body.ratios) ? body.ratios.filter(r => RATIOS[r]).slice(0, 3) : [];
  const voice = U.str(body.voice, 40);
  const delogo = U.bool(body.delogo);
  const out = [];
  for (const h of hooks) for (const s of subs) for (const m of bgms) for (const d of durs) {
    out.push({
      hookKind: U.str(h, 30), subtitleStyle: U.str(s, 30), bgmMood: U.str(m, 30), duration: d,
      ...(ratios.length ? { ratios } : {}), ...(voice ? { voice } : {}), ...(delogo ? { delogo: true } : {})
    });
    if (out.length >= 50) return { variants: out, truncated: true };
  }
  return { variants: out, truncated: false };
}
function createBatch(ctx, body) {
  const p = getPlan(body.planId);
  A.need(p, 404, '请先生成分镜计划');
  let { variants, truncated } = matrixOf(body);
  A.need(variants.length > 0, 400, '变体矩阵为空');
  // 生产数量：显式指定 count 时把矩阵截断或轮换复制到精确条数，让「数量」成为权威参数（上限仍 50）
  const count = U.int(body.count, 0);
  if (count > 0) {
    A.need(count <= 50, 400, '单次最多 50 条');
    if (variants.length > count) { variants = variants.slice(0, count); truncated = true; }
    else if (variants.length < count) {
      const base = variants.slice(); let i = 0;
      while (variants.length < count) variants.push({ ...base[i++ % base.length] });
      truncated = true;
    }
  }
  const q = A.quotaCheck(ctx, 'jobs', variants.length);
  A.need(q.allowed, 429, `今日任务配额不足（已用 ${q.used}/${q.limit}）`);
  const id = DB.insert('remix_batches', {
    user_id: ctx.user.id, project_id: body.projectId || null, plan_id: p.id,
    name: U.str(body.name, 120) || `批次 ${U.day()} ${new Date().toTimeString().slice(0, 5)}`,
    matrix_json: U.toJson({ hooks: body.hooks, subtitles: body.subtitles, bgm: body.bgm, durations: body.durations, ratios: body.ratios, voice: U.str(body.voice, 40) || undefined, delogo: U.bool(body.delogo) || undefined, count: count || undefined, truncated }),
    total: variants.length, status: 'running', created_at: U.now(), updated_at: U.now()
  });
  variants.forEach((v, i) => DB.insert('remix_jobs', {
    batch_id: id, idx: i, variant_json: U.toJson(v), status: 'queued', progress: 0,
    stage: 'queued', created_at: U.now(), updated_at: U.now()
  }));
  A.quotaUse(ctx, 'jobs', variants.length);
  A.audit(ctx, 'remix.batch.create', id, { total: variants.length, truncated });
  return batch(id);
}
function batch(id) {
  const b = DB.get('SELECT * FROM remix_batches WHERE id=?', id);
  if (!b) throw new A.HttpError(404, '批次不存在');
  const jobs = DB.all('SELECT * FROM remix_jobs WHERE batch_id=? ORDER BY idx', id);
  const counts = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, blocked: 0 };
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  return {
    id: b.id, name: b.name, planId: b.plan_id, status: b.status, total: b.total,
    createdAt: b.created_at, updatedAt: b.updated_at, matrix: U.jsonParse(b.matrix_json, {}),
    counts, progress: jobs.length ? Math.round(jobs.reduce((s, j) => s + j.progress, 0) / jobs.length) : 0,
    jobs: jobs.map(j => ({
      id: j.id, idx: j.idx, status: j.status, progress: j.progress, stage: j.stage,
      variant: U.jsonParse(j.variant_json, {}), error: j.error, attempts: j.attempts,
      output: j.output_path ? path.basename(j.output_path) : null,
      qc: U.jsonParse(j.qc_json, null), ratios: U.jsonParse(j.ratios_json, [])
    }))
  };
}
function batches(ctx, limit = 30) {
  return DB.all('SELECT * FROM remix_batches ORDER BY created_at DESC LIMIT ?', U.clamp(limit, 1, 100)).map(b => ({
    id: b.id, name: b.name, status: b.status, total: b.total, done: b.done, failed: b.failed,
    createdAt: b.created_at, updatedAt: b.updated_at,
    progress: b.total ? Math.round((b.done / b.total) * 100) : 0
  }));
}
function cancelBatch(ctx, id) {
  const b = batch(id);
  DB.run(`UPDATE remix_jobs SET status='cancelled',stage='cancelled',updated_at=? WHERE batch_id=? AND status IN ('queued','running','blocked')`, U.now(), id);
  DB.update('remix_batches', id, { status: 'cancelled', updated_at: U.now() });
  A.audit(ctx, 'remix.batch.cancel', id, `${b.total} 个任务`);
  return batch(id);
}
function resumeBatch(ctx, id) {
  const b = batch(id);
  DB.run(`UPDATE remix_jobs SET status='queued',stage='requeued',progress=10,error=NULL,updated_at=? WHERE batch_id=? AND status IN ('failed','blocked','cancelled')`, U.now(), id);
  DB.update('remix_batches', id, { status: 'running', updated_at: U.now() });
  A.audit(ctx, 'remix.batch.resume', id, '');
  return batch(id);
}
function retryJob(ctx, id) {
  const j = DB.get('SELECT * FROM remix_jobs WHERE id=?', id);
  A.need(j, 404, '任务不存在');
  setJob(j, { status: 'queued', stage: 'requeued', progress: 10, error: null, attempts: j.attempts + 1 });
  A.audit(ctx, 'remix.job.retry', id, '');
  return { id, status: 'queued' };
}
function events(jobId, limit = 50) {
  return DB.all('SELECT ts,stage,message FROM job_events WHERE job_id=? ORDER BY ts DESC LIMIT ?', jobId, U.clamp(limit, 1, 200)).reverse();
}

/* 批量导出：把批次内全部已完成任务的成片（多画幅 MP4 + SRT + 配音）打成 tar.gz。
   返回 { file, count }，由路由层负责下发与清理临时包。 */
async function exportBatch(ctx, id) {
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const run = promisify(execFile);
  const b = DB.get('SELECT * FROM remix_batches WHERE id=?', id);
  A.need(b, 404, '批次不存在');
  // 权限：创建者本人，或 admin 及以上
  A.need(b.user_id === ctx.user.id || A.levelOf(ctx.user) >= A.ROLE_LEVEL.admin, 403, '只能导出自己的批次');
  const jobs = DB.all(`SELECT * FROM remix_jobs WHERE batch_id=? AND status='done' ORDER BY idx`, id);
  A.need(jobs.length, 400, '该批次还没有已完成的成片可导出');
  fs.mkdirSync(U.TMP_DIR, { recursive: true });
  const work = path.join(U.TMP_DIR, `export-${id}-${process.pid}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  let packed = 0;
  try {
    for (const j of jobs) {
      const src = path.join(U.OUTPUT_DIR, j.id);
      if (!fs.existsSync(src)) continue;
      const v = U.jsonParse(j.variant_json, {});
      const name = `#${String(j.idx + 1).padStart(2, '0')} ${v.hookKind || ''}·${v.subtitleStyle || ''}·${v.duration || ''}s`.replace(/[\\/:*?"<>|]/g, '-').trim();
      fs.cpSync(src, path.join(work, name), { recursive: true });
      packed++;
    }
    A.need(packed, 400, '成片文件缺失，无法导出');
    const file = path.join(U.TMP_DIR, `batch-export-${id}.tar.gz`);
    fs.rmSync(file, { force: true });
    await run('tar', ['-czf', file, '-C', work, '.'], { stdio: 'pipe' });
    A.audit(ctx, 'remix.batch.export', id, `${packed} 个任务`);
    return { file, count: packed };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
function syncBatchCounts(batchId) {
  const c = DB.get(`SELECT
    count(*) AS total,
    sum(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
    sum(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
    sum(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM remix_jobs WHERE batch_id=?`, batchId);
  const status = c.done + c.failed + c.cancelled >= c.total ? (c.done === c.total ? 'done' : 'partial') : 'running';
  DB.update('remix_batches', batchId, { done: c.done || 0, failed: c.failed || 0, cancelled: c.cancelled || 0, status, updated_at: U.now() });
}

/* ---------- 渲染 ---------- */
function fontPath() {
  const configured = U.str(P.C('remix.fontPath'));
  const cands = [configured, process.env.SV_FONT_FILE,
    '/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
  return cands.find(p => p && fs.existsSync(p)) || '';
}
function srtTime(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')},${String(Math.floor((s % 1) * 1000)).padStart(3, '0')}`;
}
function makeSRT(scenes, variant) {
  const lines = [];
  scenes.forEach((s, i) => {
    const text = i === 0 && variant.hookKind ? `[${variant.hookKind}] ${s.text}` : s.text;
    lines.push(String(i + 1), `${srtTime(s.start)} --> ${srtTime(s.end)}`, U.str(text, 300), '');
  });
  return lines.join('\n');
}
function bannedScan(text) {
  const words = P.CJSON('content.bannedWords', []);
  const hits = words.filter(w => U.str(text).includes(w));
  return { hits, passed: hits.length === 0 };
}
function buildPackage(scenes, variant, aigcLabel) {
  const hook = scenes[0]?.text || '';
  const cta = scenes.at(-1)?.text || '';
  const title = U.str(hook.replace(/[。！？!?]/g, ' '), 60) || '新品实测';
  const banned = bannedScan(scenes.map(s => s.text).join(' '));
  return {
    title, hashtags: ['#带货实测', '#好物分享', '#TikTokShop', `#${U.str(variant.hookKind, 20).replace(/\s/g, '')}`],
    description: `${title}\n${scenes.slice(1, -1).map(s => s.text).join(' ')}\n${cta}`,
    pinnedComment: '问得最多的三个问题：① 适合什么场景 ② 多久见效 ③ 怎么选规格，我置顶回复了。',
    objectionReplies: ['价格：现在有组合装更划算', '效果：视频里是连续使用的记录', '适配：按肤质/体型/场景分了三档'],
    aigcLabel: { required: !!aigcLabel, text: aigcLabel ? '本视频含 AI 生成内容' : '', note: '按目标平台要求开启；TikTok Shop Post Shoppable Video 提供 is_ai_generated 字段' },
    bannedWords: banned, subtitleStyle: variant.subtitleStyle, bgmMood: variant.bgmMood,
    publishNote: '仅生成待发草稿与物料包，不自动登录账号发布（账号风控与协议风险）'
  };
}
async function qcOutput(file) {
  const checks = [];
  let stderr = '';
  try {
    const r = await P.runFF(['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.003:d=1', '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 120000 });
    stderr = r.stderr || '';
  } catch (e) { stderr = String(e.message || ''); }
  const durM = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  const duration = durM ? (+durM[1]) * 3600 + (+durM[2]) * 60 + (+durM[3]) : 0;
  const mean = (stderr.match(/mean_volume:\s*(-?[\d.]+)/) || [])[1];
  const maxv = (stderr.match(/max_volume:\s*(-?[\d.]+)/) || [])[1];
  const blacks = (stderr.match(/black_start:[^\n]+/g) || []).length;
  const freezes = (stderr.match(/freeze_start:[^\n]+/g) || []).length;
  checks.push({ name: '时长', ok: duration > 0, detail: `${duration.toFixed(1)}s` });
  checks.push({ name: '黑帧', ok: blacks === 0, detail: blacks ? `检测到 ${blacks} 段` : '未检出' });
  checks.push({ name: '静帧', ok: freezes === 0, detail: freezes ? `检测到 ${freezes} 段` : '未检出' });
  checks.push({ name: '响度', ok: mean === undefined || Number(mean) > -45, detail: mean ? `mean ${mean} dB / max ${maxv || '—'} dB` : '未测到音轨' });
  checks.push({ name: '静音', ok: mean === undefined || Number(mean) > -60, detail: mean ? `mean ${mean} dB` : '未测到音轨' });
  checks.push({ name: '规格', ok: fs.existsSync(file) && fs.statSync(file).size > 1024, detail: fs.existsSync(file) ? `${(fs.statSync(file).size / 1024).toFixed(0)} KB` : '文件缺失' });
  return { passed: checks.every(c => c.ok), checks, duration, score: Math.round(checks.filter(c => c.ok).length / checks.length * 100) };
}
// CC 素材源（借鉴 ClipForge 0-Key 路径）：无本地素材时按关键词从 Wikimedia Commons 搜索 CC 视频，
// 下载缓存到 data/cc-broll/ 供渲染使用；失败返回 null（渲染回退占位画面）。事件里保留页面标题以便署名。
const brollCache = new Map();
async function fetchCCBroll(query) {
  const q = U.str(query, 120).trim();
  if (!q) return null;
  if (brollCache.has(q)) return brollCache.get(q);
  const dir = path.join(U.DATA_DIR, 'cc-broll');
  fs.mkdirSync(dir, { recursive: true });
  try {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch='
      + encodeURIComponent(`filetype:video ${q}`) + '&prop=imageinfo&iiprop=url|mime|size&format=json&origin=*';
    const data = await U.fetchJSON(url, { timeout: 8000 });
    const pages = Object.values((data.query || {}).pages || {});
    const vids = pages.map(pg => (pg.imageinfo || [])[0])
      .filter(i => i && /^video\//.test(i.mime) && i.url && i.size < 60 * 1024 * 1024);
    if (!vids.length) { brollCache.set(q, null); return null; }
    const info = vids[Math.floor(Math.random() * Math.min(vids.length, 3))];
    const key = Buffer.from(info.url).toString('base64url').slice(0, 24);
    const dest = path.join(dir, key + (path.extname(new URL(info.url).pathname) || '.webm'));
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 4096) {
      const resp = await fetch(info.url, { signal: AbortSignal.timeout(60000) });
      if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
      fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
    }
    if (fs.statSync(dest).size < 4096) throw new Error('下载内容过小');
    const result = { path: dest, title: U.str(info.url.split('/').pop().replace(/\.[a-z0-9]+$/i, ''), 80) };
    brollCache.set(q, result);
    return result;
  } catch (e) {
    brollCache.set(q, null);
    return null;
  }
}
// 用 ffmpeg 自身探测视频分辨率（环境内无 ffprobe）：-i 无输出会非零退出，从 stderr 的 Video 行解析 WxH
async function probeSize(file) {
  const parse = s => { const m = String(s || '').match(/Video:.*?(\d{2,5})x(\d{2,5})/); return m ? { w: +m[1], h: +m[2] } : null; };
  try {
    const r = await P.runFF(['-hide_banner', '-i', file, '-t', '0.1', '-f', 'null', '-'], { timeout: 30000 });
    return parse(r.stderr);
  } catch (e) { return parse(e.message); }
}
async function renderOne(job, p, variant, ratioKey, outPath, srtPath, ttsPath, videoAsset) {
  const R = RATIOS[ratioKey];
  const d = U.clamp(variant.duration || p.duration || 30, 5, 90);
  const color = ['0x1D9E75', '0x378ADD', '0xBA7517', '0x993C1D', '0x534AB7'][(job.idx + Object.keys(RATIOS).indexOf(ratioKey)) % 5];
  const enc = P.videoEncoder();
  // 有本地视频素材时以它为画面主体，循环补到目标时长；否则退回纯色占位。
  const clip = videoAsset && videoAsset.local_path && fs.existsSync(videoAsset.local_path) ? videoAsset.local_path : '';
  const font = fontPath();
  const srtEsc = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  // 字幕样式：底部居中、留出下边距避免贴边出界，两侧留白防溢出；字号缩小减少遮挡主体
  const subFilter = font && fs.existsSync(srtPath)
    ? `,subtitles=filename='${srtEsc}':force_style='FontName=Noto Sans CJK SC,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginL=24,MarginR=24,MarginV=32'`
    : '';
  // 去水印：对源片三个常见角标区域（左上 @用户名 / 右上 / 右下 logo）做 delogo 消除。
  // ffmpeg 6 的 delogo 不支持表达式，先用 ffmpeg 探测源片分辨率，再按比例换算像素坐标并夹取在合法范围内。
  const useDelogo = !!variant.delogo;
  let delogoVF = '';
  if (useDelogo && clip) {
    const sz = await probeSize(clip);
    if (sz && sz.w > 40 && sz.h > 40) {
      const rects = [
        [0.02, 0.04, 0.34, 0.09], // 左上（TikTok @用户名）
        [0.63, 0.04, 0.34, 0.09], // 右上（部分平台角标）
        [0.60, 0.84, 0.37, 0.12]  // 右下（抖音 logo）
      ].map(([rx, ry, rw, rh]) => {
        const x = Math.max(1, Math.round(sz.w * rx)), y = Math.max(1, Math.round(sz.h * ry));
        const w = Math.min(sz.w - x - 1, Math.round(sz.w * rw)), h = Math.min(sz.h - y - 1, Math.round(sz.h * rh));
        return w > 8 && h > 8 ? `delogo=x=${x}:y=${y}:w=${w}:h=${h}` : '';
      }).filter(Boolean).join(',');
      if (rects) { delogoVF = rects + ','; event(job.id, '渲染', `已启用去水印：源片 ${sz.w}x${sz.h}，对左上/右上/右下角标区域做模糊消除`); }
      else event(job.id, '渲染', '去水印已请求但源片分辨率过小，已跳过');
    } else event(job.id, '渲染', '去水印已请求但源片分辨率探测失败，已跳过（渲染继续）');
  }
  const build = (useClip, useSub, useDl) => {
    const inputs = useClip
      ? ['-stream_loop', '-1', '-i', clip]
      : ['-f', 'lavfi', '-i', `color=c=${color}:s=${R.w}x${R.h}:r=25:d=${d}`];
    const baseVF = useClip
      ? `scale=${R.w}:${R.h}:force_original_aspect_ratio=decrease,pad=${R.w}:${R.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25`
      : `scale=${R.w}:${R.h},setsar=1,fps=25`;
    return ['-y', ...inputs, '-i', ttsPath,
      '-vf', (useDl && useClip ? delogoVF : '') + baseVF + (useSub ? subFilter : ''),
      '-map', '0:v:0', '-map', '1:a:0',
      '-af', 'apad', '-t', String(d),
      ...enc.args, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outPath];
  };
  // 降级顺序：素材+字幕+去水印 → 素材+字幕 → 素材无字幕 → 占位+字幕 → 占位无字幕。
  // 只对字幕 / 去水印滤镜 / 素材流不可解这类可恢复错误降级，其余错误立即抛出，避免掩盖真因。
  const attempts = [build(!!clip, !!subFilter, useDelogo)];
  if (useDelogo && clip) attempts.push(build(true, !!subFilter, false));
  if (subFilter) attempts.push(build(!!clip, false, false));
  if (clip) attempts.push(build(false, !!subFilter, false), build(false, false, false));
  for (let i = 0; i < attempts.length; i++) {
    try { await P.runFF(attempts[i], { timeout: 180000 }); return; }
    catch (e) {
      const recoverable = /subtitles|delogo|fontconfig|font|Stream map|does not contain any stream|Invalid data|Invalid argument|Error opening input|moov atom/i.test(String(e.message));
      if (!recoverable || i === attempts.length - 1) throw e;
      event(job.id, '渲染', `第 ${i + 1} 次渲染因素材/字幕/去水印不兼容降级：${String(e.message).slice(0, 120)}`);
    }
  }
}
async function processJob(jobId) {
  if (processing.has(jobId)) return;
  const job = DB.get('SELECT * FROM remix_jobs WHERE id=?', jobId);
  if (!job || job.status !== 'queued') return;
  processing.add(jobId);
  const variant = U.jsonParse(job.variant_json, {});
  const b = DB.get('SELECT plan_id FROM remix_batches WHERE id=?', job.batch_id);
  const p = getPlan(b?.plan_id) || localStoryboard({ prompt: '', duration: variant.duration || 30 });
  const scenes = (p.scenes || []).map(s => ({ ...s, text: variant.hookKind && s.label === '钩子' ? `[${variant.hookKind}] ${s.text}` : s.text }));
  const dir = path.join(U.OUTPUT_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const ttsPath = path.join(dir, 'voice.m4a'), srtPath = path.join(dir, 'subtitle.srt');
  try {
    setJob(job, { status: 'running', stage: '准备素材', progress: 12 });
    const pool = assets({}).filter(a => a.kind === 'video' && a.hasLocal);
    // 按任务序号轮换素材：同一批次的不同变体用不同源片，才叫「批量混剪」。
    let clipAsset = pool.length ? pool[U.int(job.idx, 0) % pool.length] : null;
    if (clipAsset) event(job.id, '素材', `可用本地素材 ${pool.length} 个，本条使用「${clipAsset.title || clipAsset.file_name}」；分镜分级 ${[...new Set(scenes.map(s => s.grade))].join('/')}`);
    // 无本地素材时回退 CC 素材源（Wikimedia Commons，免 Key），仍无结果才用占位画面
    if (!clipAsset) {
      const kw = U.str(p.product || p.prompt || '', 60).trim();
      const broll = kw ? await fetchCCBroll(kw) : null;
      if (broll) {
        clipAsset = { local_path: broll.path, title: 'CC: ' + broll.title };
        event(job.id, '素材', `无本地素材，改用 CC 素材源（Wikimedia Commons）「${broll.title}」——成片如商用请在发布处保留该署名`);
      } else event(job.id, '素材', '暂无本地视频且 CC 素材源无结果，使用占位画面渲染（可在素材面板上传视频）');
    }

    if (!fs.existsSync(ttsPath)) {
      const src = await P.synthTTS(scenes.map(s => s.text).join('。'), ttsPath, variant.voice);
      event(job.id, '配音', `TTS 来源：${src.startsWith('edge-tts') ? 'Edge TTS 真实配音（' + src.split(':')[1] + '）' : src}`);
    }
    fs.writeFileSync(srtPath, makeSRT(scenes, variant), 'utf8');
    setJob(job, { stage: 'TTS 与 SRT', progress: 30, tts_path: ttsPath, srt_path: srtPath });

    if (!P.ffmpegBin()) {
      setJob(job, { status: 'blocked', stage: '等待 ffmpeg', progress: 35, error: '云服务器未安装 ffmpeg；安装后点「断点续跑」即可继续' });
      syncBatchCounts(job.batch_id); return;
    }
    const ownerRow = DB.get('SELECT user_id FROM remix_batches WHERE id=?', job.batch_id);
    const owner = ownerRow ? DB.get('SELECT * FROM users WHERE id=?', ownerRow.user_id) : null;
    if (owner && A.levelOf(owner) < A.ROLE_LEVEL.owner) {
      const q = A.quotaCheck({ user: owner }, 'renders', 1);
      if (!q.allowed) throw new Error(`今日渲染配额不足（已用 ${q.used}/${q.limit}）`);
      A.quotaUse({ user: owner }, 'renders', 1);
    }

    const ratios = variant.ratios && variant.ratios.length ? variant.ratios : Object.keys(RATIOS);
    const outputs = {};
    let idx = 0;
    for (const ratio of ratios) {
      if (!RATIOS[ratio]) continue;
      const out = path.join(dir, `output_${ratio.replace(':', 'x')}.mp4`);
      if (!fs.existsSync(out) || fs.statSync(out).size < 1024) await renderOne(job, p, variant, ratio, out, srtPath, ttsPath, clipAsset);
      outputs[ratio] = out;
      idx++;
      setJob(job, { stage: `渲染 ${ratio}`, progress: 30 + Math.round(idx / ratios.length * 45) });
    }
    const main = outputs['9:16'] || Object.values(outputs)[0];
    setJob(job, { stage: '成片 QC', progress: 82, output_path: main, ratios_json: U.toJson(Object.keys(outputs)) });
    const qc = await qcOutput(main);
    const pkg = buildPackage(scenes, variant, U.bool(P.C('content.aigcLabel')));
    qc.checks.push({ name: '违禁词', ok: pkg.bannedWords.passed, detail: pkg.bannedWords.hits.length ? pkg.bannedWords.hits.join('、') : '未命中' });
    qc.checks.push({ name: 'AIGC 标识', ok: !pkg.aigcLabel.required || !!pkg.aigcLabel.text, detail: pkg.aigcLabel.text || '未开启' });
    qc.passed = qc.checks.every(c => c.ok);
    qc.score = Math.round(qc.checks.filter(c => c.ok).length / qc.checks.length * 100);
    setJob(job, {
      status: 'done', stage: '完成', progress: 100, qc_json: U.toJson(qc), package_json: U.toJson(pkg), error: null
    });
    event(job.id, '完成', `成片 ${path.basename(main)}，QC ${qc.score} 分`);
  } catch (e) {
    setJob(job, { status: 'failed', stage: '失败', error: U.str(e.message, 500), progress: job.progress });
  } finally {
    syncBatchCounts(job.batch_id);
    processing.delete(jobId);
  }
}
function nextQueued(limit = 2) {
  return DB.all(`SELECT id FROM remix_jobs WHERE status='queued' ORDER BY created_at LIMIT ?`, limit);
}
function jobDetail(id) {
  const j = DB.get('SELECT * FROM remix_jobs WHERE id=?', id);
  if (!j) throw new A.HttpError(404, '任务不存在');
  return {
    id: j.id, batchId: j.batch_id, idx: j.idx, status: j.status, progress: j.progress,
    variant: U.jsonParse(j.variant_json, {}), error: j.error, stage: j.stage,
    tts: j.tts_path ? path.basename(j.tts_path) : null,
    srt: j.srt_path ? path.basename(j.srt_path) : null,
    output: j.output_path ? path.basename(j.output_path) : null,
    ratios: U.jsonParse(j.ratios_json, []), qc: U.jsonParse(j.qc_json, null),
    package: U.jsonParse(j.package_json, null), events: events(id)
  };
}

module.exports = {
  GRADES, HOOK_KINDS, SUBTITLE_STYLES, BGM_MOODS, RATIOS,
  assets, addAsset, gradeAsset, plan, plans, getPlan, matrixOf, createBatch, batch, batches,
  cancelBatch, resumeBatch, retryJob, events, jobDetail, nextQueued, processJob, syncBatchCounts, exportBatch,
  makeSRT, bannedScan, buildPackage, qcOutput
};
