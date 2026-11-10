'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const U = require('./util');

const db = new DatabaseSync(path.join(U.DATA_DIR, 'studio.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
  pwd_salt TEXT NOT NULL, pwd_hash TEXT NOT NULL, pwd_iters INTEGER NOT NULL DEFAULT 120000,
  global_role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active',
  must_change INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL, ip TEXT, ua TEXT
);
CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, track TEXT NOT NULL DEFAULT 'pet',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, project_id TEXT, user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id, org_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, actor_id TEXT, actor_email TEXT, action TEXT NOT NULL,
  target TEXT, detail TEXT, ip TEXT
);
CREATE TABLE IF NOT EXISTS quota_usage (
  user_id TEXT NOT NULL, day TEXT NOT NULL, jobs INTEGER NOT NULL DEFAULT 0,
  renders INTEGER NOT NULL DEFAULT 0, api_calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, day)
);
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS radar_items (
  id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'demo', platform TEXT NOT NULL DEFAULT 'tiktok',
  video_id TEXT, title TEXT NOT NULL, author TEXT, author_id TEXT, url TEXT, cover TEXT,
  category TEXT NOT NULL DEFAULT 'pet', country TEXT NOT NULL DEFAULT 'US', product TEXT,
  duration_sec INTEGER DEFAULT 30, views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0, saves INTEGER DEFAULT 0, shares INTEGER DEFAULT 0,
  gmv_estimate REAL DEFAULT 0, posted_at TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  heat REAL DEFAULT 0, raw TEXT
);
CREATE INDEX IF NOT EXISTS radar_items_cat_idx ON radar_items(category, country, last_seen);
CREATE TABLE IF NOT EXISTS radar_snapshots (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, day TEXT NOT NULL, views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, saves INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0, gmv_estimate REAL DEFAULT 0, rank INTEGER, heat REAL DEFAULT 0,
  synced_at TEXT NOT NULL, UNIQUE(item_id, day)
);
CREATE INDEX IF NOT EXISTS snap_day_idx ON radar_snapshots(day);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, value TEXT NOT NULL,
  category TEXT, country TEXT, channels TEXT NOT NULL DEFAULT '["inbox"]',
  enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL,
  payload TEXT, sent_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, title TEXT NOT NULL,
  source_item_id TEXT, category TEXT, country TEXT, status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS breakdown_reports (
  id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, item_id TEXT, title TEXT NOT NULL,
  url TEXT, platform TEXT, transcript TEXT, duration_sec INTEGER DEFAULT 0,
  hook_text TEXT, hook_score REAL DEFAULT 0, viral_score REAL DEFAULT 0,
  structure_json TEXT, scenes_json TEXT, visual_json TEXT, prompt_reverse TEXT,
  voc_json TEXT, judge_json TEXT, rewrite_text TEXT, source_mode TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS report_search_idx ON breakdown_reports(viral_score, created_at);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY, user_id TEXT, org_id TEXT, project_id TEXT, title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'video', grade TEXT NOT NULL DEFAULT 'product',
  file_name TEXT, storage_path TEXT, local_path TEXT, size INTEGER DEFAULT 0,
  duration_sec REAL DEFAULT 0, license_note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS remix_plans (
  id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, prompt TEXT NOT NULL,
  style TEXT, duration_sec INTEGER DEFAULT 30, storyboard_json TEXT NOT NULL,
  source_mode TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS remix_batches (
  id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, plan_id TEXT, name TEXT NOT NULL,
  matrix_json TEXT, total INTEGER DEFAULT 0, done INTEGER DEFAULT 0, failed INTEGER DEFAULT 0,
  cancelled INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS remix_jobs (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, idx INTEGER NOT NULL, variant_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued', progress INTEGER DEFAULT 0, stage TEXT,
  tts_path TEXT, srt_path TEXT, output_path TEXT, ratios_json TEXT, qc_json TEXT,
  package_json TEXT, error TEXT, attempts INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_batch_idx ON remix_jobs(batch_id, idx);
CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, ts TEXT NOT NULL, stage TEXT, message TEXT
);

CREATE TABLE IF NOT EXISTS asset_comments (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, user_id TEXT, frame_t REAL DEFAULT 0,
  text TEXT NOT NULL, resolved INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_versions (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version INTEGER NOT NULL, file_path TEXT,
  note TEXT, created_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, asset_id TEXT, job_id TEXT, project_id TEXT, requested_by TEXT,
  reviewer_id TEXT, status TEXT NOT NULL DEFAULT 'pending', note TEXT,
  created_at TEXT NOT NULL, decided_at TEXT
);
`);

const colCache = new Map();
const pkCache = new Map();
function info(table) {
  if (!colCache.has(table)) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    colCache.set(table, rows.map(r => r.name));
    pkCache.set(table, rows.find(r => r.pk)?.name || 'id');
  }
  return { columns: colCache.get(table), pk: pkCache.get(table) };
}
function cols(table) { return info(table).columns; }
function pkCol(table) { return info(table).pk; }
function all(sql, ...p) { return db.prepare(sql).all(...p.map(bindVal)); }
function get(sql, ...p) { return db.prepare(sql).get(...p.map(bindVal)); }
function run(sql, ...p) { return db.prepare(sql).run(...p.map(bindVal)); }
function bindVal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return U.toJson(v);
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  return String(v);
}
function insert(table, obj) {
  const pk = pkCol(table);
  const allowed = cols(table).filter(c => c !== pk);
  const keys = allowed.filter(k => obj[k] !== undefined);
  const id = obj[pk] || obj.id || U.uid(table);
  const names = [pk, ...keys];
  const sql = `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`;
  run(sql, id, ...keys.map(k => bindVal(obj[k])));
  return id;
}
function update(table, id, obj) {
  const pk = pkCol(table);
  const keys = cols(table).filter(k => k !== pk && obj[k] !== undefined);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(',')} WHERE ${pk}=?`,
    ...keys.map(k => bindVal(obj[k])), id);
}
function remove(table, id) { run(`DELETE FROM ${table} WHERE ${pkCol(table)}=?`, id); }
function tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }

function getConfig(key, fallback) {
  const envKey = 'SV_' + key.toUpperCase().replace(/\./g, '_');
  if (process.env[envKey] !== undefined) return process.env[envKey];
  const row = get('SELECT value FROM config WHERE key=?', key);
  if (!row) return fallback;
  const parsed = U.jsonParse(row.value, undefined);
  return parsed === undefined ? row.value : parsed;
}
function setConfig(key, value) {
  run('INSERT INTO config(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    key, U.toJson(value), U.now());
}
function allConfig() {
  const out = {};
  for (const r of all('SELECT key,value FROM config')) out[r.key] = U.jsonParse(r.value, r.value);
  return out;
}

function seed() {
  const defaults = {
    'discover.syncHour': 8,
    'discover.digestHour': 9,
    'discover.timezone': 'Asia/Shanghai',
    'discover.source': 'demo',
    'discover.categories': ['pet', 'beauty', 'fragrance', 'skincare', 'home'],
    'discover.countries': ['US', 'UK', 'ID', 'TH', 'VN'],
    'discover.limit': 40,
    'data.apiUrl': '',
    'data.apiKey': '',
    'llm.baseUrl': '',
    'llm.apiKey': '',
    'llm.model': 'gpt-4o-mini',
    'asr.apiUrl': '',
    'asr.apiKey': '',
    'tts.apiUrl': '',
    'tts.apiKey': '',
    'tts.voice': 'alloy',
    'push.webhookUrl': '',
    'push.channel': 'wecom',
    'quota.jobsPerDay': 50,
    'quota.rendersPerDay': 50,
    'remix.maxConcurrent': 2,
    'remix.ffmpegPath': '',
    'content.aigcLabel': true,
    'content.bannedWords': ['最', '第一', '绝对', '根治', '100%有效', '国家级', '包治', '永久']
  };
  for (const [k, v] of Object.entries(defaults)) if (get('SELECT 1 FROM config WHERE key=?', k) == null) setConfig(k, v);

  if (!get('SELECT 1 FROM users LIMIT 1')) {
    // 复用仓库名单里的 PBKDF2 摘要：前端静态登录门与服务端共用同一组初始凭据，不引入明文密码
    let imported = 0, firstUser = null;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(U.PUBLIC_DIR, 'data', 'accounts.json'), 'utf8'));
      const ip = cfg.initialPassword || {};
      if (ip.salt && ip.hash) {
        for (const a of (cfg.accounts || [])) {
          if (!a.enabled) continue;
          const id = U.uid('usr');
          insert('users', {
            id, email: U.lower(a.email), name: U.str(a.name, 60) || '创作者',
            pwd_salt: ip.salt, pwd_iters: U.int(ip.iterations, 120000), pwd_hash: ip.hash,
            global_role: a.role === 'admin' ? 'owner' : 'viewer', status: 'active', must_change: 0, created_at: U.now()
          });
          if (!firstUser) firstUser = id;
          imported++;
        }
      }
    } catch (e) { console.warn('[seed] 名单导入失败，将创建独立管理员：', e.message); }
    if (!imported) {
      const email = U.lower(process.env.SV_ADMIN_EMAIL || 'ericzheng20260601@gmail.com');
      const password = process.env.SV_ADMIN_PASSWORD || U.randomPassword();
      firstUser = U.uid('usr');
      insert('users', { id: firstUser, email, name: '管理员', ...U.hashPassword(password), global_role: 'owner', status: 'active', must_change: 0, created_at: U.now() });
      fs.writeFileSync(path.join(U.DATA_DIR, 'initial-admin.txt'), `初始管理员：${email}\n初始密码：${password}\n请首次登录后立即修改密码。\n`, { mode: 0o600 });
    }
    if (process.env.SV_ADMIN_PASSWORD && firstUser) {
      update('users', firstUser, U.hashPassword(process.env.SV_ADMIN_PASSWORD));
    }
    const orgId = U.uid('org');
    insert('orgs', { id: orgId, name: '默认团队', created_at: U.now() });
    insert('projects', { org_id: orgId, name: '默认项目', track: 'pet', created_at: U.now() });
    for (const u of all('SELECT id,global_role FROM users')) insert('members', { org_id: orgId, project_id: null, user_id: u.id, role: u.global_role, created_at: U.now() });
    if (imported) fs.writeFileSync(path.join(U.DATA_DIR, 'initial-admin.txt'),
      `服务端账号已从仓库名单导入（仅 PBKDF2 摘要，无明文）。\n初始密码沿用本机凭据说明中的初始登录密码。\n新增成员请在「管理后台 → 云服务器管理」操作。\n`, { mode: 0o600 });
    console.log(`[seed] 初始化完成：${imported || 1} 个账号，1 个组织 / 1 个项目`);
  }
  return {
    org: get('SELECT * FROM orgs ORDER BY created_at LIMIT 1'),
    project: get('SELECT * FROM projects ORDER BY created_at LIMIT 1')
  };
}

module.exports = { db, all, get, run, insert, update, remove, tx, getConfig, setConfig, allConfig, seed, cols };
