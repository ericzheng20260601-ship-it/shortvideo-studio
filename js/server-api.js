// 云服务器 API 客户端：同源 /api/*，静态备份站自动降级
const KEY = 'svstudio:serverToken';

const state = { available: false, checked: false, me: null, providers: null, cron: null, lastError: '' };
let token = localStorage.getItem(KEY) || '';

export const svState = () => ({ ...state });
export const svAvailable = () => state.available;
export const svMe = () => state.me;
export const svToken = () => token;

async function raw(method, path, body, { binary, headers = {}, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(path, {
      method, credentials: 'same-origin',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body && !binary ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: binary ? body : (body !== undefined && body !== null ? JSON.stringify(body) : undefined),
      signal: ctrl.signal
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok || data.ok === false) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

export async function svBoot() {
  try {
    const s = await raw('GET', '/api/status', undefined, { timeout: 2500 });
    state.available = true; state.providers = s.providers || null; state.cron = s.cron || null;
  } catch (e) {
    state.available = false; state.lastError = e.message;
  }
  if (state.available) {
    try { const me = await raw('GET', '/api/auth/me', undefined, { timeout: 2500 }); state.me = me; }
    catch { state.me = null; }
  }
  state.checked = true;
  return svState();
}

export async function svLogin(email, password) {
  if (!state.available) return { ok: false, reason: 'offline' };
  try {
    const r = await raw('POST', '/api/auth/login', { email, password });
    token = r.token || '';
    if (token) localStorage.setItem(KEY, token);
    state.me = await raw('GET', '/api/auth/me');
    return { ok: true, user: r.user };
  } catch (e) { return { ok: false, reason: e.message }; }
}
export async function svLogout() {
  try { if (state.available) await raw('POST', '/api/auth/logout', {}); } catch { /* ignore */ }
  token = ''; localStorage.removeItem(KEY); state.me = null;
}
export async function api(method, path, body, opts) {
  if (!state.available) throw new Error('云服务器未连接');
  return raw(method, path, body, opts);
}
export const get = (p, q = {}) => {
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '' && v != null)).toString();
  return api('GET', s ? `${p}?${s}` : p);
};
export const post = (p, body = {}) => api('POST', p, body);
export const del = p => api('DELETE', p);
export const upload = (p, file) => api('POST', p, file, { binary: true, headers: { 'X-File-Name': encodeURIComponent(file.name) }, timeout: 120000 });
export const mediaURL = (jobId, file) => `/media/outputs/${encodeURIComponent(jobId)}/${encodeURIComponent(file)}`;
export const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n ?? 0);
