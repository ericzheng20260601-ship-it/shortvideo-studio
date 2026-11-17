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
const USER_KEY = 'sv.radar.userItems';
const VALID_TRACKS = new Set(TRACKS.map(t => t.id));

/* ---------- 手动添加视频链接 ----------
   合规路径：用户人工粘贴公开视频页链接（TikTok / YouTube），只存链接与 oEmbed 官方元数据，
   不抓取榜单、不转存视频文件。播放走页内官方内嵌播放器。 */
export const videoIdOf = url => {
  const s = String(url || '');
  const tt = s.match(/tiktok\.com\/(?:@[\w.\-]+)\/video\/(\d{6,})/);
  if (tt) return 'tt-' + tt[1];
  const yt = s.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return 'yt-' + yt[1];
  return '';
};

export function userItems() {
  try {
    const a = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    return Array.isArray(a) ? a : [];
  } catch (_) { return []; }
}
const saveUserItems = a => localStorage.setItem(USER_KEY, JSON.stringify(a.slice(0, 100)));
export const removeUserVideo = id => saveUserItems(userItems().filter(x => x.id !== id));

export function addUserVideo(url, { title, author, track, cover } = {}) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: '链接格式不正确，需 http(s):// 开头' };
  const vid = videoIdOf(u);
  if (!vid) return { ok: false, error: '暂只支持 TikTok / YouTube 标准视频页链接（TikTok 需形如 @用户/video/数字，不支持 vm.tiktok.com 短链）' };
  const items = userItems();
  if (items.some(x => x.id === 'user-' + vid)) return { ok: false, error: '该视频已在雷达列表中' };
  const tr = VALID_TRACKS.has(track) ? track : 'knowledge';
  const item = {
    id: 'user-' + vid,
    title: String(title || '来自链接的视频').slice(0, 120),
    author: String(author || '手动添加').slice(0, 60),
    track: tr,
    dur: '0:30', views: 0, saves: 0, heat: 60,
    hook: '结构待补充：点「拆解」由本地规则引擎生成',
    pain: '结构待补充', proof: '结构待补充', cta: '结构待补充',
    product: '未标注', tags: ['手动添加'], ai: false, ad: false,
    emoji: trackOf(tr).emoji,
    sourceUrl: u, coverUrl: String(cover || ''),
    _live: true, _user: true, _missing: ['views', 'saves', 'hook', 'pain', 'proof', 'cta'],
  };
  items.unshift(item);
  saveUserItems(items);
  return { ok: true, item };
}

/** 尝试用平台官方 oEmbed 补充标题/作者/封面（免费、合规）；失败不影响添加。 */
export async function fetchOEmbed(url) {
  const u = String(url || '');
  const api = /youtube\.com|youtu\.be/i.test(u)
    ? 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u)
    : 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(u);
  try {
    const r = await fetch(api, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const d = await r.json();
    return { title: d.title, author: d.author_name, cover: d.thumbnail_url };
  } catch (_) { return null; }
}

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
 * 读取榜单，优先级：自定义 endpoint → YouTube 官方 API（服务端已配 Key 时）→ 演示数据。
 * 返回 { mode, items, note, error }，mode ∈ demo | live | yt-live | yt-cache | live-cache | fallback。
 */
