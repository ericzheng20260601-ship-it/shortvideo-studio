'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = ROOT;
const DATA_DIR = process.env.SV_DATA_DIR || path.join(__dirname, '..', 'data');
const OUTPUT_DIR = path.join(DATA_DIR, 'outputs');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
// 单个上传文件的上限（默认 200MB）。反向代理需同步放宽 client_max_body_size / 请求体限制。
const MAX_UPLOAD_MB = Math.min(2048, Math.max(16, Number.parseInt(process.env.SV_MAX_UPLOAD_MB, 10) || 200));
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

function ensureDirs() {
  for (const d of [DATA_DIR, OUTPUT_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });
}
ensureDirs();

const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
const now = () => new Date().toISOString();
const day = (d = new Date()) => {
  const tz = process.env.SV_TZ || 'Asia/Shanghai';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = t => parts.find(p => p.type === t)?.value || '00';
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch { return d.toISOString().slice(0, 10); }
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const int = (n, d = 0) => { const v = parseInt(n, 10); return Number.isFinite(v) ? v : d; };
const str = (v, max = 2000) => String(v == null ? '' : v).slice(0, max);
const lower = v => str(v).trim().toLowerCase();
const bool = v => v === true || v === 1 || v === '1' || v === 'true';
const jsonParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const toJson = v => JSON.stringify(v == null ? null : v);
const uniq = a => [...new Set(a)];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), iterations = 120000) {
  const hash = crypto.pbkdf2Sync(String(password), Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex');
  return { pwd_salt: salt, pwd_iters: iterations, pwd_hash: hash };
}
function verifyPassword(password, row) {
  if (!row || !row.pwd_salt || !row.pwd_hash) return false;
  const h = crypto.pbkdf2Sync(String(password), Buffer.from(row.pwd_salt, 'hex'), int(row.pwd_iters, 120000), 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(row.pwd_hash));
}
function randomPassword() {
  return `Sv@${crypto.randomBytes(6).toString('base64url')}`;
}

let secretCache;
function secret() {
  if (secretCache) return secretCache;
  // 显式 SV_SECRET 优先：容器重建 / 数据卷迁移后仍用同一签名密钥，已签发会话不会集体失效。
  // 首次部署就固定它，之后不要改；改动会强制所有已登录用户重新登录。
  const configured = String(process.env.SV_SECRET || '').trim();
  if (configured) { secretCache = configured; return secretCache; }
  const f = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(f)) secretCache = fs.readFileSync(f, 'utf8').trim();
  else {
    secretCache = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, secretCache, { mode: 0o600 });
  }
  return secretCache;
}
function signToken(payload, ttlSec = 7 * 86400) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Math.floor(Date.now() / 1000) ? p : null;
  } catch { return null; }
}

async function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('请求体过大')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

function send(res, data, status = 200, headers = {}) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const ok = (res, data = {}) => send(res, { ok: true, ...data });
function fail(res, status, message, extra = {}) { send(res, { ok: false, error: message, ...extra }, status); }

async function fetchJSON(url, { method = 'GET', headers = {}, body, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`上游 ${r.status}: ${text.slice(0, 200)}`);
    return jsonParse(text, { raw: text });
  } finally { clearTimeout(timer); }
}

function deterministic(seed) {
  let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function escapeHTML(s) { return str(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

module.exports = {
  ROOT, PUBLIC_DIR, DATA_DIR, OUTPUT_DIR, TMP_DIR, MAX_UPLOAD_MB, MAX_UPLOAD_BYTES,
  uid, now, day, clamp, int, str, lower, bool, jsonParse, toJson, uniq, pick,
  hashPassword, verifyPassword, randomPassword, signToken, readToken, secret,
  readBody, send, ok, fail, fetchJSON, deterministic, escapeHTML, ensureDirs
};
