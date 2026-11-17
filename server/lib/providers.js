'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const U = require('./util');
const DB = require('./db');

const C = k => DB.getConfig(k);
const CJSON = (k, fallback) => { const v = C(k); return typeof v === 'string' ? U.jsonParse(v, fallback) : (v ?? fallback); };

/* ---------- 外部能力：全部可插拔，未配置时走本地降级 ---------- */

function providerStatus() {
  let ttsState = 'placeholder';
  try { require('node-edge-tts'); ttsState = 'edge-tts'; } catch { /* 包未安装 */ }
  return {
    data: C('data.apiUrl') ? 'external' : 'demo',
    llm: C('llm.baseUrl') && C('llm.apiKey') ? 'external' : 'local',
    asr: C('asr.apiUrl') ? 'external' : 'local',
    tts: C('tts.apiUrl') ? 'external' : ttsState,
    push: C('push.webhookUrl') ? 'webhook' : 'inbox',
    render: ffmpegBin() ? 'ffmpeg' : 'missing'
  };
}

async function chatLLM(messages, { expectJSON = false, timeout = 45000 } = {}) {
  const base = U.str(C('llm.baseUrl')).replace(/\/$/, '');
  const key = U.str(C('llm.apiKey'));
  if (!base || !key) return null;
  const body = { model: U.str(C('llm.model'), 60) || 'gpt-4o-mini', messages, temperature: 0.4 };
  if (expectJSON) body.response_format = { type: 'json_object' };
  const r = await U.fetchJSON(`${base}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, timeout
  });
  const text = r?.choices?.[0]?.message?.content || '';
  return expectJSON ? U.jsonParse(text.replace(/^```json\s*|\s*```$/g, ''), null) : text;
}

/* 本地规则引擎：无 LLM 密钥时保证所有功能仍可真实运行（结果标注 source=local） */
const HOOKS = [
  '别再买第 8 根咬胶了，先看看它为什么咬沙发。',
  '你家狗不是不听话，是你没给它「工作」。',
  '早 C 晚 A 根本不用买一整套。',
  '这支香水的留香，比我前任的道歉还久。',
  '三个月烂脸，我只改了这一步。',
  '别再囤护肤品了，先看懂成分表这一行。'
];
const PAINS = ['独处焦虑乱咬家具', '步骤太多坚持不下来', '留香短、撞香', '敏感泛红反复', '收纳越收越乱'];
const PROOFS = ['连续 7 天记录对比', '28 天半脸对照', '现场实测 8 小时留香', '第三方成分检测报告', '100 位用户回访'];
const CTAS = ['评论区发你家狗的拆家照，我给方案', '收藏这张三步清单', '点购物车看同款', '关注看下集实测'];
const PRODUCTS = ['耐咬磨牙玩具', '早 C 晚 A 精华组合', '木质调香水', '屏障修护面霜', '宠物训练响片', '便携收纳盒'];
const AUTHORS = ['@petlab.demo', '@skinlab.demo', '@scent.daily', '@home.hack', '@vet.tips', '@glow.notes'];
const COUNTRIES = CJSON('discover.countries', ['US', 'UK', 'ID', 'TH', 'VN']);
const CATEGORIES = CJSON('discover.categories', ['pet', 'beauty', 'fragrance', 'skincare', 'home']);

function demoItems(dayStr, { limit = 40 } = {}) {
  const rnd = U.deterministic(`sv-radar-${dayStr}`);
  const base = [
    { video_id: 'LIVE-001', caption: '狗狗拆家的 40 分钟解法（授权数据源样例）', unique_id: '@petlab.demo', track: 'pet', duration: 42, product: '耐咬磨牙玩具', hook: HOOKS[0], pain: PAINS[0], proof: PROOFS[0], cta: CTAS[0], url: 'https://example.com/videos/LIVE-001' },
    { video_id: 'LIVE-002', caption: '早 C 晚 A 极简三步（授权数据源样例）', unique_id: '@skinlab.demo', track: 'skincare', duration: 35, product: '早 C 晚 A 精华组合', hook: HOOKS[2], pain: PAINS[1], proof: PROOFS[1], cta: CTAS[1], url: 'https://example.com/videos/LIVE-002' }
  ];
  const n = U.clamp(limit, 6, 60);
  const items = [];
  for (let i = 0; i < n; i++) {
    const t = i < base.length ? base[i] : null;
    const isNew = i >= 2 && rnd() > 0.72;
    const seedNum = 1 + Math.floor(rnd() * 900000);
    const cat = t ? t.track : CATEGORIES[i % CATEGORIES.length];
    const views = Math.round((t ? 1280000 : 60000 + rnd() * 2400000) * (0.82 + rnd() * 0.4));
    const likes = Math.round(views * (0.04 + rnd() * 0.09));
    const item = {
      video_id: t ? t.video_id : `DEMO-${dayStr.replace(/-/g, '')}-${String(i + 1).padStart(2, '0')}`,
      title: t ? t.caption : `${PRODUCTS[i % PRODUCTS.length]}｜${['开箱实测', '3 秒钩子', '避坑清单', '前后对比', '达人同款'][i % 5]}`,
      author: t ? t.unique_id : AUTHORS[i % AUTHORS.length],
      author_id: (t ? t.unique_id : AUTHORS[i % AUTHORS.length]).replace('@', ''),
      url: t ? t.url : `https://example.com/videos/demo-${i + 1}`,
      cover: '',
      platform: i % 7 === 0 ? 'instagram' : (i % 11 === 0 ? 'youtube' : 'tiktok'),
      category: cat,
      country: COUNTRIES[i % COUNTRIES.length],
      product: t ? t.product : PRODUCTS[i % PRODUCTS.length],
      duration_sec: t ? t.duration : 18 + Math.floor(rnd() * 45),
      views, likes,
      comments: Math.round(likes * (0.01 + rnd() * 0.04)),
      saves: Math.round(likes * (0.08 + rnd() * 0.2)),
      shares: Math.round(likes * (0.02 + rnd() * 0.08)),
      gmv_estimate: Math.round(views * (0.002 + rnd() * 0.02) * 100) / 100,
      hook: t ? t.hook : HOOKS[i % HOOKS.length],
      pain: t ? t.pain : PAINS[i % PAINS.length],
      proof: t ? t.proof : PROOFS[i % PROOFS.length],
      cta: t ? t.cta : CTAS[i % CTAS.length],
      posted_at: new Date(Date.now() - Math.floor(rnd() * 12) * 86400000).toISOString(),
      is_new: isNew
    };
    items.push(item);
  }
  return items;
}

