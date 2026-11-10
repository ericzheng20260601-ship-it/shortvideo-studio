'use strict';
const U = require('../lib/util');
const DB = require('../lib/db');
const P = require('../lib/providers');
const A = require('../lib/auth');

const WEIGHTS = { hook: 0.30, structure: 0.22, engagement: 0.20, pace: 0.15, voc: 0.13 };
const NEG = ['别', '不要', '不用', '停止', 'stop', 'never', 'no more'];
const PAIN = ['焦虑', '烂脸', '拆家', '坚持不下', '踩坑', '贵', '留香短', '反复', '乱', '无效'];
const ORAL_BAD = ['因此', '综上所述', '显著', '极具', '赋能', '从而', '换言之'];
const POS = ['好用', '有效', '喜欢', '回购', '推荐', '惊艳', '值', 'love', 'great'];
const NEG_WORDS = ['贵', '没用', '踩雷', '失望', '假', '慢', '差', 'bad', 'fake'];
const VOC_INTENTS = {
  价格: ['多少钱', '价格', '贵', '便宜', '折扣', '券'],
  效果: ['有用', '有效', '效果', '真的吗', '管不管用'],
  质量: ['质量', '材质', '结实', '掉', '断'],
  物流: ['发货', '快递', '几天到', '物流'],
  安全: ['安全', '成分', '过敏', '副作用'],
  复购: ['回购', '再买', '第二次'],
  疑问: ['?', '？', '怎么', '如何', '能不能']
};

