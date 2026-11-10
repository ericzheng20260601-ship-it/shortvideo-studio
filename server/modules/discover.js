'use strict';
const U = require('../lib/util');
const DB = require('../lib/db');
const P = require('../lib/providers');
const A = require('../lib/auth');

const HEAT_WEIGHTS = { views: 0.30, likeRate: 0.20, saveRate: 0.15, commentRate: 0.15, gmvRate: 0.10, fresh: 0.10 };
function heatOf(x, nowMs = Date.now()) {
  const v = Math.max(1, U.int(x.views, 0));
  const norm = z => U.clamp(z, 0, 1);
  const fresh = x.posted_at ? U.clamp(1 - (nowMs - new Date(x.posted_at).getTime()) / (30 * 86400000), 0, 1) : 0.5;
  const score = HEAT_WEIGHTS.views * norm(Math.log10(v + 1) / 7)
    + HEAT_WEIGHTS.likeRate * norm(U.int(x.likes, 0) / v * 8)
    + HEAT_WEIGHTS.saveRate * norm(U.int(x.saves, 0) / v * 30)
    + HEAT_WEIGHTS.commentRate * norm(U.int(x.comments, 0) / v * 60)
    + HEAT_WEIGHTS.gmvRate * norm((Number(x.gmv_estimate) || 0) / v * 40)
    + HEAT_WEIGHTS.fresh * fresh;
  return Math.round(score * 10000) / 100;
}

async function sync({ manual = false, actor = 'system' } = {}) {
  const d = U.day();
  const { source, items } = await P.fetchRadarItems(d);
  const limit = U.int(DB.getConfig('discover.limit'), 40);
  const stamp = U.now();
  let created = 0, updated = 0;
  for (const raw of items.slice(0, limit)) {
    const id = `${source}:${raw.video_id}`;
    const exists = DB.get('SELECT id FROM radar_items WHERE id=?', id);
    const heat = heatOf(raw);
    const row = {
      source, platform: raw.platform || 'tiktok', video_id: raw.video_id,
      title: raw.title, author: raw.author, author_id: raw.author_id,
      url: raw.url, cover: raw.cover, category: raw.category, country: raw.country,
      product: raw.product, duration_sec: U.int(raw.duration_sec, 30),
      views: U.int(raw.views), likes: U.int(raw.likes), comments: U.int(raw.comments),
      saves: U.int(raw.saves), shares: U.int(raw.shares),
      gmv_estimate: Number(raw.gmv_estimate) || 0,
      posted_at: raw.posted_at, first_seen: exists?.id ? undefined : d,
      last_seen: d, heat, raw: U.toJson(raw)
    };
    if (exists) { DB.update('radar_items', id, row); updated++; }
    else { DB.insert('radar_items', { id, ...row }); created++; }
    DB.run(`INSERT INTO radar_snapshots(id,item_id,day,views,likes,comments,saves,shares,gmv_estimate,rank,heat,synced_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id,day) DO UPDATE SET
      views=excluded.views,likes=excluded.likes,comments=excluded.comments,saves=excluded.saves,
      shares=excluded.shares,gmv_estimate=excluded.gmv_estimate,heat=excluded.heat,synced_at=excluded.synced_at`,
      U.uid('snap'), id, d, U.int(raw.views), U.int(raw.likes), U.int(raw.comments), U.int(raw.saves),
      U.int(raw.shares), Number(raw.gmv_estimate) || 0, 0, heat, stamp);
  }
  const ranked = DB.all('SELECT id FROM radar_snapshots WHERE day=? ORDER BY heat DESC', d);
  ranked.forEach((r, i) => DB.run('UPDATE radar_snapshots SET rank=? WHERE item_id=? AND day=?', i + 1, r.id, d));
  DB.setConfig('discover.lastSyncDay', d);
  DB.setConfig('discover.lastSyncAt', stamp);
  A.audit({ user: null, req: null }, 'discover.sync', d, { source, total: items.length, created, updated, manual, actor });
  DB.insert('digests', { day: d, channel: 'sync-log', status: 'done', payload: U.toJson({ source, total: items.length, created, updated, manual }), sent_at: stamp });
  return { day: d, source, total: items.length, created, updated, ranked: ranked.length };
}

