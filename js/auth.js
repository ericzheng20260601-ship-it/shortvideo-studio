import { store } from './store.js';

const INITIAL_HASH = '2faa93ea00328bab7ed9fc42eacc2624c8b6386582b5eecc0a073d19a05090f5';
const FALLBACK = [{
  hash: INITIAL_HASH, name:'初始管理员', role:'admin', enabled:true,
  expiresAt:null, note:'首次使用请在管理后台吊销并签发新码', createdAt:'2026/11/10',
}];

let remoteList = null;
let remoteError = false;

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function loadAllowlist() {
  try {
    const url = new URL('../data/allowlist.json', import.meta.url);
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    const json = await res.json();
    remoteList = Array.isArray(json.entries) ? json.entries : FALLBACK;
    remoteError = false;
  } catch (_) {
    remoteList = FALLBACK;
    remoteError = true;
  }
  return { entries: mergedEntries(), remoteError };
}

function mergedEntries() {
  const base = remoteList || FALLBACK;
  const draft = store.get('codesDraft', []);
  const map = new Map();
  base.forEach(e => map.set(e.hash, e));
  draft.forEach(e => map.set(e.hash, e)); // 本地草稿覆盖仓库名单，便于签发/吊销即刻生效
  return Array.from(map.values());
}
export const getEntries = () => mergedEntries();
export const allowlistIsOffline = () => remoteError;

export async function verifyCode(raw) {
  const code = (raw || '').trim().toUpperCase();
  if (!code) return { ok:false, reason:'请输入授权码' };
  const hash = await sha256(code);
  const entry = mergedEntries().find(e => e.hash === hash);
  if (!entry) return { ok:false, reason:'授权码无效，请联系管理员' };
  if (!entry.enabled) return { ok:false, reason:'该授权码已被停用' };
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() < Date.now()) return { ok:false, reason:'授权码已过期' };
  return { ok:true, entry, code };
}

const SESSION_KEY = 'session';
export const getSession = () => store.get(SESSION_KEY, null);
export function setSession(s) { store.set(SESSION_KEY, s); }
export function clearSession() { store.set(SESSION_KEY, null); }

export async function revalidate() {
  const s = getSession();
  if (!s || !s.code) return null;
  const r = await verifyCode(s.code);
  if (!r.ok) { clearSession(); return null; }
  return { ...s, name:r.entry.name, role:r.entry.role };
}

export const isAdmin = () => getSession()?.role === 'admin';

export function logAccess(text) {
  const logs = store.get('logs', []);
  logs.unshift({ id:store.uid('log'), at:store.now(), text });
  store.set('logs', logs.slice(0, 120));
}

export function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => alphabet[b % alphabet.length]).join('');
  return `CT-${pick(4)}-${pick(4)}`;
}

export async function createEntry({ name, role = 'user', days = 30, note = '' }) {
  const code = genCode();
  const hash = await sha256(code);
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null;
  const entry = { hash, name, role, enabled:true, expiresAt, note, createdAt:store.now().slice(0, 10) };
  store.add('codesDraft', entry);
  return { code, entry };
}

export async function buildAllowlistJSON() {
  const entries = mergedEntries();
  return JSON.stringify({ version:1, updatedAt:new Date().toISOString(), note:'由管理后台签发；仅存授权码哈希，不存明文', entries }, null, 2);
}