function normalizeExternalItem(x) {
  const num = v => U.int(v?.value ?? v ?? 0, 0);
  return {
    video_id: U.str(x.video_id || x.id || x.aweme_id || U.uid('v'), 120),
    title: U.str(x.title || x.caption || x.desc || '未命名视频', 300),
    author: U.str(x.author || x.unique_id || x.username || '', 120),
    author_id: U.str(x.author_id || x.sec_uid || '', 120),
    url: U.str(x.url || x.share_url || x.link || '', 500),
    cover: U.str(x.cover || x.thumbnail || '', 500),
    platform: U.str(x.platform || 'tiktok', 40),
    category: U.str(x.category || x.track || 'pet', 40),
    country: U.str(x.country || x.region || 'US', 20),
    product: U.str(x.product || x.product_name || '', 200),
    duration_sec: U.int(x.duration_sec || x.duration, 30),
    views: num(x.views ?? x.play_count ?? x.view_count),
    likes: num(x.likes ?? x.like_count ?? x.digg_count),
    comments: num(x.comments ?? x.comment_count),
    saves: num(x.saves ?? x.collect_count),
    shares: num(x.shares ?? x.share_count),
    gmv_estimate: Number(x.gmv_estimate ?? x.gmv ?? 0) || 0,
    hook: U.str(x.hook || '', 500), pain: U.str(x.pain || '', 500),
    proof: U.str(x.proof || '', 500), cta: U.str(x.cta || '', 500),
    transcript: U.str(x.transcript || x.voiceover || '', 20000),
    comments_sample: Array.isArray(x.comments_sample) ? x.comments_sample.slice(0, 60).map(c => U.str(typeof c === 'string' ? c : (c.text || c.content), 500)) : [],
    posted_at: x.posted_at || x.create_time || null
  };
}

async function fetchRadarItems(dayStr) {
  const url = U.str(C('data.apiUrl'));
  const key = U.str(C('data.apiKey'));
  const limit = U.int(C('discover.limit'), 40);
  if (url && key) {
    const r = await U.fetchJSON(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key },
      body: { day: dayStr, limit, categories: CJSON('discover.categories', []), countries: CJSON('discover.countries', []) },
      timeout: 30000
    });
    const raw = Array.isArray(r) ? r : (r.items || r.data || []);
    if (!Array.isArray(raw)) throw new Error('数据源返回格式不符合契约：需要 {items:[...]}');
    return { source: 'external', items: raw.map(normalizeExternalItem) };
  }
  return { source: 'demo', items: demoItems(dayStr, { limit }) };
}

