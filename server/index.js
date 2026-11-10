'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const U = require('./lib/util');
const DB = require('./lib/db');
const A = require('./lib/auth');
const P = require('./lib/providers');
const D = require('./modules/discover');
const B = require('./modules/breakdown');
const R = require('./modules/remix');
const C = require('./modules/collab');
const CRON = require('./cron');

const routes = [];
function route(method, pattern, fn, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, fn, ...opts });
}
const q = (url) => Object.fromEntries(url.searchParams);

function readRaw(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new A.HttpError(413, '文件超过 60MB 限制')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------------- 认证 ---------------- */
route('GET', '/api/health', () => ({ status: 'ok', version: '2.0.0', time: U.now() }), { public: true });
route('GET', '/api/status', () => ({ providers: P.providerStatus(), cron: CRON.status(), version: '2.0.0' }), { public: true });
route('POST', '/api/auth/login', async (ctx) => {
  const { token, user } = A.login(ctx.body.email, ctx.body.password, ctx.req);
  ctx.res.setHeader('Set-Cookie', `sv_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  return { token, user };
}, { public: true });
route('POST', '/api/auth/logout', (ctx) => { A.logout(ctx.req); ctx.res.setHeader('Set-Cookie', 'sv_token=; Path=/; HttpOnly; Max-Age=0'); return {}; });
route('GET', '/api/auth/me', (ctx) => A.me(ctx));
route('POST', '/api/auth/password', (ctx) => {
  A.need(String(ctx.body.newPassword || '').length >= 8, 400, '新密码至少 8 位且含字母数字');
  const u = DB.get('SELECT * FROM users WHERE id=?', ctx.user.id);
  A.need(U.verifyPassword(ctx.body.oldPassword, u), 403, '原密码不正确');
  A.need(/[A-Za-z]/.test(ctx.body.newPassword) && /\d/.test(ctx.body.newPassword), 400, '新密码需同时包含字母与数字');
  DB.update('users', u.id, { ...U.hashPassword(ctx.body.newPassword), must_change: 0 });
  A.audit(ctx, 'auth.password', u.id, '');
  return {};
});

/* ---------------- 配置 ---------------- */
const SECRET_KEYS = ['data.apiKey', 'llm.apiKey', 'asr.apiKey', 'tts.apiKey', 'push.webhookUrl'];
function safeConfig() {
  const all = DB.allConfig();
  for (const k of SECRET_KEYS) if (all[k]) all[k] = '••••••••';
  return all;
}
route('GET', '/api/config', (ctx) => { A.requireLevel(ctx, 'admin'); return { config: safeConfig(), providers: P.providerStatus() }; });
route('POST', '/api/config', (ctx) => {
  A.requireLevel(ctx, 'admin');
  const allow = [...Object.keys(DB.allConfig()), 'discover.syncHour', 'discover.digestHour', 'discover.timezone', 'discover.source', 'discover.categories', 'discover.countries', 'discover.limit',
    'data.apiUrl', 'data.apiKey', 'llm.baseUrl', 'llm.apiKey', 'llm.model', 'asr.apiUrl', 'asr.apiKey', 'tts.apiUrl', 'tts.apiKey', 'tts.voice',
    'push.webhookUrl', 'push.channel', 'quota.jobsPerDay', 'quota.rendersPerDay', 'remix.maxConcurrent', 'remix.ffmpegPath', 'remix.fontPath',
    'content.aigcLabel', 'content.bannedWords'];
  const patch = ctx.body.config || {};
  for (const [k, v] of Object.entries(patch)) {
    if (!allow.includes(k)) continue;
    if (SECRET_KEYS.includes(k) && v === '••••••••') continue;
    DB.setConfig(k, v);
  }
  A.audit(ctx, 'config.update', '', Object.keys(patch).join(','));
  return { config: safeConfig(), providers: P.providerStatus() };
});

/* ---------------- 每日发现 ---------------- */
route('GET', '/api/discover/board', (ctx) => D.board({
  type: ctx.query.type, category: ctx.query.category, country: ctx.query.country,
  q: ctx.query.q, dayStr: ctx.query.day, limit: U.int(ctx.query.limit, 30)
}));
route('GET', '/api/discover/stats', () => D.stats());
route('GET', '/api/discover/snapshots', (ctx) => ({ items: D.snapshots(ctx.query.itemId, U.int(ctx.query.limit, 14)) }));
route('GET', '/api/discover/subs', (ctx) => ({ items: D.listSubs(ctx.user.id) }));
route('POST', '/api/discover/subs', (ctx) => D.addSub(ctx.user.id, ctx.body));
route('DELETE', '/api/discover/subs/:id', (ctx) => { D.removeSub(ctx.user.id, ctx.params.id); return {}; });
route('POST', '/api/discover/subs/:id/toggle', (ctx) => { D.toggleSub(ctx.user.id, ctx.params.id, U.bool(ctx.body.enabled)); return {}; });
route('POST', '/api/discover/sync', async (ctx) => { A.requireLevel(ctx, 'editor'); return D.sync({ manual: true, actor: ctx.user.email }); });
route('GET', '/api/discover/digests', () => ({ items: D.digests(U.int(20)) }));
route('GET', '/api/discover/digests/:id', (ctx) => D.digestDetail(ctx.params.id));
route('POST', '/api/discover/digest', async (ctx) => { A.requireLevel(ctx, 'editor'); return D.sendDigest(ctx.body.day || U.day(), ctx.body.channel); });
route('GET', '/api/discover/topics', (ctx) => ({ items: D.topics(ctx) }));
route('POST', '/api/discover/topics', (ctx) => { A.requireLevel(ctx, 'editor'); return D.createTopic(ctx, ctx.body); });

/* ---------------- 拆解 ---------------- */
route('POST', '/api/breakdown/analyze', async (ctx) => { A.requireLevel(ctx, 'editor'); return B.analyze(ctx, ctx.body); });
route('GET', '/api/breakdown/reports', (ctx) => ({ items: B.reports({ q: ctx.query.q, minScore: ctx.query.minScore, limit: U.int(ctx.query.limit, 30) }) }));
route('GET', '/api/breakdown/reports/:id', (ctx) => B.report(ctx.params.id));
route('POST', '/api/breakdown/reports/:id/rerun', (ctx) => { A.requireLevel(ctx, 'editor'); return B.rerun(ctx, ctx.params.id, ctx.body.kind); });

/* ---------------- 批量混剪 ---------------- */
route('GET', '/api/remix/constants', () => ({ grades: R.GRADES, hooks: R.HOOK_KINDS, subtitles: R.SUBTITLE_STYLES, bgm: R.BGM_MOODS, ratios: R.RATIOS }));
route('GET', '/api/remix/assets', (ctx) => ({ items: R.assets(ctx, { grade: ctx.query.grade, kind: ctx.query.kind }) }));
route('POST', '/api/remix/assets', (ctx) => { A.requireLevel(ctx, 'editor'); return R.addAsset(ctx, ctx.body); });
route('POST', '/api/remix/assets/:id/grade', (ctx) => { A.requireLevel(ctx, 'editor'); return R.gradeAsset(ctx, ctx.params.id, ctx.body.grade); });
route('POST', '/api/remix/upload', async (ctx) => {
  A.requireLevel(ctx, 'editor');
  const raw = await readRaw(ctx.req);
  A.need(raw.length > 0, 400, '文件为空');
  const name = decodeURIComponent(U.str(ctx.req.headers['x-file-name'], 200)) || `upload_${Date.now()}`;
  const ext = path.extname(name).toLowerCase();
  const kind = ['.mp4', '.mov', '.webm', '.m4v'].includes(ext) ? 'video'
    : ['.mp3', '.wav', '.m4a', '.aac'].includes(ext) ? 'audio'
      : ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? 'image' : null;
  A.need(kind, 400, '仅支持视频 / 音频 / 图片');
  A.need(R.GRADES.some(g => g.key === ctx.query.grade), 400, '请选择素材分级');
  const dir = path.join(U.DATA_DIR, 'uploads', ctx.user.id);
  fs.mkdirSync(dir, { recursive: true });
  const safe = `${U.uid('file')}${ext}`;
  const local = path.join(dir, safe);
  fs.writeFileSync(local, raw);
  const id = DB.insert('media_assets', {
    user_id: ctx.user.id, org_id: ctx.body?.orgId || null, project_id: ctx.query.projectId || null,
    title: U.str(ctx.query.title || name, 200), kind, grade: ctx.query.grade,
    file_name: name, storage_path: `uploads/${ctx.user.id}/${safe}`, local_path: local,
    size: raw.length, license_note: U.str(ctx.query.licenseNote, 300) || '自有 / 已授权', created_at: U.now()
  });
  A.audit(ctx, 'remix.asset.upload', id, `${name} (${(raw.length / 1024 / 1024).toFixed(2)} MB)`);
  return { id, kind, grade: ctx.query.grade, size: raw.length, name };
});
route('POST', '/api/remix/plan', async (ctx) => { A.requireLevel(ctx, 'editor'); return R.plan(ctx, ctx.body); });
route('GET', '/api/remix/plans', (ctx) => ({ items: R.plans(ctx) }));
route('POST', '/api/remix/batches', (ctx) => { A.requireLevel(ctx, 'editor'); return R.createBatch(ctx, ctx.body); });
route('GET', '/api/remix/batches', (ctx) => ({ items: R.batches(ctx) }));
route('GET', '/api/remix/batches/:id', (ctx) => R.batch(ctx.params.id));
route('POST', '/api/remix/batches/:id/cancel', (ctx) => { A.requireLevel(ctx, 'editor'); return R.cancelBatch(ctx, ctx.params.id); });
route('POST', '/api/remix/batches/:id/resume', (ctx) => { A.requireLevel(ctx, 'editor'); return R.resumeBatch(ctx, ctx.params.id); });
route('GET', '/api/remix/jobs/:id', (ctx) => R.jobDetail(ctx.params.id));
route('POST', '/api/remix/jobs/:id/retry', (ctx) => { A.requireLevel(ctx, 'editor'); return R.retryJob(ctx, ctx.params.id); });

/* ---------------- 多人协作 ---------------- */
route('GET', '/api/collab/overview', (ctx) => C.overview(ctx));
route('GET', '/api/collab/orgs', (ctx) => ({ items: C.orgs(ctx) }));
route('GET', '/api/collab/projects', (ctx) => ({ items: C.projects(ctx) }));
route('POST', '/api/collab/projects', (ctx) => C.createProject(ctx, ctx.body));
route('GET', '/api/collab/members', (ctx) => ({ items: C.members(ctx) }));
route('POST', '/api/collab/members', (ctx) => C.addMember(ctx, ctx.body));
route('POST', '/api/collab/members/:id/role', (ctx) => C.setRole(ctx, ctx.params.id, ctx.body.role));
route('DELETE', '/api/collab/members/:id', (ctx) => C.removeMember(ctx, ctx.params.id));
route('GET', '/api/collab/users', (ctx) => ({ items: C.users(ctx) }));
route('POST', '/api/collab/users/:id/status', (ctx) => C.setUserStatus(ctx, ctx.params.id, ctx.body.status));
route('POST', '/api/collab/users/:id/reset', (ctx) => C.resetPassword(ctx, ctx.params.id, ctx.body.password));
route('GET', '/api/collab/comments', (ctx) => ({ items: C.comments(ctx.query.assetId, U.int(ctx.query.limit, 100)) }));
route('POST', '/api/collab/comments', (ctx) => C.addComment(ctx, ctx.body));
route('POST', '/api/collab/comments/:id/resolve', (ctx) => C.resolveComment(ctx, ctx.params.id, U.bool(ctx.body.resolved)));
route('GET', '/api/collab/versions', (ctx) => ({ items: C.versions(ctx.query.assetId) }));
route('POST', '/api/collab/versions', (ctx) => C.addVersion(ctx, ctx.body));
route('GET', '/api/collab/approvals', (ctx) => ({ items: C.approvals(ctx, ctx.query.status) }));
route('POST', '/api/collab/approvals', (ctx) => C.requestApproval(ctx, ctx.body));
route('POST', '/api/collab/approvals/:id/decide', (ctx) => C.decideApproval(ctx, ctx.params.id, ctx.body));
route('GET', '/api/collab/audit', (ctx) => ({ items: C.auditLogs(ctx, U.int(ctx.query.limit, 100)) }));
route('GET', '/api/collab/quota', (ctx) => C.quota(ctx));

/* ---------------- 静态资源与产出文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
function serveFile(res, file, { download = false } = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { U.fail(res, 404, '文件不存在'); return; }
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'Content-Type': type, 'Content-Length': stat.size,
    'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes'
  };
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}
function serveOutput(req, res, pathname, user) {
  if (!user) { U.fail(res, 401, '请先登录'); return; }
  const m = pathname.match(/^\/media\/outputs\/([^/]+)\/([^/]+)$/);
  if (!m) { U.fail(res, 404, '路径不合法'); return; }
  const job = DB.get('SELECT * FROM remix_jobs WHERE id=?', m[1]);
  if (!job) { U.fail(res, 404, '任务不存在'); return; }
  const dir = path.join(U.OUTPUT_DIR, job.id);
  const file = path.join(dir, path.basename(decodeURIComponent(m[2])));
  if (!file.startsWith(dir + path.sep)) { U.fail(res, 403, '路径越界'); return; }
  serveFile(res, file, { download: req.url.includes('download=1') });
}
function serveStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const blocked = /^\/(server|data|\.git|\.workbuddy)(\/|$)/.test(pathname);
  if (blocked) { U.fail(res, 403, '禁止访问'); return; }
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(U.PUBLIC_DIR, rel);
  if (!file.startsWith(U.PUBLIC_DIR + path.sep)) { U.fail(res, 403, '路径越界'); return; }
  if (!fs.existsSync(file)) { U.fail(res, 404, '页面不存在'); return; }
  if (fs.statSync(file).isDirectory()) { serveStatic(req, res, path.join(pathname, 'index.html')); return; }
  serveFile(res, file);
}

/* ---------------- 服务器 ---------------- */
async function handle(ctx, r) {
  if (!r.public) A.requireAuth(ctx);
  const result = await r.fn(ctx);
  if (result === undefined) return;
  U.ok(ctx.res, result instanceof Object && !Array.isArray(result) ? result : { data: result });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/media/outputs/')) { serveOutput(req, res, pathname, A.userFromReq(req)); return; }
    if (pathname.startsWith('/api/')) {
      const r = routes.find(x => x.method === req.method && x.rx.test(pathname));
      if (!r) { U.fail(res, 404, `接口不存在: ${req.method} ${pathname}`); return; }
      const m = pathname.match(r.rx);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) && !pathname.endsWith('/upload')
        ? await U.readBody(req) : {};
      const ctx = { req, res, user: A.userFromReq(req), body, query: q(url), params, url };
      await handle(ctx, r);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') { serveStatic(req, res, pathname); return; }
    U.fail(res, 405, '方法不允许');
  } catch (e) {
    const status = e instanceof A.HttpError ? e.status : 500;
    if (status === 500) console.error('[api error]', req.method, pathname, e);
    if (!res.headersSent) U.fail(res, status, e.message || '服务器错误');
  }
});

const seedInfo = DB.seed();
process.env.SV_TZ = U.str(DB.getConfig('discover.timezone')) || 'Asia/Shanghai';
console.log(`[init] 组织 ${seedInfo.org?.name || '-'} / 项目 ${seedInfo.project?.name || '-'}`);
console.log(`[init] 能力状态`, P.providerStatus());
CRON.start();
const PORT = U.int(process.env.PORT || process.env.SV_PORT, 3000);
const HOST = process.env.SV_HOST || '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`[ready] 短视频工作台服务已启动 http://${HOST}:${PORT}`));
process.on('SIGTERM', () => { CRON.stop(); server.close(() => process.exit(0)); });
module.exports = { server, routes };
