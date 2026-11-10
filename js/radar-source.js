import { RADAR, TRACKS, trackOf } from './data.js';

// 爆款雷达「数据源适配层」：把「页面渲染」与「数据从哪来」隔开。
// 默认使用仓库内的结构化演示数据，不抓取任何站点。只有管理员配置了合规的数据代理地址，
// 且该地址返回下面的字段契约时，才会切换为真实数据；失败自动回退演示数据，不让页面空白。
//
// 合规边界：TikTok 服务条款禁止未经书面批准的自动化提取，Research API 也不提供播放量 / 收藏 /
// 视频文件。因此这里不内置任何采集器，endpoint 应由你自己的服务端提供（官方批准的数据源、
// 已授权的数据供应商，或内部人工整理后导出的 JSON），并自行处理跨域与鉴权。

export const SOURCE_CONTRACT = [
  ['id / video_id', '视频唯一 ID', '必填，用于收藏、拆解、写文案的跨页联动'],
  ['title / caption', '标题或文案首句', '必填'],
  ['author / unique_id', '达人账号', '展示用'],
  ['track', '赛道 ID', '需为 pet-snack / pet-toy / pet-train / pet-chew / skincare / fragrance / knowledge'],
  ['duration', '时长', '秒数或 0:30 字符串'],
  ['play_count / view_count', '播放量', '官方 Research API 不返回，缺失时显示 —'],
  ['save_count / collect_count', '收藏数', '官方 Research API 不返回，缺失时显示 —'],
  ['like_count / comment_count / share_count', '点赞 / 评论 / 分享', '用于重算热度分'],
  ['heat', '热度分 0–100', '可选；未提供时由互动数据按统一口径换算'],
  ['hook / pain / proof / cta / product', '结构字段', '由服务端解析或人工标注，缺失时标注待补充'],
  ['cover_url / url', '封面与原视频链接', '仅存链接，不下载不转存原视频'],
  ['tags / ai / ad', '标签与内容属性', '可选'],
];

const CFG_KEY = 'sv.radar.endpoint';
const ITEMS_KEY = 'sv.radar.items';
const VALID_TRACKS = new Set(TRACKS.map(t => t.id));

export const getEndpoint = () => (window.SV_RADAR_ENDPOINT || localStorage.getItem(CFG_KEY) || '').trim();
export function setEndpoint(url) {
  const v = String(url || '').trim();
  if (v) localStorage.setItem(CFG_KEY, v); else localStorage.removeItem(CFG_KEY);
  localStorage.removeItem(ITEMS_KEY);
}
export function clearEndpoint() { localStorage.removeItem(CFG_KEY); localStorage.removeItem(ITEMS_KEY); }

export function cachedItems() {
  try {
    const a = JSON.parse(localStorage.getItem(ITEMS_KEY) || 'null');
    return Array.isArray(a) && a.length ? a : null;
  } catch (_) { return null; }
}

const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n) : 0; };
function durOf(raw) {
  const d = raw.dur ?? raw.duration ?? raw.video_duration;
  if (typeof d === 'string' && d.includes(':')) return d;
  const s = Number(d);
  if (!isFinite(s) || s <= 0) return '0:30';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function heatOf(raw, views, saves) {
  const given = Number(raw.heat);
  if (isFinite(given) && given > 0) return Math.max(1, Math.min(99, Math.round(given)));
  const engagement = num(raw.like_count) + num(raw.comment_count) * 2 + num(raw.share_count) * 3 + saves * 2 + views * 0.05;
  if (engagement <= 0) return 0;
  return Math.max(1, Math.min(99, Math.round(Math.log10(1 + engagement) * 12)));
}

/** 把上游 JSON 归一化成雷达页、素材库、拆解页共用的字段形状。 */
export function normalizeTrend(raw = {}, i = 0) {
  const track = VALID_TRACKS.has(raw.track) ? raw.track : 'knowledge';
  const views = num(raw.views ?? raw.play_count ?? raw.view_count ?? raw.playCount);
  const saves = num(raw.saves ?? raw.save_count ?? raw.collect_count ?? raw.collectCount);
  const missing = [];
  if (!views) missing.push('views');
  if (!saves) missing.push('saves');
  for (const k of ['hook', 'pain', 'proof', 'cta', 'product']) if (!raw[k]) missing.push(k);
  return {
    id: String(raw.id || raw.video_id || raw.videoId || `live-${i + 1}`),
    title: String(raw.title || raw.caption || `视频 ${i + 1}`).slice(0, 120),
    author: String(raw.author || raw.unique_id || raw.uniqueId || '达人账号').slice(0, 60),
    track,
    dur: durOf(raw),
    views, saves,
    heat: heatOf(raw, views, saves),
    hook: String(raw.hook || '结构待补充：请由服务端解析钩子').slice(0, 160),
    pain: String(raw.pain || '结构待补充').slice(0, 160),
    proof: String(raw.proof || '结构待补充').slice(0, 160),
    cta: String(raw.cta || '结构待补充').slice(0, 160),
    product: String(raw.product || '未标注').slice(0, 120),
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 5).map(String) : [],
    ai: !!raw.ai, ad: !!raw.ad,
    emoji: trackOf(track).emoji,
    sourceUrl: String(raw.url || raw.share_url || raw.shareUrl || ''),
    coverUrl: String(raw.cover_url || raw.cover || ''),
    _live: true,
    _missing: missing,
  };
}

/**
 * 读取榜单：无 endpoint → 演示数据；有 endpoint → 拉取并归一化，失败回退缓存/演示数据。
 * 返回 { mode, items, note, error }，mode ∈ demo | live | live-cache | fallback。
 */
export async function loadRadar({ force = false } = {}) {
  const endpoint = getEndpoint();
  const cached = cachedItems();
  if (!endpoint) return { mode: 'demo', items: RADAR, note: '演示数据 · 结构化样例，未接入外部数据源', error: null };
  if (cached && !force) return { mode: 'live-cache', items: cached, note: '已配置数据源 · 使用上次成功拉取的缓存', error: null };
  try {
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' }, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (Array.isArray(json.items) ? json.items : null);
    if (!arr || !arr.length) throw new Error('响应中没有视频条目数组');
    const items = arr.slice(0, 60).map(normalizeTrend);
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
    return { mode: 'live', items, note: `已接入数据源 · 本次拉取 ${items.length} 条`, error: null };
  } catch (e) {
    return {
      mode: 'fallback',
      items: cached || RADAR,
      note: cached ? '数据源暂时不可用 · 回退到上次缓存' : '数据源暂时不可用 · 回退到演示数据',
      error: e?.message || '请求失败',
    };
  }
}

/** 归一化后的条目写回共享数组，让素材库 / 拆解 / 文案工坊的同名引用自动指向新数据。 */
export function applyRadarItems(items) {
  if (!Array.isArray(items) || !items.length || items === RADAR) return;
  RADAR.splice(0, RADAR.length, ...items);
}

export const SOURCE_LABEL = {
  demo: ['演示数据 · 结构化样例', 'amber'],
  live: ['已接入授权数据源', ''],
  'live-cache': ['授权数据源 · 缓存', 'blue'],
  fallback: ['数据源不可用 · 已回退', 'rose'],
};
