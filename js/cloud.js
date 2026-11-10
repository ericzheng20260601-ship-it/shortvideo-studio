import { publicConfig } from './cloud-config.js';

// C-01：静态备份站（GitHub Pages / 本地预览）不具备云服务 Origin，明确禁用云端能力并提示，
// 不伪造会话、不静默降级成本地存储来冒充已上传。
const host = location.hostname;
export const staticFallback = host.endsWith('github.io') || host === '127.0.0.1' || host === 'localhost';
export const cloudNotice = staticFallback
  ? '当前是静态备份站，云端原视频上传需在 WorkBuddy 发布链接中使用。'
  : '';

let cloud = null;
try {
  const SDK = window.WorkBuddyCloud;
  if (SDK && typeof SDK.createWorkBuddyCloud === 'function' && !staticFallback) {
    cloud = SDK.createWorkBuddyCloud({
      endpoint: publicConfig.endpoint,
      oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
      publishableKey: publicConfig.publishableKey,
    });
  }
} catch (e) {
  console.warn('[cloud] 初始化失败', e?.message || e);
}
export { cloud };
export const cloudEnabled = !!cloud;

let cached = undefined; // undefined = 尚未查询；null = 未登录
export const setCloudSession = s => { cached = s; };
export const getCachedSession = () => cached || null;

export async function getCloudSession() {
  if (!cloud) return null;
  if (cached !== undefined) return cached;
  try {
    const { data, error } = await cloud.auth.getSession();
    cached = error ? null : (data || null);
  } catch (e) { cached = null; }
  return cached;
}

// 页面启动时分发 WorkBuddy 账号 OAuth 回调，必须早于任何路由/授权判断。
export async function restoreCloudAuth() {
  if (!cloud) { cached = null; return null; }
  const url = new URL(location.href);
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    return getCloudSession();
  }
  if (url.searchParams.get('provider') !== 'workbuddy') return getCloudSession();
  const handler = cloud.auth.handleWorkBuddyCallback;
  if (typeof handler !== 'function') {
    console.warn('[cloud] 当前 SDK 缺少 WorkBuddy 登录回调能力');
    return getCloudSession();
  }
  const { data: session, error } = await handler.call(cloud.auth);
  if (error) { console.warn('[cloud] 登录未完成', error.message); cached = null; return null; }
  if (session) {
    for (const k of ['code', 'state', 'provider']) url.searchParams.delete(k);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    cached = session;
    return session;
  }
  return getCloudSession();
}

export async function startCloudLogin() {
  if (!cloud) return { error: new Error(cloudNotice || '云端能力未启用') };
  const back = new URL(location.href);
  back.pathname = '/';
  for (const k of ['code', 'state', 'provider']) back.searchParams.delete(k);
  const { data, error } = await cloud.auth.signInWithOAuth({
    provider: 'workbuddy',
    redirectTo: back.toString(),
  });
  if (error) return { error };
  location.assign(data.url); // 同一标签页，PKCE verifier 存在 sessionStorage
  return {};
}

export async function signOutCloud() {
  if (!cloud) return;
  await cloud.auth.signOut();
  cached = null;
}
