#!/usr/bin/env node
'use strict';
/* CLI 流水线（借鉴 ClipForge 的 bin/clipforge.mjs 命令面）：
 *   node server/cli.mjs <command> [options]
 * Commands:
 *   status   — 服务健康与队列概览
 *   trends   — 每日发现/热搜条目（对应 ClipForge trends）
 *   script   — 生成分镜脚本（对应 ClipForge create 的前半段）
 *   create   — 创建渲染批次并等待完成（对应 ClipForge create）
 *   qc       — 批次成片质检汇总
 *   gate     — 发布闸门：批次完成 + QC 阈值 + 无违禁词，exit 0/1（对应 ClipForge gate）
 *   credits  — 素材署名清单（CC 素材源使用时输出归属）
 *   daily    — 一条命令串完整日更：trends → script → create → qc → gate
 * 配置（环境变量）：
 *   SV_CLI_URL      服务地址，默认 http://127.0.0.1:3310
 *   SV_CLI_EMAIL    登录邮箱（editor 及以上）
 *   SV_CLI_PASSWORD 登录密码
 *   SV_CLI_LANG     配音语言，默认 en-US
 *   SV_CLI_COUNT    生产数量，默认 1
 * 通用选项：--json 输出机器可读 JSON；--wait=N 轮询上限秒（默认 600）
 */
const BASE = process.env.SV_CLI_URL || 'http://127.0.0.1:3310';
const EMAIL = process.env.SV_CLI_EMAIL || '';
const PASSWORD = process.env.SV_CLI_PASSWORD || '';
const LANG = process.env.SV_CLI_LANG || 'en-US';
const COUNT = Math.max(1, parseInt(process.env.SV_CLI_COUNT || '1', 10) || 1);