function hookScore(text, sec = 3) {
  const t = U.str(text, 1000);
  let s = 30;
  if (/\d/.test(t)) s += 12;
  if (NEG.some(w => t.includes(w))) s += 15;
  if (PAIN.some(w => t.includes(w))) s += 12;
  if (/[?？]/.test(t)) s += 10;
  if (/(但|其实|根本|反而|不是.*而是)/.test(t)) s += 10;
  if (t.length > 0 && t.length <= 60) s += 15;
  if (t.length > 120) s -= 12;
  return U.clamp(s, 0, 100);
}
function structureOf(segments, duration, raw = {}) {
  const end = duration || (segments.at(-1)?.end ?? 30);
  const cuts = [0, 3, Math.min(8, end * 0.3), Math.min(20, end * 0.7), Math.max(0, end - 5), end];
  const labels = ['钩子', '痛点', '演示与证据', '卖点密度', 'CTA'];
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    const a = cuts[i], b = Math.max(a, cuts[i + 1]);
    const text = segments.filter(s => s.start < b && s.end > a).map(s => s.text).join(' ') || [raw.hook, raw.pain, raw.proof, raw.proof, raw.cta][i] || '';
    out.push({ label: labels[i], start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10, text: U.str(text, 600), seconds: Math.round((b - a) * 10) / 10 });
  }
  return out;
}
function sceneCutsOf(segments, duration, structure) {
  const cuts = [];
  structure.forEach((s, i) => cuts.push({ t: s.start, kind: s.label, confidence: i === 0 ? 0.9 : 0.6 }));
  for (const g of segments) if (g.start > 0 && g.start < duration) cuts.push({ t: g.start, kind: '语音切点', confidence: 0.4 });
  return cuts.sort((a, b) => a.t - b.t).filter((c, i, arr) => i === 0 || c.t - arr[i - 1].t > 0.7).slice(0, 30);
}
function visualOf(structure, raw) {
  return structure.map((s, i) => ({
    label: s.label, start: s.start, end: s.end,
    subject: i === 0 ? (raw.product || '主体特写') : (i === 2 ? '使用过程 / 前后对比' : '人物 + 商品'),
    composition: ['中心特写', '过肩中景', '俯拍平铺', '三分构图', '近景 + 字幕'][i % 5],
    camera: ['推镜', '固定机位', '手持跟拍', '快速切换', '定格'][i % 5],
    lighting: i === 0 ? '高对比侧光' : '柔光', rhythm: i === 0 ? '快切 1–2s' : '中速 2–3s',
    note: '本地结构推断，可在报告中手动修订（接入视觉模型后自动填充）'
  }));
}
function vocOf(comments) {
  const list = (comments || []).map(c => U.str(c, 500)).filter(Boolean);
  const intents = {};
  for (const c of list) for (const [k, ws] of Object.entries(VOC_INTENTS)) if (ws.some(w => c.includes(w))) intents[k] = (intents[k] || 0) + 1;
  const words = {};
  for (const c of list) for (const w of c.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' ').split(/\s+/)) if (w.length >= 2) words[w] = (words[w] || 0) + 1;
  const top = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count }));
  const sentiment = { positive: 0, negative: 0, neutral: 0 };
  for (const c of list) {
    if (NEG_WORDS.some(w => c.includes(w))) sentiment.negative++;
    else if (POS.some(w => c.includes(w))) sentiment.positive++;
    else sentiment.neutral++;
  }
  return { count: list.length, intents, top, sentiment, samples: list.slice(0, 8) };
}
function judgeOf(structure, hook, viral) {
  const items = [];
  const quote = t => U.str(t, 60);
  const hookSeg = structure[0] || {};
  if (hook < 65) items.push({ role: '节奏官', level: 'invariant', quote: quote(hookSeg.text), why: '前三秒缺少数字、否定或痛点，划走风险高', fix: '把最反常识的一句挪到 0–3 秒，并加具体数字' });
  if (!/\d/.test(hookSeg.text || '')) items.push({ role: '节奏官', level: 'default', quote: quote(hookSeg.text), why: '钩子没有可验证的数字锚点', fix: '补一个时间/数量/价格数字' });
  const all = structure.map(s => s.text).join('');
  if (ORAL_BAD.some(w => all.includes(w))) items.push({ role: '口语官', level: 'default', quote: ORAL_BAD.find(w => all.includes(w)), why: '书面语不适合口播', fix: '换成「所以 / 说白了 / 其实」' });
  if (!(/(但|其实|反而|结果|没想到)/.test(all))) items.push({ role: '创意官', level: 'taste', quote: quote(structure[2]?.text), why: '缺少反转或意外结果', fix: '在演示段插入一个反预期发现' });
  if (!(structure[4]?.text || '').trim()) items.push({ role: '结构官', level: 'invariant', quote: '（结尾）', why: '缺明确 CTA', fix: '结尾补收藏/评论/购物车单一动作' });
  if (!(structure[2]?.text || '').trim()) items.push({ role: '结构官', level: 'default', quote: '（中段）', why: '缺可验证证据', fix: '补对照实验、时长记录或检测报告' });
  items.push({ role: '画面官', level: 'default', quote: `第 ${Math.min(2, structure.length)} 镜`, why: '未写明这一秒画面里谁在做什么', fix: '为每个分镜补动作描述（主体 + 动作 + 结果）' });
  if (viral >= 80) items.push({ role: '结构官', level: 'taste', quote: `综合 ${viral} 分`, why: '整体结构已完整，可尝试更强的情绪开场', fix: '保留现有骨架，仅替换首句' });
  return { score: Math.max(0, 100 - items.filter(i => i.level !== 'taste').length * 9), items, autoAdopt: items.filter(i => i.level !== 'taste').length };
}
function rewriteOf(structure, raw) {
  const nums = (structure.map(s => s.text).join('').match(/\d+/g) || []);
  const out = structure.map((s, i) => {
    let t = s.text || [raw.hook, raw.pain, raw.proof, raw.proof, raw.cta][i] || '';
    t = t.replace(/因此|综上所述|显著|极具|从而|换言之/g, '说白了');
    if (i === 0 && !NEG.some(w => t.includes(w)) && t) t = `别急着下单，${t}`;
    if (i === 4 && !/(收藏|评论|关注|购物车|点)/.test(t)) t = `${t} 先收藏这张清单，照着做就行。`;
    return { ...s, text: t };
  });
  const joined = out.map(s => s.text).join('');
  const kept = nums.every(n => joined.includes(n));
  return { structure: out, numbersKept: kept, text: out.map(s => s.text).filter(Boolean).join('\n'), note: kept ? '数字事实校验通过' : '数字事实校验未通过，已保留原稿' };
}
function reversePromptOf(structure, visual, raw, product) {
  return [
    `主题：${product || raw.product || '带货短视频'}`,
    `目标：前 3 秒用反常识钩子留住人，${structure.at(-1)?.seconds || 5} 秒收尾给单一 CTA`,
    `结构：${structure.map(s => `${s.label}(${s.seconds}s)`).join(' → ')}`,
    `画面：${visual.map(v => `${v.label}=${v.subject}/${v.composition}/${v.camera}`).join('；')}`,
    `口播约束：口语短句、每段不超过 20 字、必须含 1 个数字、不使用绝对化用语`,
    `负向约束：不要字幕错字、不要空镜超过 1.5 秒、不要多 CTA、不要硬广开场`
  ].join('\n');
}
function computeScores(structure, hook, raw, voc) {
  const structFull = structure.filter(s => (s.text || '').trim()).length / 5;
  const v = Math.max(1, U.int(raw.views));
  const eng = U.clamp((U.int(raw.likes) / v * 8 + U.int(raw.saves) / v * 30 + U.int(raw.comments) / v * 60) / 3, 0, 1);
  const cuts = structure.length;
  const pace = U.clamp(cuts / (Math.max(1, U.int(raw.duration_sec, 30)) / 6), 0, 1);
  const vocScore = voc.count ? U.clamp((voc.sentiment.positive + 0.5 * voc.sentiment.neutral) / voc.count, 0, 1) : 0.5;
  const viral = Math.round(WEIGHTS.hook * hook + WEIGHTS.structure * structFull * 100 + WEIGHTS.engagement * eng * 100 + WEIGHTS.pace * pace * 100 + WEIGHTS.voc * vocScore * 100);
  return { hook, viral: U.clamp(viral, 0, 100), breakdown: { hook, structure: Math.round(structFull * 100), engagement: Math.round(eng * 100), pace: Math.round(pace * 100), voc: Math.round(vocScore * 100) } };
}

