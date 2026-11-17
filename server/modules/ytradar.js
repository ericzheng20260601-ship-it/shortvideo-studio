'use strict';
/* 爆款雷达 · YouTube 真实数据源（双通道）
   ① 官方通道：YouTube Data API v3（免费额度每日 10000 单位；Google Cloud 需绑结算账号开 Key）
      search.list（100 单位/次）→ videos.list（1 单位/次）补齐统计与时长。
   ② 免 Key 通道：Invidious 开源公共实例（github.com/iv-org/invidious），无需任何账号。
      /api/v1/search 按赛道关键词搜高播放视频，返回真实播放量/点赞/时长。
   管理后台配了 radar.youtubeKey 自动走官方；不配则走 Invidious。
   两通道结果缓存 6 小时（存 config 表，重启不丢），只保存链接与元数据，不下载转存视频。
   注意：两条通道都要求运行环境能访问 Google 系站点；国内网络不可达时自动回退演示数据。 */
const U = require('../lib/util');
const DB = require('../lib/db');
const A = require('../lib/auth');

const API = 'https://www.googleapis.com/youtube/v3';
const TTL_MS = 6 * 3600 * 1000;
const CACHE_KEY = 'radar.youtubeCache';
const INSTANCES = ['inv.nadeko.net', 'invidious.nerdvpn.de', 'yewtu.be', 'invidious.f5.si', 'iv.duti.dev'];
const FETCH_TIMEOUT_MS = 6000;
const DEADLINE_MS = 20000; // 整次拉取的总时限，避免前端等待过久
const FAIL_COOLDOWN_MS = 10 * 60 * 1000; // 拉取全失败后的冷却期，期间直接快速报错，不再逐实例超时
const FAIL_TS_KEY = 'radar.youtubeFailTs';

/* 赛道 → 搜索关键词（面向海外社媒带货，英语检索） */
const TRACK_QUERIES = {
  'pet-snack': 'dog treats review',
  'pet-toy': 'dog toy review',
  'pet-chew': 'dog chews',
  'pet-train': 'puppy training tips',
  'skincare': 'skincare routine',
  'fragrance': 'perfume review',
  'knowledge': 'pet care tips',
};
const DEFAULT_TRACKS = ['pet-snack', 'pet-toy', 'pet-train', 'knowledge'];

const hasKey = () => !!String(DB.getConfig('radar.youtubeKey', '') || '').trim();
const isConfigured = () => true; // 免 Key 通道常驻可用（出网环境）；状态接口会标注 mode

function parseISODuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return 0;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}
const durStr = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const heatOf = (likes, comments, views) => {
  const engagement = likes + comments * 2 + views * 0.05;
  return engagement > 0 ? Math.max(1, Math.min(99, Math.round(Math.log10(1 + engagement) * 12))) : 0;
};

async function gget(pathname, params) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason || json?.error?.message || `HTTP ${res.status}`;
    throw new Error(String(reason));
  }
  return json;
}

