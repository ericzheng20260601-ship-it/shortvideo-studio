// 云服务公开配置：由 workbuddy_cloud_service 激活时返回的 publicConfig 原样写入。
// publishableKey 只标识应用、不含权限，服务端按 Origin 精确校验；不要在此放任何长期密钥。
export const publicConfig = {
  endpoint: 'https://shortvideo-studio-03074.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_7cAiJ9OOuFoB4fxGwvtovW_vD0ByfJijeHC831MrLFfBcn9aYdhFuMR',
};
