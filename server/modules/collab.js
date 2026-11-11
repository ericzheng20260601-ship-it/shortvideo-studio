'use strict';
const U = require('../lib/util');
const DB = require('../lib/db');
const A = require('../lib/auth');
const R = require('./remix');

const ROLES = ['viewer', 'reviewer', 'editor', 'admin', 'owner'];
const ROLE_LABEL = { viewer: '查看者', reviewer: '评审员', editor: '创作者', admin: '管理员', owner: '拥有者' };

function orgs(ctx) {
  return DB.all(`SELECT o.id,o.name,o.created_at,
    (SELECT count(*) FROM members m WHERE m.org_id=o.id) AS memberCount,
    (SELECT count(*) FROM projects p WHERE p.org_id=o.id) AS projectCount
    FROM orgs o JOIN members mm ON mm.org_id=o.id WHERE mm.user_id=? GROUP BY o.id`, ctx.user.id);
}
function projects(ctx) {
  return DB.all(`SELECT p.id,p.name,p.track,p.org_id,p.created_at,
    (SELECT count(*) FROM media_assets a WHERE a.project_id=p.id) AS assetCount,
    (SELECT count(*) FROM remix_batches b WHERE b.project_id=p.id) AS batchCount
    FROM projects p JOIN members m ON m.org_id=p.org_id
    WHERE m.user_id=? AND (m.project_id IS NULL OR m.project_id=p.id) GROUP BY p.id`, ctx.user.id);
}
function createProject(ctx, body) {
  A.requireLevel(ctx, 'admin');
  const orgId = body.orgId || orgs(ctx)[0]?.id;
  A.need(orgId, 400, '缺少组织');
  const id = DB.insert('projects', { org_id: orgId, name: U.str(body.name, 100) || '新项目', track: U.str(body.track, 40) || 'pet', created_at: U.now() });
  A.audit(ctx, 'collab.project.create', id, body.name);
  return { id, name: body.name };
}
function members(ctx) {
  A.requireLevel(ctx, 'admin');
  return DB.all(`SELECT m.id,m.org_id,m.project_id,m.role,m.created_at,m.user_id,u.email,u.name,u.status,
    o.name AS orgName,p.name AS projectName
    FROM members m JOIN users u ON u.id=m.user_id JOIN orgs o ON o.id=m.org_id
    LEFT JOIN projects p ON p.id=m.project_id ORDER BY m.created_at DESC`);
}
function users(ctx) {
  A.requireLevel(ctx, 'admin');
  return DB.all('SELECT id,email,name,global_role,status,must_change,created_at,last_login_at FROM users ORDER BY created_at');
}
function addMember(ctx, body) {
  A.requireLevel(ctx, 'admin');
  const orgId = body.orgId || orgs(ctx)[0]?.id;
  A.need(orgId, 400, '缺少组织');
  const role = ROLES.includes(body.role) ? body.role : 'viewer';
  let user = DB.get('SELECT * FROM users WHERE email=?', U.lower(body.email));
  if (!user) {
    // 未显式给密码时生成随机初始密码，并且只在创建响应里返回一次：
    // 数据库只存 PBKDF2 摘要，管理员必须当场复制邀请信息发给成员。
    const pwd = String(body.password || '').trim() || U.randomPassword();
    A.need(String(pwd).length >= 8, 400, '初始密码至少 8 位');
    const created = A.createUser({ email: body.email, name: body.name, password: pwd, role, orgId, projectId: body.projectId, mustChange: 1 });
    user = { id: created.id };
    A.audit(ctx, 'collab.user.create', created.id, body.email);
    return { userId: created.id, email: U.lower(body.email), name: U.str(body.name, 60) || '', role, created: true, initialPassword: pwd, mustChange: true };
  }
  DB.insert('members', { org_id: orgId, project_id: body.projectId || null, user_id: user.id, role, created_at: U.now() });
  A.audit(ctx, 'collab.member.add', user.id, `${orgId}/${role}`);
  return { userId: user.id, created: false };
}
function setRole(ctx, id, role) {
  A.requireLevel(ctx, 'admin');
  A.need(ROLES.includes(role), 400, '角色不合法');
  DB.run('UPDATE members SET role=? WHERE id=?', role, id);
  A.audit(ctx, 'collab.member.role', id, role);
  return { id, role };
}
function removeMember(ctx, id) {
  A.requireLevel(ctx, 'admin');
  DB.run('DELETE FROM members WHERE id=?', id);
  A.audit(ctx, 'collab.member.remove', id, '');
  return { id };
}
function setUserStatus(ctx, id, status) {
  A.requireLevel(ctx, 'admin');
  A.need(['active', 'disabled'].includes(status), 400, '状态不合法');
  if (id === ctx.user.id && status === 'disabled') throw new A.HttpError(400, '不能停用当前登录账号');
  DB.run('UPDATE users SET status=? WHERE id=?', status, id);
  A.audit(ctx, 'collab.user.status', id, status);
  return { id, status };
}
function resetPassword(ctx, id, password) {
  A.requireLevel(ctx, 'admin');
  A.need(String(password || '').length >= 8, 400, '初始密码至少 8 位');
  const h = U.hashPassword(password);
  DB.update('users', id, { ...h, must_change: 1 });
  DB.run('DELETE FROM sessions WHERE user_id=?', id);
  A.audit(ctx, 'collab.user.reset', id, '');
  return { id, initialPassword: password, mustChange: true };
}

