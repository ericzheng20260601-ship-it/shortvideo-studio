import { store } from './store.js';

/*
 * A-02 邮箱 + 密码账户体系
 * - 名单文件 data/accounts.json 只存 PBKDF2-SHA256 加盐摘要，不存任何明文密码。
 * - 没有自定义 salt/hash 的账号 = 使用「全局初始登录密码」（由管理后台配置）。
 * - 用户改密码后，账号获得自己的 salt/hash，立即在本机生效；
 *   要让其他设备同步，由管理员导出 accounts.json 覆盖仓库同名文件并提交。
 * - 静态托管没有服务端写接口，因此这是浏览器端名单校验，不是服务端强制鉴权。
 */

export const ITERATIONS = 120000;
export const PASSWORD_RULE = '至少 8 位，且同时包含字母和数字';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 内置兜底名单：与 data/accounts.json 一致（仅摘要）。名单文件加载失败时仍可登录。
const FALLBACK_INITIAL = {
  salt: '57614c86394f497fe7936a779da4388d',
  iterations: ITERATIONS,
  hash: '1954a2552f5bc7f5f64429e260650169b41907e02767cb8b9476d80addda8584',
  updatedAt: '2026/11/10',
  note: '初始登录密码由管理后台配置；此处仅存 PBKDF2 摘要',
};
const FALLBACK_ACCOUNTS = [{
  email: 'admin@shortvideo.studio', name: '初始管理员', role: 'admin',
  enabled: true, expiresAt: null, note: '首次登录后请立即修改密码', createdAt: '2026/11/10',
}];

let remote = null;
let remoteError = false;

export const normEmail = v => (v || '').trim().toLowerCase();
export const validPassword = p => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
export const usingInitial = a => !a.salt || !a.hash;

const fromHex = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));
const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(buf);
}

function randomSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function derive(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(salt), iterations, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

async function makeCredential(password) {
  const salt = randomSalt();
  return { salt, iterations: ITERATIONS, hash: await derive(password, salt, ITERATIONS) };
}

export async function loadAccounts() {
  try {
    const url = new URL('../data/accounts.json', import.meta.url);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    const json = await res.json();
    if (!json || !Array.isArray(json.accounts) || !json.initialPassword) throw new Error('结构不正确');
    remote = json;
    remoteError = false;
  } catch (_) {
    remote = null;
    remoteError = true;
  }
  return { config: mergedConfig(), remoteError };
}

// 本机草稿（管理员编辑 / 用户改密码）优先于仓库名单，便于操作即刻生效。
export function mergedConfig() {
  const localAccounts = store.get('accountsLocal', null);
  const localInitial = store.get('initialPasswordLocal', null);
  return {
    initialPassword: localInitial || remote?.initialPassword || FALLBACK_INITIAL,
    accounts: localAccounts || remote?.accounts || FALLBACK_ACCOUNTS,
  };
}
export const getAccounts = () => mergedConfig().accounts;
export const getInitialPassword = () => mergedConfig().initialPassword;
export const accountsIsOffline = () => remoteError;

function writeAccounts(list) { store.set('accountsLocal', list); }
function credOf(account, cfg) {
  return usingInitial(account) ? cfg.initialPassword : account;
}
// 凭据指纹：管理员重置密码后，旧会话在下次刷新时自动失效。
function credTagOf(account, cfg) {
  const c = credOf(account, cfg);
  return (c.hash || '').slice(0, 16);
}
function findAccount(cfg, email) {
  return cfg.accounts.find(a => normEmail(a.email) === normEmail(email));
}
const expired = a => !!(a.expiresAt && new Date(a.expiresAt).getTime() < Date.now());

export async function verifyLogin(rawEmail, password) {
  const email = normEmail(rawEmail);
  if (!EMAIL_RE.test(email)) return { ok: false, reason: '请输入有效的邮箱地址' };
  if (!password) return { ok: false, reason: '请输入登录密码' };
  const cfg = mergedConfig();
  const account = findAccount(cfg, email);
  // 不区分「账号不存在」与「密码错误」，避免账号枚举
  const bad = { ok: false, reason: '邮箱或密码不正确，请重试' };
  if (!account) return bad;
  const cred = credOf(account, cfg);
  let hash = '';
  try { hash = await derive(password, cred.salt, cred.iterations || ITERATIONS); } catch (_) { return bad; }
  if (hash !== cred.hash) return bad;
  if (!account.enabled) return { ok: false, reason: '该账号已被停用，请联系管理员' };
  if (expired(account)) return { ok: false, reason: '该账号已过期，请联系管理员续期' };
  return { ok: true, account, email, usingInitial: usingInitial(account), credTag: credTagOf(account, cfg) };
}

const SESSION_KEY = 'session';
export const getSession = () => store.get(SESSION_KEY, null);
export function setSession(s) { store.set(SESSION_KEY, s); }
export function clearSession() { store.set(SESSION_KEY, null); }

export async function revalidate() {
  const s = getSession();
  // 旧版授权码会话一律失效，需用邮箱重新登录
  if (!s || !s.email) { if (s) clearSession(); return null; }
  const cfg = mergedConfig();
  const a = findAccount(cfg, s.email);
  if (!a || !a.enabled || expired(a)) { clearSession(); return null; }
  const tag = credTagOf(a, cfg);
  if (s.credTag && s.credTag !== tag) { clearSession(); return null; }
  return { ...s, name: a.name, role: a.role, usingInitial: usingInitial(a), credTag: tag };
}

export const isAdmin = () => getSession()?.role === 'admin';

export function logAccess(text) {
  const logs = store.get('logs', []);
  logs.unshift({ id: store.uid('log'), at: store.now(), text });
  store.set('logs', logs.slice(0, 120));
}

/* ---------- 用户自助：修改密码 ---------- */
export async function changePassword(email, oldPassword, newPassword) {
  if (!validPassword(newPassword)) return { ok: false, reason: '新密码不符合规则：' + PASSWORD_RULE };
  const check = await verifyLogin(email, oldPassword);
  if (!check.ok) return { ok: false, reason: '当前密码不正确' };
  if (oldPassword === newPassword) return { ok: false, reason: '新密码不能与当前密码相同' };
  const cred = await makeCredential(newPassword);
  const cfg = mergedConfig();
  const list = cfg.accounts.map(a => normEmail(a.email) === normEmail(email)
    ? { ...a, ...cred, passwordUpdatedAt: store.now() } : a);
  writeAccounts(list);
  const s = getSession();
  if (s) setSession({ ...s, credTag: cred.hash.slice(0, 16), usingInitial: false });
  return { ok: true, credTag: cred.hash.slice(0, 16) };
}

/* ---------- 管理后台 ---------- */
export async function setInitialPassword(newPassword) {
  if (!validPassword(newPassword)) return { ok: false, reason: PASSWORD_RULE };
  const cred = await makeCredential(newPassword);
  store.set('initialPasswordLocal', { ...cred, updatedAt: store.now(), note: '由管理后台配置；仅存 PBKDF2 摘要' });
  const cfg = mergedConfig();
  const tag = cred.hash.slice(0, 16);
  // 仍在使用初始密码的账号，凭据指纹随之变化；同步当前管理员会话避免被自己踢下线
  const s = getSession();
  const me = s ? findAccount(cfg, s.email) : null;
  if (s && me && usingInitial(me)) setSession({ ...s, credTag: tag });
  return { ok: true };
}

export async function addAccount({ email, name, role = 'user', days = 30, note = '', password = '' }) {
  const mail = normEmail(email);
  if (!EMAIL_RE.test(mail)) return { ok: false, reason: '请输入有效的邮箱地址' };
  if (findAccount(mergedConfig(), mail)) return { ok: false, reason: '该邮箱已在名单中' };
  if (!name || !name.trim()) return { ok: false, reason: '请填写使用者名称' };
  let cred = {};
  if (password) {
    if (!validPassword(password)) return { ok: false, reason: '账号密码不符合规则：' + PASSWORD_RULE };
    cred = await makeCredential(password);
  }
  const account = {
    email: mail, name: name.trim(), role, enabled: true,
    expiresAt: days > 0 ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null,
    note: note.trim(), createdAt: store.now().slice(0, 10), ...cred,
  };
  const list = mergedConfig().accounts.slice();
  list.push(account);
  writeAccounts(list);
  return { ok: true, account };
}

export function toggleAccount(email) {
  const list = mergedConfig().accounts.map(a => normEmail(a.email) === normEmail(email) ? { ...a, enabled: !a.enabled } : a);
  writeAccounts(list);
  return list.find(a => normEmail(a.email) === normEmail(email));
}

export function removeAccount(email) {
  writeAccounts(mergedConfig().accounts.filter(a => normEmail(a.email) !== normEmail(email)));
}

export function setAccountRole(email, role) {
  const list = mergedConfig().accounts.map(a =>
    normEmail(a.email) === normEmail(email) ? { ...a, role } : a);
  writeAccounts(list);
}

// 重置为当前全局初始登录密码：移除账号自己的 salt/hash，回到「跟随初始密码」状态。
export function resetAccountPassword(email) {
  const list = mergedConfig().accounts.map(a => {
    if (normEmail(a.email) !== normEmail(email)) return a;
    const { salt, hash, iterations, passwordUpdatedAt, ...rest } = a;
    return rest;
  });
  writeAccounts(list);
}

export function buildAccountsJSON() {
  const cfg = mergedConfig();
  return JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    note: '由管理后台维护；仅存 PBKDF2-SHA256 加盐摘要，不含明文密码。覆盖仓库 data/accounts.json 并提交后对所有访客生效。',
    initialPassword: cfg.initialPassword,
    accounts: cfg.accounts,
  }, null, 2);
}

export function importAccountsJSON(json) {
  if (!json || !Array.isArray(json.accounts) || !json.initialPassword) throw new Error('缺少 accounts 数组或 initialPassword');
  writeAccounts(json.accounts);
  store.set('initialPasswordLocal', json.initialPassword);
  return json.accounts.length;
}