/* ASR：外部 HTTP 服务或本地降级（允许手工导入逐字稿） */
async function transcribe({ audioUrl, transcriptText, srtText, language = 'zh' }) {
  const url = U.str(C('asr.apiUrl'));
  if (url && audioUrl) {
    const r = await U.fetchJSON(url, { method: 'POST', headers: { Authorization: `Bearer ${U.str(C('asr.apiKey'))}` }, body: { audio_url: audioUrl, language }, timeout: 60000 });
    const segs = r.segments || r.result?.segments || [];
    if (segs.length) return { source: 'external', segments: segs.map(s => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: U.str(s.text, 500) })) };
  }
  if (srtText) return { source: 'srt', segments: parseSRT(srtText) };
  const lines = U.str(transcriptText, 20000).split(/[\n。！？!?；;]+/).map(s => s.trim()).filter(Boolean);
  const segments = lines.map((text, i) => ({ start: i * 3, end: i * 3 + 2.8, text }));
  return { source: segments.length ? 'manual' : 'placeholder', segments };
}
function parseSRT(srt) {
  const out = [];
  for (const block of String(srt).split(/\n\s*\n/)) {
    const m = block.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!m) continue;
    const t = (h, mi, s, ms) => (+h) * 3600 + (+mi) * 60 + (+s) + (+ms) / 1000;
    const text = block.split('\n').slice(2).join(' ').trim();
    if (text) out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text });
  }
  return out;
}