/* ---------- 官方通道 ---------- */
async function fetchKeywordOfficial(qStr, { track, days, max, key }) {
  const after = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const s = await gget('/search', {
    q: qStr, key, type: 'video', part: 'snippet', order: 'viewCount',
    publishedAfter: after, maxResults: Math.min(max, 50), relevanceLanguage: 'en',
  });
  const ids = (s.items || []).map(x => x.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const v = await gget('/videos', { id: ids.join(','), key, part: 'snippet,statistics,contentDetails' });
  return (v.items || []).map(it => {
    const st = it.statistics || {};
    const views = Number(st.viewCount || 0);
    const likes = Number(st.likeCount || 0);
    const comments = Number(st.commentCount || 0);
    const sec = parseISODuration(it.contentDetails?.duration);
    return {
      id: 'yt-' + it.id,
      title: String(it.snippet?.title || '').slice(0, 120),
      author: String(it.snippet?.channelTitle || 'YouTube 创作者').slice(0, 60),
      track,
      dur: sec > 0 ? durStr(sec) : '0:30',
      views,
      saves: 0, // YouTube 官方 API 不提供收藏数，前端按缺失显示 —
      like_count: likes, comment_count: comments,
      heat: heatOf(likes, comments, views),
      url: 'https://www.youtube.com/watch?v=' + it.id,
      cover_url: it.snippet?.thumbnails?.high?.url || it.snippet?.thumbnails?.medium?.url || '',
      tags: (it.snippet?.tags || []).slice(0, 4),
      ai: false, ad: false,
    };
  });
}

/* ---------- 免 Key 通道（Invidious）----------
   逐实例轮询，单实例 6s 超时，全部失败抛错走缓存/回退。 */
async function ivGet(base, params) {
  const url = new URL('https://' + base + '/api/v1/search');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${base} HTTP ${res.status}`);
  const j = await res.json().catch(() => { throw new Error(`${base} 响应非 JSON`); });
  if (!Array.isArray(j)) throw new Error(`${base} 响应格式异常`);
  return j;
}

async function fetchKeywordInvidious(qStr, { track, days, max, deadline }) {
  let lastErr = '无可用实例';
  for (const base of instances()) {
    if (Date.now() > deadline) throw new Error(`拉取超时（最后错误：${lastErr}）`);
    try {
      const arr = await ivGet(base, { q: qStr, type: 'video', sort_by: 'view_count' });
      const cutoff = Date.now() / 1000 - days * 86400;
      return arr
        .filter(v => v.type === 'video' && Number(v.published || 0) >= cutoff)
        .slice(0, max)
        .map(v => {
          const views = Number(v.viewCount || 0);
          const likes = Number(v.likeCount || 0);
          const sec = Number(v.lengthSeconds || 0);
          return {
            id: 'yt-' + v.videoId,
            title: String(v.title || '').slice(0, 120),
            author: String(v.author || 'YouTube 创作者').slice(0, 60),
            track,
            dur: sec > 0 ? durStr(sec) : '0:30',
            views,
            saves: 0, // Invidious 不提供收藏数，前端按缺失显示 —
            like_count: likes, comment_count: 0,
            heat: heatOf(likes, 0, views),
            url: 'https://www.youtube.com/watch?v=' + v.videoId,
            cover_url: (v.videoThumbnails || []).find(t => t.quality === 'high')?.url
              || (v.videoThumbnails || [])[0]?.url || '',
            tags: (v.keywords || []).slice(0, 4),
            ai: false, ad: false,
          };
        });
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  throw new Error(`Invidious 全部实例失败（${lastErr}）`);
}

function instances() {
  const custom = String(DB.getConfig('radar.invidiousBase', '') || '').trim();
  return custom ? [custom, ...INSTANCES.filter(x => x !== custom)] : INSTANCES;
}

function readCache() { return U.jsonParse(DB.getConfig(CACHE_KEY, ''), {}); }
function writeCache(c) {
  try { DB.setConfig(CACHE_KEY, JSON.stringify(c)); } catch { /* 缓存失败不影响主流程 */ }
}

/**
 * 拉取雷达榜单。track 指定单赛道（省配额），缺省聚合 DEFAULT_TRACKS。
 * 缓存 6 小时；强制刷新时仍只拉缺失/过期的关键词。
 * 返回 { items, meta:{ keywords, cached, errors, mode } }
 */
async function fetchRadar({ track, days = 30, max = 24, force = false } = {}) {
  const key = String(DB.getConfig('radar.youtubeKey', '') || '').trim();
  const mode = key ? 'official' : 'invidious';
  const deadline = Date.now() + DEADLINE_MS;
  const tracks = track && TRACK_QUERIES[track] ? [track] : DEFAULT_TRACKS;
  const cache = force ? {} : readCache();
  const now = Date.now();
  /* 冷却期：上次全失败且无可用缓存 → 快速报错（force 可击穿重试） */
  const failTs = Number(DB.getConfig(FAIL_TS_KEY, 0) || 0);
  const hasFreshCache = tracks.some(t => { const c = cache[TRACK_QUERIES[t]]; return c && now - c.ts < TTL_MS && Array.isArray(c.items) && c.items.length; });
  if (!force && !hasFreshCache && failTs && now - failTs < FAIL_COOLDOWN_MS) {
    throw new A.HttpError(502, `YouTube 数据源上次拉取失败（冷却期内，${Math.ceil((FAIL_COOLDOWN_MS - (now - failTs)) / 60000)} 分钟后自动重试，或点刷新强制重试）。运行环境需能访问 YouTube。`);
  }
  const items = [], errors = [], usedCache = [];
  for (const t of tracks) {
    const qStr = TRACK_QUERIES[t];
    const c = cache[qStr];
    if (c && now - c.ts < TTL_MS && Array.isArray(c.items)) {
      items.push(...c.items); usedCache.push(qStr); continue;
    }
    try {
      const got = key
        ? await fetchKeywordOfficial(qStr, { track: t, days, max, key })
        : await fetchKeywordInvidious(qStr, { track: t, days, max, deadline });
      cache[qStr] = { ts: now, items: got };
      items.push(...got);
    } catch (e) {
      errors.push(`${qStr}: ${e.message}`);
      if (c && Array.isArray(c.items)) items.push(...c.items); // 过期缓存也比空好
    }
  }
  writeCache(cache);
  if (!items.length && errors.length) {
    try { DB.setConfig(FAIL_TS_KEY, now); } catch { /* ignore */ }
    const hint = key ? '请检查 radar.youtubeKey 是否有效、配额是否用尽' : '运行环境需能访问 Google/YouTube 站点（国内网络不可达，海外服务器可用）';
    throw new A.HttpError(502, `YouTube 数据拉取失败（${mode} 通道）：${errors[0]}。${hint}`);
  }
  try { DB.setConfig(FAIL_TS_KEY, 0); } catch { /* ignore */ }
  items.sort((a, b) => b.heat - a.heat || b.views - a.views);
  return { items, meta: { keywords: tracks.length, cached: usedCache.length, errors, mode } };
}

module.exports = { fetchRadar, isConfigured, hasKey, TRACK_QUERIES, INSTANCES };
