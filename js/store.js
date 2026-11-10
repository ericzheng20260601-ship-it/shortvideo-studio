const NS = 'svstudio:';

const SEED = {
  scripts: [
    { id:'s1', title:'配料表只有一行 · 宠物冻干', track:'pet-snack', audience:'养宠新手', style:'专业测评', duration:30,
      hook:'配料表只有一行，我才敢每天给它吃。',
      body:'先看肉源：单一肉源比混合肉粉更好追溯。再看工艺：冻干保留原始风味，适口性更稳。最后看添加：诱食剂、色素、防腐剂能省则省。',
      cta:'截图保存这张配料表清单，下次买直接对。', createdAt:'2026/11/08 10:24' },
    { id:'s2', title:'3 天教会「等一下」 · 正向训练', track:'pet-train', audience:'资深铲屎官', style:'共情叙事', duration:45,
      hook:'别再拽牵引绳了，它只是没听懂。',
      body:'第一步，把「等一下」和一个固定手势绑定，口令只说一次。第二步，安静的那一秒立刻奖励，时机比数量重要。第三步，把等待从 1 秒慢慢拉到 10 秒，别跳级。全程不惩罚，错了就重来。',
      cta:'合集里有第 2 天和第 3 天，按顺序练。', createdAt:'2026/11/09 15:02' },
  ],
  assets: [
    { id:'a1', type:'script', title:'爆款结构 · 拆家救星', track:'pet-chew', text:'钩子：你家狗是不是一转身就把沙发咬了？ / 痛点：拆家焦虑 / 证据：7 天实测对比 / CTA：扣 1 领尺寸表', createdAt:'2026/11/07' },
    { id:'a2', type:'breakdown', title:'结构拆解 · 精简护肤', track:'skincare', text:'反常识开场 → 步骤过载的痛点 → 成分表逐条对比 → 28 天记录 → 主页排班表', createdAt:'2026/11/09' },
  ],
  projects: [
    { id:'p1', name:'磨牙棒 30s 种草片', duration:30, scriptId:'s1', createdAt:'2026/11/09 16:10',
      video:[{id:'v1',label:'开场钩子',start:0,len:5},{id:'v2',label:'主内容',start:5,len:20},{id:'v3',label:'CTA',start:25,len:5}],
      subtitle:[{id:'t1',label:'钩子字幕',start:0,len:5},{id:'t2',label:'要点字幕',start:5,len:20},{id:'t3',label:'CTA 字幕',start:25,len:5}],
      music:[{id:'m1',label:'轻快 BGM',start:0,len:25}],
      fx:[{id:'f1',label:'闪白',start:5,len:1}] },
  ],
  reviews: [
    { id:'rv1', title:'磨牙棒 30s 种草片', score:8.6, createdAt:'2026/11/09 17:40',
      dims:[['钩子吸引力',88],['信息密度',82],['节奏控制',90],['字幕可读性',85],['CTA 明确度',86],['合规与版权',84]],
      advice:['前 3 秒可再提前 0.5 秒给出结果画面','补充一句使用边界（体重对应尺寸）','结尾 CTA 与封面文案保持一致'] },
  ],
  works: [
    { id:'w1', title:'磨牙棒 30s 种草片', track:'pet-chew', createdAt:'2026/11/09' },
    { id:'w2', title:'配料表 15s 快讲', track:'pet-snack', createdAt:'2026/11/08' },
    { id:'w3', title:'等一下 训练合集 01', track:'pet-train', createdAt:'2026/11/07' },
    { id:'w4', title:'皂感香三支对比', track:'fragrance', createdAt:'2026/11/05' },
    { id:'w5', title:'换季屏障修复', track:'skincare', createdAt:'2026/11/03' },
  ],
  autoJobs: [],
  favorites: ['r1','r6'],
  // L-01：达人视频素材默认入库 5 条（爆款雷达中按热度抽取、避开默认收藏 r1/r6）
  creatorClips: ['r2','r3','r4','r8','r5'],
  checklist: {},
  settings: { quoteOffset:0, siteName:'短视频创作台', autoPlay:true },
  logs: [],
  codesDraft: [],
  counters: { exports:0 },
};

function read(key) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}
function write(key, val) {
  try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch (_) {}
  return val;
}

export const store = {
  get(key, def) {
    const v = read(key);
    if (v !== null) return v;
    const seed = SEED[key] !== undefined ? structuredClone(SEED[key]) : undefined;
    const fallback = seed !== undefined ? seed : (def !== undefined ? def : null);
    if (fallback !== null) write(key, fallback);
    return fallback;
  },
  set(key, val) {
    const next = typeof val === 'function' ? val(read(key) ?? store.get(key)) : val;
    return write(key, next);
  },
  add(key, item) { const list = store.get(key, []); list.unshift(item); return write(key, list); },
  remove(key, id) { return write(key, store.get(key, []).filter(x => x.id !== id)); },
  update(key, id, patch) {
    const list = store.get(key, []).map(x => x.id === id ? { ...x, ...patch } : x);
    return write(key, list);
  },
  bump(key, n = 1) {
    const c = store.get('counters', {}); c[key] = (c[key] || 0) + n; return write('counters', c);
  },
  snapshot() {
    const out = { _meta:{ app:'shortvideo-studio', version:1, exportedAt:new Date().toISOString() } };
    for (const k of Object.keys(SEED)) out[k] = read(k) ?? structuredClone(SEED[k]);
    return out;
  },
  restore(json) {
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { throw new Error('文件不是有效的 JSON'); }
    if (!data || typeof data !== 'object') throw new Error('快照内容为空');
    let n = 0;
    for (const k of Object.keys(SEED)) if (data[k] !== undefined) { write(k, data[k]); n++; }
    if (n === 0) throw new Error('快照中没有识别到工作台数据');
    return n;
  },
  resetAll() { for (const k of Object.keys(SEED)) localStorage.removeItem(NS + k); },
  uid(prefix = 'id') { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); },
  now() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
};