function streakOf(itemId, dayStr) {
  const days = DB.all('SELECT day FROM radar_snapshots WHERE item_id=? ORDER BY day DESC LIMIT 30', itemId).map(r => r.day);
  if (!days.length) return 0;
  let n = 0, cursor = new Date(`${dayStr}T00:00:00Z`);
  for (const d of days) {
    const expect = cursor.toISOString().slice(0, 10);
    if (d !== expect) break;
    n++; cursor = new Date(cursor.getTime() - 86400000);
  }
  return n;
}
function prevSnapshot(itemId, dayStr) {
  return DB.get('SELECT * FROM radar_snapshots WHERE item_id=? AND day<? ORDER BY day DESC LIMIT 1', itemId, dayStr);
}

function board({ type = 'hot', category = '', country = '', q = '', dayStr, limit = 30 } = {}) {
  const d = dayStr || DB.getConfig('discover.lastSyncDay') || U.day();
  let rows = DB.all('SELECT * FROM radar_items WHERE last_seen=?', d);
  if (category && category !== 'all') rows = rows.filter(r => r.category === category);
  if (country && country !== 'all') rows = rows.filter(r => r.country === country);
  if (q) {
    const s = U.lower(q);
    rows = rows.filter(r => [r.title, r.author, r.product, r.raw].some(v => U.lower(v).includes(s)));
  }
  const enriched = rows.map(r => {
    const prev = prevSnapshot(r.id, d);
    const growth = prev && prev.views > 0 ? (r.views - prev.views) / prev.views : (prev ? 1 : 0);
    return {
      id: r.id, videoId: r.video_id, title: r.title, author: r.author, url: r.url,
      platform: r.platform, category: r.category, country: r.country, product: r.product,
      duration: r.duration_sec, views: r.views, likes: r.likes, saves: r.saves,
      comments: r.comments, gmv: r.gmv_estimate, heat: r.heat, postedAt: r.posted_at,
      firstSeen: r.first_seen, growth: Math.round(growth * 1000) / 10,
      streak: streakOf(r.id, d), rank: DB.get('SELECT rank FROM radar_snapshots WHERE item_id=? AND day=?', r.id, d)?.rank || 0,
      isNew: r.first_seen === d
    };
  });
  let out = enriched;
  if (type === 'new') out = enriched.filter(x => x.isNew).sort((a, b) => b.heat - a.heat);
  else if (type === 'rising') out = enriched.filter(x => x.growth > 0).sort((a, b) => b.growth - a.growth);
  else if (type === 'streak') out = enriched.filter(x => x.streak >= 2).sort((a, b) => b.streak - a.streak || b.heat - a.heat);
  else out = enriched.sort((a, b) => b.heat - a.heat);
  return { day: d, type, total: out.length, items: out.slice(0, U.clamp(limit, 1, 100)), stats: stats() };
}
function stats() {
  const last = DB.getConfig('discover.lastSyncDay');
  const days = DB.all('SELECT day,count(*) AS n FROM radar_snapshots GROUP BY day ORDER BY day DESC LIMIT 14');
  return {
    source: P.providerStatus().data, lastSyncDay: last || null,
    lastSyncAt: DB.getConfig('discover.lastSyncAt') || null,
    items: DB.get('SELECT count(*) AS n FROM radar_items')?.n || 0,
    todayItems: last ? (DB.get('SELECT count(*) AS n FROM radar_items WHERE last_seen=?', last)?.n || 0) : 0,
    snapshotDays: days.length, history: days,
    categories: P.CJSON('discover.categories', []), countries: P.CJSON('discover.countries', [])
  };
}
function snapshots(itemId, limit = 14) {
  return DB.all('SELECT day,views,likes,comments,saves,shares,gmv_estimate,rank,heat FROM radar_snapshots WHERE item_id=? ORDER BY day DESC LIMIT ?', itemId, U.clamp(limit, 1, 60));
}

function listSubs(userId) {
  return DB.all('SELECT * FROM subscriptions WHERE user_id=? ORDER BY created_at DESC', userId)
    .map(r => ({ ...r, channels: U.jsonParse(r.channels, ['inbox']), enabled: !!r.enabled }));
}
function addSub(userId, body) {
  const type = ['keyword', 'competitor', 'hashtag'].includes(body.type) ? body.type : 'keyword';
  A.need(U.str(body.value).trim(), 400, '订阅内容不能为空');
  const id = DB.insert('subscriptions', {
    user_id: userId, type, value: U.str(body.value, 120), category: U.str(body.category, 40),
    country: U.str(body.country, 20), channels: U.toJson(Array.isArray(body.channels) ? body.channels : ['inbox']),
    enabled: 1, created_at: U.now()
  });
  return { id };
}
function removeSub(userId, id) { DB.run('DELETE FROM subscriptions WHERE id=? AND user_id=?', id, userId); }
function toggleSub(userId, id, enabled) { DB.run('UPDATE subscriptions SET enabled=? WHERE id=? AND user_id=?', enabled ? 1 : 0, id, userId); }