async function analyze(ctx, body) {
  const item = body.itemId ? DB.get('SELECT * FROM radar_items WHERE id=?', body.itemId) : null;
  const raw = item ? U.jsonParse(item.raw, {}) : {};
  const title = U.str(body.title || item?.title || '未命名视频', 300);
  const transcriptText = U.str(body.transcript || raw.transcript || [raw.hook, raw.pain, raw.proof, raw.cta].filter(Boolean).join('。'), 20000);
  const asr = await P.transcribe({ audioUrl: body.audioUrl || raw.url, transcriptText, srtText: body.srt || '', language: body.language || 'zh' });
  const duration = U.int(body.duration || item?.duration_sec || (asr.segments.at(-1)?.end ?? 30), 30);
  const structure = structureOf(asr.segments, duration, raw);
  const hookText = structure[0].text || raw.hook || '';
  const hook = hookScore(hookText);
  const scenes = sceneCutsOf(asr.segments, duration, structure);
  const visual = visualOf(structure, raw);
  const voc = vocOf(body.comments || raw.comments_sample || []);
  const scores = computeScores(structure, hook, { ...raw, views: raw.views ?? item?.views, likes: raw.likes ?? item?.likes, saves: raw.saves ?? item?.saves, comments: raw.comments ?? item?.comments, duration_sec: duration }, voc);
  const judge = judgeOf(structure, hook, scores.viral);
  const rewrite = rewriteOf(structure, raw);
  const promptReverse = reversePromptOf(structure, visual, raw, body.product || raw.product);

  let sourceMode = asr.source === 'external' ? 'asr-external' : 'local';
  const llm = await P.chatLLM([
    { role: 'system', content: '你是短视频带货拆解专家。只输出 JSON：{hook_score:number,viral_score:number,judge:{items:[{role,level,quote,why,fix}]},prompt_reverse:string,rewrite:string}。不要编造事实，保留原数字。' },
    { role: 'user', content: `标题：${title}\n逐字稿：${transcriptText.slice(0, 6000)}\n结构：${U.toJson(structure)}\n本地评分：${U.toJson(scores)}` }
  ], { expectJSON: true }).catch(() => null);
  if (llm && typeof llm === 'object') {
    if (Number.isFinite(+llm.hook_score)) scores.hook = U.clamp(+llm.hook_score, 0, 100);
    if (Number.isFinite(+llm.viral_score)) scores.viral = U.clamp(+llm.viral_score, 0, 100);
    if (Array.isArray(llm.judge?.items)) judge.items = llm.judge.items;
    if (llm.prompt_reverse) promptReverse = U.str(llm.prompt_reverse, 5000);
    if (llm.rewrite) rewrite.text = U.str(llm.rewrite, 10000);
    sourceMode = 'llm-external';
  }

  const id = DB.insert('breakdown_reports', {
    user_id: ctx.user.id, project_id: body.projectId || null, item_id: item?.id || null,
    title, url: body.url || item?.url || '', platform: item?.platform || 'tiktok',
    transcript: U.toJson(asr.segments), duration_sec: duration, hook_text: hookText,
    hook_score: scores.hook, viral_score: scores.viral,
    structure_json: U.toJson(structure), scenes_json: U.toJson(scenes), visual_json: U.toJson(visual),
    prompt_reverse: promptReverse, voc_json: U.toJson(voc), judge_json: U.toJson(judge),
    rewrite_text: rewrite.text, source_mode: sourceMode, created_at: U.now()
  });
  A.audit(ctx, 'breakdown.analyze', id, { title, viral: scores.viral, mode: sourceMode });
  return report(id);
}
function report(id) {
  const r = DB.get('SELECT * FROM breakdown_reports WHERE id=?', id);
  if (!r) throw new A.HttpError(404, '报告不存在');
  return {
    id: r.id, title: r.title, url: r.url, platform: r.platform, duration: r.duration_sec,
    itemId: r.item_id, createdAt: r.created_at, sourceMode: r.source_mode,
    hook: { text: r.hook_text, score: r.hook_score }, viralScore: r.viral_score,
    weights: WEIGHTS, transcript: U.jsonParse(r.transcript, []),
    structure: U.jsonParse(r.structure_json, []), scenes: U.jsonParse(r.scenes_json, []),
    visual: U.jsonParse(r.visual_json, []), voc: U.jsonParse(r.voc_json, {}),
    promptReverse: r.prompt_reverse, judge: U.jsonParse(r.judge_json, {}), rewrite: r.rewrite_text
  };
}
function reports({ q = '', minScore = 0, limit = 30 } = {}) {
  let rows = DB.all('SELECT * FROM breakdown_reports ORDER BY created_at DESC LIMIT 200');
  if (q) { const s = U.lower(q); rows = rows.filter(r => [r.title, r.hook_text, r.prompt_reverse, r.transcript].some(v => U.lower(v).includes(s))); }
  if (minScore) rows = rows.filter(r => r.viral_score >= U.int(minScore));
  return rows.slice(0, U.clamp(limit, 1, 100)).map(r => ({
    id: r.id, title: r.title, url: r.url, itemId: r.item_id, hook: r.hook_text,
    hookScore: r.hook_score, viralScore: r.viral_score, duration: r.duration_sec,
    sourceMode: r.source_mode, createdAt: r.created_at,
    breakdown: computeScores([], r.hook_score, {}, { count: 0 }).breakdown
  }));
}
function rerun(ctx, id, kind) {
  const r = report(id);
  if (kind === 'judge') {
    const j = judgeOf(r.structure, r.hook.score, r.viralScore);
    DB.update('breakdown_reports', id, { judge_json: U.toJson(j) });
  } else if (kind === 'rewrite') {
    const raw = r.itemId ? U.jsonParse(DB.get('SELECT raw FROM radar_items WHERE id=?', r.itemId)?.raw, {}) : {};
    const rw = rewriteOf(r.structure, raw);
    DB.update('breakdown_reports', id, { rewrite_text: rw.numbersKept ? rw.text : r.rewrite });
  } else if (kind === 'prompt') {
    DB.update('breakdown_reports', id, { prompt_reverse: reversePromptOf(r.structure, r.visual, {}, '') });
  }
  A.audit(ctx, `breakdown.${kind}`, id, '');
  return report(id);
}

module.exports = { WEIGHTS, hookScore, analyze, report, reports, rerun, judgeOf, rewriteOf, vocOf };