export async function loadRadar({ force = false } = {}) {
  const endpoint = getEndpoint();
  const users = userItems();
  const merge = (items, note) => ({
    items: users.length ? [...users, ...items] : items,
    note: users.length ? `${note} · 含手动添加 ${users.length} 条` : note,
  });
  if (!endpoint) {
    try {
      const yt = await fetchYtLive(force);
      if (yt) {
        const norm = yt.items.slice(0, 60).map(normalizeTrend);
        const { items, note } = merge(norm, yt.note);
        return { mode: yt.mode, items, note, error: null };
      }
    } catch (e) {
      const cached = ytCached();
      if (cached) {
        const norm = cached.items.slice(0, 60).map(normalizeTrend);
        const { items, note } = merge(norm, 'YouTube 数据源异常 · 回退到本地缓存');
        return { mode: 'yt-cache', items, note, error: e?.message || '请求失败' };
      }
      // 无缓存：继续走演示数据，把错误带上
      const { items, note } = merge(RADAR, `YouTube 数据源暂时不可用 · 显示演示数据（${e?.message || '请求失败'}）`);
      return { mode: 'fallback', items, note, error: e?.message || '请求失败' };
    }
    const { items, note } = merge(RADAR, '演示数据 · 结构化样例（运行环境可访问 YouTube 时自动拉取真实数据）');
    return { mode: 'demo', items, note, error: null };
  }
  if (cachedItems() && !force) {
    const { items, note } = merge(cachedItems(), '已配置数据源 · 使用上次成功拉取的缓存');
    return { mode: 'live-cache', items, note, error: null };
  }
  try {
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' }, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (Array.isArray(json.items) ? json.items : null);
    if (!arr || !arr.length) throw new Error('响应中没有视频条目数组');
    const norm = arr.slice(0, 60).map(normalizeTrend);
    localStorage.setItem(ITEMS_KEY, JSON.stringify(norm));
    const { items, note } = merge(norm, `已接入数据源 · 本次拉取 ${norm.length} 条`);
    return { mode: 'live', items, note, error: null };
  } catch (e) {
    const cached = cachedItems();
    const { items, note } = merge(cached || RADAR, cached ? '数据源暂时不可用 · 回退到上次缓存' : '数据源暂时不可用 · 回退到演示数据');
    return { mode: 'fallback', items, note, error: e?.message || '请求失败' };
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
  'yt-live': ['YouTube · 真实数据', ''],
  'yt-cache': ['YouTube · 缓存', 'blue'],
  'live-cache': ['授权数据源 · 缓存', 'blue'],
  fallback: ['数据源不可用 · 已回退', 'rose'],
};

/* ---------- YouTube 真实数据源（服务端代理 /api/radar/youtube）----------
   服务端双通道：配了 radar.youtubeKey 走官方 API；没配则走开源 Invidious 公共实例（免 Key）。
   Key 存服务端配置，前端不接触。服务端缓存 6h，前端本地缓存 30 分钟；
   失败（含出网不可达）一律回退演示数据并在徽标/提示中标注原因。 */
const YT_CACHE_KEY = 'sv.radar.ytItems';
const YT_TS_KEY = 'sv.radar.ytTs';
const YT_LOCAL_TTL = 30 * 60 * 1000;

function ytCached() {
  try {
    const arr = JSON.parse(localStorage.getItem(YT_CACHE_KEY) || 'null');
    const ts = Number(localStorage.getItem(YT_TS_KEY) || 0);
    return Array.isArray(arr) && arr.length && Date.now() - ts < YT_LOCAL_TTL ? { items: arr, age: Date.now() - ts } : null;
  } catch (_) { return null; }
}
function saveYtCache(items) {
  localStorage.setItem(YT_CACHE_KEY, JSON.stringify(items));
  localStorage.setItem(YT_TS_KEY, String(Date.now()));
}
export function clearYtCache() { localStorage.removeItem(YT_CACHE_KEY); localStorage.removeItem(YT_TS_KEY); }

async function fetchYtLive(force) {
  let st;
  try {
    st = await fetch('/api/radar/youtube/status', { signal: AbortSignal.timeout(5000) });
  } catch (_) { return null; } // 服务端不在或离线
  if (!st.ok) return null;
  const j = await st.json().catch(() => null);
  if (!j?.configured) return null; // 管理员未配 Key，静默走演示数据
  const cached = ytCached();
  if (cached && !force) return { items: cached.items, note: 'YouTube 官方 API · 6h 内缓存', mode: 'yt-cache' };
  const res = await fetch(`/api/radar/youtube?max=36${force ? '&force=1' : ''}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const jj = await res.json();
  const arr = Array.isArray(jj.items) ? jj.items : [];
  if (!arr.length) throw new Error('YouTube 返回 0 条');
  saveYtCache(arr);
  const modeTxt = jj.meta?.mode === 'official' ? '官方 API' : 'Invidious（免 Key）';
  return { items: arr, note: `YouTube 真实数据 · ${modeTxt} · ${arr.length} 条${jj.meta?.cached ? `（${jj.meta.cached}/${jj.meta.keywords} 赛道走缓存）` : ''}`, mode: 'yt-live' };
}