function matchSubs(dayStr) {
  const items = board({ type: 'hot', dayStr, limit: 100 }).items;
  const subs = DB.all('SELECT * FROM subscriptions WHERE enabled=1');
  const hits = [];
  for (const s of subs) {
    const v = U.lower(s.value);
    const matched = items.filter(x => {
      const hay = U.lower(`${x.title} ${x.author} ${x.product} ${x.category}`);
      if (s.type === 'competitor') return U.lower(x.author).includes(v) || U.lower(x.author).includes(v.replace('@', ''));
      return hay.includes(v);
    }).filter(x => (!s.category || s.category === 'all' || x.category === s.category) && (!s.country || s.country === 'all' || x.country === s.country));
    if (matched.length) hits.push({ sub: { ...s, channels: U.jsonParse(s.channels, ['inbox']) }, items: matched.slice(0, 5) });
  }
  return hits;
}
function buildDigest(dayStr) {
  const top = board({ type: 'hot', dayStr, limit: 5 }).items;
  const rising = board({ type: 'rising', dayStr, limit: 5 }).items;
  const fresh = board({ type: 'new', dayStr, limit: 5 }).items;
  const hits = matchSubs(dayStr);
  const line = (label, arr) => `**${label}**\n` + (arr.length ? arr.map((x, i) => `${i + 1}. ${x.title} · ${x.author} · ${U.int(x.views).toLocaleString()} 播放 · 热度 ${x.heat}`).join('\n') : '（暂无）');
  const markdown = `# 短视频爆款日报 ${dayStr}\n\n${line('今日热榜', top)}\n\n${line('飙升最快', rising)}\n\n${line('新上榜', fresh)}\n\n**订阅命中**\n` +
    (hits.length ? hits.map(h => `- ${h.sub.type}:${h.sub.value} → ${h.items.length} 条，首位：${h.items[0].title}`).join('\n') : '（无命中）');
  return { markdown, text: markdown.replace(/[*#]/g, ''), top, rising, fresh, hits };
}
async function sendDigest(dayStr = U.day(), channel) {
  const payload = buildDigest(dayStr);
  const ch = channel || U.str(P.C('push.channel')) || 'inbox';
  const result = await P.sendPush(ch, payload);
  const id = DB.insert('digests', { day: dayStr, channel: ch, status: result.delivered ? 'sent' : 'inbox', payload: U.toJson(payload), sent_at: U.now(), error: result.reason || null });
  A.audit({ user: null, req: null }, 'discover.digest', dayStr, { channel: ch, delivered: result.delivered });
  return { id, channel: ch, delivered: result.delivered, ...payload };
}
function digests(limit = 14) {
  return DB.all('SELECT id,day,channel,status,sent_at,error FROM digests ORDER BY sent_at DESC LIMIT ?', U.clamp(limit, 1, 60));
}
function digestDetail(id) {
  const r = DB.get('SELECT * FROM digests WHERE id=?', id);
  return r ? { ...r, payload: U.jsonParse(r.payload, {}) } : null;
}

function createTopic(ctx, body) {
  const item = body.itemId ? DB.get('SELECT * FROM radar_items WHERE id=?', body.itemId) : null;
  const title = U.str(body.title, 200) || (item ? `复刻：${item.title}` : '新选题');
  const id = DB.insert('topics', {
    user_id: ctx.user.id, project_id: body.projectId || null, title,
    source_item_id: item?.id || null, category: item?.category || U.str(body.category, 40),
    country: item?.country || U.str(body.country, 20), status: 'draft', created_at: U.now()
  });
  A.audit(ctx, 'topic.create', id, title);
  return { id, title, itemId: item?.id || null };
}
function topics(ctx, limit = 50) {
  return DB.all('SELECT * FROM topics WHERE user_id=? OR user_id IS NULL ORDER BY created_at DESC LIMIT ?', ctx.user.id, U.clamp(limit, 1, 100));
}

module.exports = {
  HEAT_WEIGHTS, heatOf, sync, board, stats, snapshots, streakOf,
  listSubs, addSub, removeSub, toggleSub, matchSubs, buildDigest, sendDigest, digests, digestDetail,
  createTopic, topics
};