/* TTS 三级降级：外部 HTTP API → 微软 Edge TTS（免 Key，借鉴 ClipForge 0-Key 路径）→ ffmpeg 静音占位 */
const EDGE_VOICES = {
  'zh-CN': 'zh-CN-XiaoxiaoNeural', 'zh-HK': 'zh-HK-HiuMaanNeural',
  'en-US': 'en-US-AriaNeural', 'de-DE': 'de-DE-KatjaNeural', 'pt-BR': 'pt-BR-FranciscaNeural',
  'ja-JP': 'ja-JP-NanamiNeural', 'ko-KR': 'ko-KR-SunHiNeural',
  'es-ES': 'es-ES-ElviraNeural', 'fr-FR': 'fr-FR-DeniseNeural'
};
let edgeTTSMod = null;
async function synthTTS(text, outPath, voice) {
  const url = U.str(C('tts.apiUrl'));
  if (url) {
    const r = await U.fetchJSON(url, { method: 'POST', headers: { Authorization: `Bearer ${U.str(C('tts.apiKey'))}` }, body: { text, voice: voice || U.str(C('tts.voice')), format: 'mp3' }, timeout: 60000 });
    if (r.audio_base64) { fs.writeFileSync(outPath, Buffer.from(r.audio_base64, 'base64')); return 'external'; }
    if (r.audio_url) {
      const resp = await fetch(r.audio_url); const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(outPath, buf); return 'external';
    }
  }
  // Edge TTS：voice 传语言码（en-US）或完整 Neural 名均支持；网络不可用/服务变更时静默降级
  const v = /Neural$/i.test(String(voice || '')) ? String(voice) : (EDGE_VOICES[String(voice || '').trim()] || EDGE_VOICES['zh-CN']);
  try {
    if (!edgeTTSMod) edgeTTSMod = require('node-edge-tts');
    const tts = new edgeTTSMod.EdgeTTS({ voice: v });
    await tts.ttsPromise(String(text).slice(0, 4000), outPath);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 512) return `edge-tts:${v}`;
  } catch (e) { /* 降级到占位 */ }
  const ff = ffmpegBin();
  if (!ff) return 'none';
  const dur = U.clamp(String(text).length / 5, 2, 60).toFixed(1);
  await runFF(['-y', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', String(dur), '-c:a', 'aac', '-b:a', '64k', outPath]);
  return 'placeholder';
}

/* 推送：webhook（企微/飞书/Slack 兼容）；未配置时落到站内收件箱 */
async function sendPush(channel, payload) {
  const url = U.str(C('push.webhookUrl'));
  if (!url) return { delivered: false, reason: 'inbox' };
  const body = channel === 'wecom'
    ? { msgtype: 'markdown', markdown: { content: payload.markdown || payload.text || '' } }
    : channel === 'feishu'
      ? { msg_type: 'text', content: { text: payload.text || payload.markdown || '' } }
      : { text: payload.text || payload.markdown || '' };
  try { await U.fetchJSON(url, { method: 'POST', body, timeout: 15000 }); return { delivered: true }; }
  catch (e) { return { delivered: false, reason: e.message }; }
}

/* ffmpeg */
let ffCache;
let ffSource = '';
function staticFF() {
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch { /* 未安装 */ }
  return '';
}
function ffmpegBin() {
  if (ffCache !== undefined) return ffCache;
  // ① 显式配置优先：自有服务器可能指定带 GPU / 特定编码器的构建
  const explicit = [U.str(C('remix.ffmpegPath')), process.env.FFMPEG_PATH, process.env.SV_FFMPEG_PATH];
  for (const c of explicit) {
    if (!c) continue;
    if (c.includes(path.sep)) { if (fs.existsSync(c)) { ffCache = c; ffSource = 'configured'; return ffCache; } continue; }
    try { execFileSyncQuick(c, ['-version']); ffCache = c; ffSource = 'configured'; return ffCache; } catch { /* next */ }
  }
  // ② 随 npm 依赖安装的完整构建（自带 libx264）。系统 ffmpeg 常被裁剪，只留解码器，
  //    放在系统 PATH 之后会命中「有二进制但无编码器」的坑，导致 Unknown encoder 'libx264'。
  const st = staticFF();
  if (st) { ffCache = st; ffSource = 'ffmpeg-static'; return ffCache; }
  // ③ 最后才退回系统 PATH
  try { execFileSyncQuick('ffmpeg', ['-version']); ffCache = 'ffmpeg'; ffSource = 'system'; return ffCache; } catch { /* next */ }
  ffCache = null; ffSource = ''; return null;
}
function execFileSyncQuick(bin, args) {
  const { execFileSync } = require('node:child_process');
  return execFileSync(bin, args, { stdio: 'ignore', timeout: 5000 });
}

let encCache;
function ffmpegEncoders() {
  if (encCache) return encCache;
  const bin = ffmpegBin();
  if (!bin) { encCache = new Set(); return encCache; }
  try {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync(bin, ['-hide_banner', '-encoders'],
      { encoding: 'utf8', timeout: 8000, maxBuffer: 4 * 1024 * 1024 });
    encCache = new Set(out.split('\n')
      .map(l => (l.match(/^\s*[A-Z.]{6}\s+(\S+)/) || [])[1])
      .filter(Boolean));
  } catch { encCache = new Set(); }
  return encCache;
}
/* 视频编码器按可用性自适应，避免把 libx264 写死。
   SV_FORCE_VIDEO_ENCODER=libx264|libopenh264|mpeg4 可强制指定，便于运维与回归测试。 */
const ENCODER_CHAIN = [
  { name: 'libx264', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26'] },
  { name: 'libopenh264', args: ['-c:v', 'libopenh264', '-b:v', '2500k'] },
  { name: 'mpeg4', args: ['-c:v', 'mpeg4', '-q:v', '4'] }
];
function videoEncoder() {
  const forced = U.str(process.env.SV_FORCE_VIDEO_ENCODER);
  if (forced) {
    const f = ENCODER_CHAIN.find(x => x.name === forced);
    if (f) return f;
  }
  const enc = ffmpegEncoders();
  return ENCODER_CHAIN.find(x => enc.has(x.name)) || ENCODER_CHAIN[0];
}
function ffmpegInfo() {
  const e = videoEncoder();
  return { source: ffmpegBin() ? ffSource : null, encoder: e.name,
    hasX264: ffmpegEncoders().has('libx264'), encoders: ENCODER_CHAIN.filter(x => ffmpegEncoders().has(x.name)).map(x => x.name) };
}
const ffChildren = new Set();
function runFF(args, { timeout = 300000, maxBuffer = 12 * 1024 * 1024 } = {}) {
  const bin = ffmpegBin();
  if (!bin) return Promise.reject(new Error('未找到 ffmpeg：请在云服务器安装 ffmpeg，或配置 remix.ffmpegPath'));
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      ffChildren.delete(child);
      if (err) reject(new Error(`ffmpeg 失败: ${String(stderr || err.message).slice(-600)}`));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    ffChildren.add(child);
    child.on('exit', () => ffChildren.delete(child));
  });
}
// 进程退出时收掉在途 ffmpeg，避免容器重启后遗留孤儿进程继续占用 CPU / 写半成品文件
function stopFF() { for (const c of ffChildren) { try { c.kill('SIGKILL'); } catch { /* ignore */ } } ffChildren.clear(); }

module.exports = {
  C, CJSON, providerStatus, chatLLM, fetchRadarItems, demoItems, normalizeExternalItem,
  transcribe, parseSRT, synthTTS, sendPush, ffmpegBin, runFF, stopFF,
  videoEncoder, ffmpegInfo, ffmpegEncoders,
  HOOKS, PAINS, PROOFS, CTAS, PRODUCTS, CATEGORIES, COUNTRIES
};