let TOKEN = '';
const jsonOut = process.argv.includes('--json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

async function api(method, path, body) {
  const resp = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${path} ${String(data.error || text).slice(0, 160)}`);
  return data;
}

async function login() {
  if (!EMAIL || !PASSWORD) throw new Error('缺少 SV_CLI_EMAIL / SV_CLI_PASSWORD 环境变量');
  const r = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  TOKEN = r.token || (r.auth || {}).token || '';
  if (!TOKEN) throw new Error('登录成功但未返回 token，请检查账号权限');
}

const out = (data, human) => { console.log(jsonOut ? JSON.stringify(data, null, 2) : human); };

async function waitBatch(id, maxSec) {
  const deadline = Date.now() + maxSec * 1000;
  for (;;) {
    const b = await api('GET', `/api/remix/batches/${id}`);
    const finished = (b.counts?.done || 0) + (b.counts?.failed || 0) + (b.counts?.blocked || 0);
    if (finished >= b.total || Date.now() > deadline) return b;
    await sleep(3000);
  }
}

const cmds = {
  async status() {
    const [health, status] = await Promise.all([api('GET', '/api/health'), api('GET', '/api/status')]);
    out({ health, status }, `服务 ${health.version} · ffmpeg=${status.render?.source || '?'}(${status.render?.encoder || '?'}) · 队列 进行中 ${status.cron?.queueActive ?? 0} / 排队 ${status.cron?.queueWaiting ?? 0}`);
  },

  async trends() {
    const limit = Math.max(1, parseInt(arg('limit', '5'), 10) || 5);
    const board = await api('GET', `/api/discover/board?limit=${limit}`);
    const items = (board.items || []).slice(0, limit);
    out({ items }, items.length
      ? items.map((i, n) => `${n + 1}. [${i.source || i.platform || '?'}] ${(i.title || '').slice(0, 50)}${i.score != null ? ` · 热度 ${i.score}` : ''}`).join('\n')
      : '今日暂无条目（可在前端「每日发现」手动同步，或配置外部数据源）');
    return items;
  },

  async script() {
    const prompt = arg('prompt', '');
    if (!prompt) throw new Error('缺少 --prompt="视频要讲什么"');
    const plan = await api('POST', '/api/remix/plan', {
      prompt, style: arg('style', '共情叙事'), duration: parseInt(arg('duration', '30'), 10) || 30, lang: LANG
    });
    out({ planId: plan.id, duration: plan.duration, scenes: (plan.scenes || []).length, script: plan.script, sourceMode: plan.sourceMode },
      `分镜 #${plan.id} · ${(plan.scenes || []).length} 镜 / ${plan.duration}s · 来源 ${plan.sourceMode}\n钩子：${plan.script?.hook || ''}\n正文：${plan.script?.body || ''}\nCTA：${plan.script?.cta || ''}`);
    return plan;
  },

  async create() {
    let planId = arg('plan', '');
    if (!planId) { const plan = await cmds.script(); planId = plan.id; }
    const batch = await api('POST', '/api/remix/batches', {
      planId,
      name: arg('name', `CLI ${new Date().toISOString().slice(11, 16)}`),
      hooks: [arg('hook', '反常识')], subtitles: [arg('sub', '简约白')], bgm: ['轻快'],
      durations: [parseInt(arg('duration', '30'), 10) || 30],
      ratios: (arg('ratios', '9:16') || '').split(',').map(s => s.trim()).filter(Boolean),
      voice: LANG, count: parseInt(arg('count', String(COUNT)), 10) || COUNT,
      delogo: ['1', 'true', 'yes'].includes((arg('delogo', '0') || '').toLowerCase())
    });
    const b = await waitBatch(batch.id, parseInt(arg('wait', '600'), 10) || 600);
    const summary = { batchId: b.id, total: b.total, done: b.counts?.done || 0, failed: b.counts?.failed || 0, jobs: (b.jobs || []).map(j => ({ idx: j.idx, status: j.status, qc: j.qc?.score, ratios: j.ratios, output: j.output })) };
    out(summary, `批次 #${b.id}：${summary.done}/${b.total} 完成${summary.failed ? `，${summary.failed} 失败` : ''}`);
    return b;
  },

  async qc() {
    const batchId = arg('batch', '');
    if (!batchId) throw new Error('缺少 --batch=批次ID');
    const b = await api('GET', `/api/remix/batches/${batchId}`);
    const rows = (b.jobs || []).map(j => ({ idx: j.idx, status: j.status, qcScore: j.qc?.score, qcPassed: j.qc?.passed, checks: (j.qc?.checks || []).filter(c => !c.ok).map(c => `${c.name}:${c.detail}`) }));
    const bad = rows.filter(r => r.status === 'failed' || r.qcPassed === false);
    out({ batchId, rows }, rows.map(r => `#${r.idx} ${r.status} QC=${r.qcScore ?? '—'}${r.checks.length ? ' 未过：' + r.checks.join('; ') : ''}`).join('\n') || '无任务');
    if (bad.length) process.exitCode = 2;
    return rows;
  },

  async gate() {
    const batchId = arg('batch', '');
    if (!batchId) throw new Error('缺少 --batch=批次ID');
    const minScore = parseInt(arg('min-score', '60'), 10) || 60;
    const b = await api('GET', `/api/remix/batches/${batchId}`);
    const done = b.counts?.done || 0, failed = b.counts?.failed || 0;
    const scores = (b.jobs || []).filter(j => j.status === 'done').map(j => j.qc?.score || 0);
    const avg = scores.length ? Math.round(scores.reduce((a, c) => a + c, 0) / scores.length) : 0;
    const banned = (b.jobs || []).some(j => (j.qc?.checks || []).some(c => c.name === '违禁词' && !c.ok));
    const pass = failed === 0 && done > 0 && avg >= minScore && !banned;
    const result = { batchId, pass, done, failed, avgQc: avg, minScore, bannedWords: banned, downloadable: done > 0 };
    out(result, pass
      ? `闸门通过：${done} 条成片、平均 QC ${avg} 分、无违禁词 → 可进入发布流程`
      : `闸门拦截：完成 ${done} / 失败 ${failed}、平均 QC ${avg}（阈值 ${minScore}）${banned ? '、命中违禁词' : ''}`);
    if (!pass) process.exitCode = 1;
    return result;
  },

  async credits() {
    const batchId = arg('batch', '');
    if (!batchId) throw new Error('缺少 --batch=批次ID');
    const b = await api('GET', `/api/remix/batches/${batchId}`);
    const cc = [];
    for (const j of b.jobs || []) {
      const d = await api('GET', `/api/remix/jobs/${j.id}`);
      for (const ev of (d.events || [])) if (/CC 素材源/.test(ev.message || '')) cc.push({ job: j.idx, note: ev.message });
    }
    const uniq = [...new Map(cc.map(c => [c.note, c])).values()];
    out({ items: uniq }, uniq.length ? uniq.map(c => `任务 #${c.job}：${c.note}`).join('\n') : '本批次未使用 CC 素材（全部为本地素材或占位画面），无额外署名要求');
    return uniq;
  },

  async daily() {
    const chain = {};
    chain.trends = await cmds.trends();
    const prompt = arg('prompt', '') || `根据今日热点（${(chain.trends[0] || {}).title || '无'}）制作一条 ${LANG} 带货短视频`;
    const plan = await api('POST', '/api/remix/plan', { prompt, style: arg('style', '共情叙事'), duration: parseInt(arg('duration', '30'), 10) || 30, lang: LANG });
    chain.script = { planId: plan.id, scenes: (plan.scenes || []).length };
    const savedArgv = process.argv;
    process.argv = ['cli', '--plan=' + plan.id, `--count=${arg('count', String(COUNT))}`];
    chain.create = await cmds.create();
    process.argv = savedArgv;
    chain.qc = { done: chain.create.counts?.done || 0, failed: chain.create.counts?.failed || 0 };
    process.argv = ['cli', `--batch=${chain.create.id}`];
    chain.gate = await cmds.gate();
    process.argv = savedArgv;
    out(chain, `日更流水线完成：热点 ${chain.trends.length} 条 → 分镜 #${plan.id} → ${chain.qc.done} 条成片 → 闸门${chain.gate.pass ? '通过' : '拦截'}`);
    return chain;
  }
};

(async () => {
  const cmd = process.argv[2];
  if (!cmd || cmd === 'help' || !cmds[cmd]) {
    console.log('用法: node server/cli.mjs <status|trends|script|create|qc|gate|credits|daily> [--key=value] [--json]\n环境变量: SV_CLI_URL / SV_CLI_EMAIL / SV_CLI_PASSWORD / SV_CLI_LANG / SV_CLI_COUNT\n详见文件头注释');
    process.exit(cmd && cmd !== 'help' ? 1 : 0);
  }
  if (cmd !== 'status') await login();
  await cmds[cmd]();
})().catch(e => { console.error(jsonOut ? JSON.stringify({ error: e.message }) : `错误：${e.message}`); process.exit(1); });
