'use strict';
const U = require('./util');
const DB = require('./db');

const ROLE_LEVEL = { viewer: 1, reviewer: 2, editor: 3, admin: 4, owner: 5 };
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const need = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };

/* 部分托管网关会改写/注入 Authorization 头，因此按优先级收集多个候选令牌：
   自定义头 X-SV-Token > 同源 Cookie sv_token > 标准 Bearer。逐个验签，取第一个有效的。 */
function tokenCandidates(req) {
  const h = req.headers || {};
  const out = [];
  if (h['x-sv-token']) out.push(String(h['x-sv-token']).trim());
  const cookie = h.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sv_token=([^;]+)/);
  if (m) {
    let v; try { v = decodeURIComponent(m[1]); } catch { v = m[1]; }
    out.push(v);
  }
  const auth = String(h.authorization || '');
  if (auth.startsWith('Bearer ')) out.push(auth.slice(7).trim());
  return out.filter(Boolean);
}
function tokenFrom(req) { return tokenCandidates(req)[0] || ''; }
function userFromReq(req) {
  for (const t of tokenCandidates(req)) {
    const p = U.readToken(t);
    if (!p || !p.sid) continue;
    const s = DB.get('SELECT * FROM sessions WHERE token_id=? AND expires_at>?', p.sid, U.now());
    if (!s) continue;
    return DB.get('SELECT * FROM users WHERE id=? AND status=?', s.user_id, 'active') || null;
  }
  return null;
}
function login(email, password, req) {
  const u = DB.get('SELECT * FROM users WHERE email=? AND status=?', U.lower(email), 'active');
  if (!u || !U.verifyPassword(password, u)) throw new HttpError(401, '邮箱或密码不正确');
  const sid = U.uid('ses');
  DB.insert('sessions', { token_id: sid, user_id: u.id, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), created_at: U.now(), ip: U.str(req?.socket?.remoteAddress, 80), ua: U.str(req?.headers?.['user-agent'], 200) });
  DB.update('users', u.id, { last_login_at: U.now() });
  audit({ user: u, req }, 'auth.login', u.id, '');
  const token = U.signToken({ sid, uid: u.id });
  return { token, user: publicUser(u) };
}
function logout(req) {
  for (const t of tokenCandidates(req)) {
    const p = U.readToken(t);
    if (p?.sid) DB.run('DELETE FROM sessions WHERE token_id=?', p.sid);
  }
}
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.global_role, mustChange: !!u.must_change };
}
function me(ctx) {
  const u = ctx.user;
  const orgs = DB.all(`SELECT o.id,o.name,m.role FROM members m JOIN orgs o ON o.id=m.org_id WHERE m.user_id=? GROUP BY o.id`, u.id);
  const projects = DB.all(`SELECT p.id,p.name,p.track,p.org_id FROM projects p JOIN members m ON m.org_id=p.org_id WHERE m.user_id=? AND (m.project_id IS NULL OR m.project_id=p.id) GROUP BY p.id`, u.id);
  return { ...publicUser(u), orgs, projects, defaultOrg: orgs[0]?.id || null, defaultProject: projects[0]?.id || null };
}

function levelOf(user) { return ROLE_LEVEL[user?.global_role] || 0; }
function projectRole(userId, projectId) {
  if (!projectId) return null;
  const p = DB.get('SELECT org_id FROM projects WHERE id=?', projectId);
  if (!p) return null;
  const m = DB.get(`SELECT role FROM members WHERE user_id=? AND org_id=? AND (project_id=? OR project_id IS NULL) ORDER BY CASE WHEN project_id=? THEN 0 ELSE 1 END LIMIT 1`, userId, p.org_id, projectId, projectId);
  return m?.role || null;
}
function effectiveLevel(ctx, projectId) {
  return Math.max(levelOf(ctx.user), ROLE_LEVEL[projectRole(ctx.user.id, projectId)] || 0);
}
function requireAuth(ctx) { need(ctx.user, 401, '请先登录'); return ctx.user; }
function requireLevel(ctx, role, projectId) {
  requireAuth(ctx);
  need(effectiveLevel(ctx, projectId) >= ROLE_LEVEL[role], 403, `需要 ${role} 及以上权限`);
}
function canEditProject(ctx, projectId) { return effectiveLevel(ctx, projectId) >= ROLE_LEVEL.editor; }

function audit(ctx, action, target = '', detail = '') {
  DB.insert('audit_logs', {
    ts: U.now(), actor_id: ctx?.user?.id || null, actor_email: ctx?.user?.email || 'system',
    action, target: U.str(target, 200), detail: typeof detail === 'string' ? U.str(detail, 2000) : U.toJson(detail),
    ip: U.str(ctx?.req?.socket?.remoteAddress, 80)
  });
}

function quotaCheck(ctx, kind, n = 1) {
  requireAuth(ctx);
  if (levelOf(ctx.user) >= ROLE_LEVEL.owner) return { allowed: true, used: 0, limit: -1 };
  const d = U.day();
  const key = kind === 'renders' ? 'quota.rendersPerDay' : 'quota.jobsPerDay';
  const limit = U.int(DB.getConfig(key), 50);
  const row = DB.get('SELECT * FROM quota_usage WHERE user_id=? AND day=?', ctx.user.id, d) || { jobs: 0, renders: 0, api_calls: 0 };
  const used = U.int(row[kind], 0);
  return { allowed: used + n <= limit, used, limit };
}
function quotaUse(ctx, kind, n = 1) {
  if (!ctx.user) return;
  const d = U.day();
  DB.run(`INSERT INTO quota_usage(user_id,day,jobs,renders,api_calls) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id,day) DO UPDATE SET ${kind}=${kind}+?`, ctx.user.id, d,
    kind === 'jobs' ? n : 0, kind === 'renders' ? n : 0, 0, n);
}

function createUser({ email, name, password, role = 'viewer', orgId, projectId, mustChange = 1 }) {
  const e = U.lower(email);
  need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e), 400, '邮箱格式不正确');
  need(String(password || '').length >= 8, 400, '初始密码至少 8 位');
  need(!DB.get('SELECT 1 FROM users WHERE email=?', e), 409, '邮箱已存在');
  const h = U.hashPassword(password);
  const id = U.uid('usr');
  DB.insert('users', { id, email: e, name: U.str(name, 60) || e.split('@')[0], ...h, global_role: role, status: 'active', must_change: mustChange ? 1 : 0, created_at: U.now() });
  if (orgId) DB.insert('members', { org_id: orgId, project_id: projectId || null, user_id: id, role, created_at: U.now() });
  return { id, email: e, role };
}

module.exports = {
  HttpError, need, tokenFrom, userFromReq, login, logout, publicUser, me,
  ROLE_LEVEL, levelOf, projectRole, effectiveLevel, requireAuth, requireLevel, canEditProject,
  audit, quotaCheck, quotaUse, createUser
};