function comments(assetId, limit = 100) {
  return DB.all(`SELECT c.*,u.name AS authorName,u.email AS authorEmail FROM asset_comments c
    LEFT JOIN users u ON u.id=c.user_id WHERE c.asset_id=? ORDER BY c.frame_t,c.created_at LIMIT ?`, assetId, U.clamp(limit, 1, 300))
    .map(c => ({ ...c, author: c.authorName || c.authorEmail || '系统' }));
}
function addComment(ctx, body) {
  A.requireLevel(ctx, 'reviewer', body.projectId);
  A.need(U.str(body.text).trim(), 400, '批注内容不能为空');
  const id = DB.insert('asset_comments', {
    asset_id: U.str(body.assetId, 120), user_id: ctx.user.id, frame_t: Number(body.frameT) || 0,
    text: U.str(body.text, 1000), resolved: 0, created_at: U.now()
  });
  A.audit(ctx, 'collab.comment.add', id, `${body.assetId}@${body.frameT}s`);
  return { id };
}
function resolveComment(ctx, id, resolved) {
  A.requireLevel(ctx, 'reviewer');
  DB.run('UPDATE asset_comments SET resolved=? WHERE id=?', resolved ? 1 : 0, id);
  A.audit(ctx, 'collab.comment.resolve', id, resolved ? 'resolved' : 'reopened');
  return { id };
}
function versions(assetId) {
  return DB.all(`SELECT v.*,u.name AS authorName FROM asset_versions v LEFT JOIN users u ON u.id=v.created_by
    WHERE v.asset_id=? ORDER BY v.version DESC`, assetId);
}
function addVersion(ctx, body) {
  A.requireLevel(ctx, 'editor', body.projectId);
  const last = DB.get('SELECT max(version) AS v FROM asset_versions WHERE asset_id=?', U.str(body.assetId, 120))?.v || 0;
  const id = DB.insert('asset_versions', {
    asset_id: U.str(body.assetId, 120), version: last + 1, file_path: U.str(body.filePath, 500),
    note: U.str(body.note, 500), created_by: ctx.user.id, created_at: U.now()
  });
  A.audit(ctx, 'collab.version.add', id, `${body.assetId} V${last + 1}`);
  return { id, version: last + 1 };
}
function approvals(ctx, status = '') {
  let rows = DB.all(`SELECT a.*,u.name AS requesterName,r.name AS reviewerName FROM approvals a
    LEFT JOIN users u ON u.id=a.requested_by LEFT JOIN users r ON r.id=a.reviewer_id
    ORDER BY a.created_at DESC LIMIT 100`);
  if (status) rows = rows.filter(r => r.status === status);
  return rows;
}
function requestApproval(ctx, body) {
  A.requireLevel(ctx, 'editor', body.projectId);
  const id = DB.insert('approvals', {
    asset_id: body.assetId || null, job_id: body.jobId || null, project_id: body.projectId || null,
    requested_by: ctx.user.id, reviewer_id: body.reviewerId || null, status: 'pending',
    note: U.str(body.note, 500), created_at: U.now()
  });
  A.audit(ctx, 'collab.approval.request', id, body.jobId || body.assetId || '');
  return { id };
}
function decideApproval(ctx, id, { decision, note }) {
  A.requireLevel(ctx, 'reviewer');
  A.need(['approved', 'rejected'].includes(decision), 400, '审批结论不合法');
  const row = DB.get('SELECT * FROM approvals WHERE id=?', id);
  A.need(row && row.status === 'pending', 404, '待审批记录不存在');
  DB.update('approvals', id, { status: decision, reviewer_id: ctx.user.id, note: U.str(note, 500), decided_at: U.now() });
  A.audit(ctx, 'collab.approval.decide', id, decision);
  return { id, status: decision };
}
function auditLogs(ctx, limit = 100) {
  A.requireLevel(ctx, 'admin');
  return DB.all('SELECT * FROM audit_logs ORDER BY ts DESC LIMIT ?', U.clamp(limit, 1, 300));
}
function quota(ctx) {
  const d = U.day();
  const row = DB.get('SELECT * FROM quota_usage WHERE user_id=? AND day=?', ctx.user.id, d) || { jobs: 0, renders: 0, api_calls: 0 };
  return {
    day: d, jobs: row.jobs, renders: row.renders,
    jobsLimit: A.levelOf(ctx.user) >= A.ROLE_LEVEL.owner ? -1 : U.int(DB.getConfig('quota.jobsPerDay'), 50),
    rendersLimit: A.levelOf(ctx.user) >= A.ROLE_LEVEL.owner ? -1 : U.int(DB.getConfig('quota.rendersPerDay'), 50),
    maxConcurrent: U.int(DB.getConfig('remix.maxConcurrent'), 2),
    role: ctx.user.global_role, roleLabel: ROLE_LABEL[ctx.user.global_role] || ctx.user.global_role
  };
}
function overview(ctx) {
  return {
    orgs: orgs(ctx), projects: projects(ctx), quota: quota(ctx),
    assets: DB.get('SELECT count(*) AS n FROM media_assets')?.n || 0,
    batches: DB.get('SELECT count(*) AS n FROM remix_batches')?.n || 0,
    comments: DB.get('SELECT count(*) AS n FROM asset_comments')?.n || 0,
    approvalsPending: DB.get("SELECT count(*) AS n FROM approvals WHERE status='pending'")?.n || 0,
    users: DB.get('SELECT count(*) AS n FROM users')?.n || 0,
    roles: ROLES.map(k => ({ key: k, label: ROLE_LABEL[k] })),
    grades: R.GRADES
  };
}

module.exports = {
  ROLES, ROLE_LABEL, orgs, projects, createProject, members, users, addMember, setRole, removeMember,
  setUserStatus, resetPassword, comments, addComment, resolveComment, versions, addVersion,
  approvals, requestApproval, decideApproval, auditLogs, quota, overview
};
