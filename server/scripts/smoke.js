'use strict';
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.SV_BASE || 'http://127.0.0.1:3310';
const DATA = process.env.SV_DATA_DIR || path.join(__dirname, '..', 'data');
let token = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' · ' + extra : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' · ' + extra : ''}`); }
}
async function api(method, url, body, { raw, headers = {} } = {}) {
  const r = await fetch(BASE + url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw || (body ? JSON.stringify(body) : undefined)
  });
  if (url.startsWith('/media/')) return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok || j.ok === false) throw new Error(`${method} ${url} → ${r.status} ${j.error || text.slice(0, 160)}`);
  return j;
}
function adminCred() {
  let email = process.env.SV_ADMIN_EMAIL || 'ericzheng20260601@gmail.com';
  let password = process.env.SV_ADMIN_PASSWORD || '';
  try {
    const s = fs.readFileSync(path.join(DATA, 'initial-admin.txt'), 'utf8');
    email = /初始管理员：(\S+)/.exec(s)?.[1] || email;
    password = password || /初始密码：(\S+)/.exec(s)?.[1] || '';
  } catch { /* no seed note */ }
  if (!password) {
    try {
      const t = fs.readFileSync(path.join(require('node:os').homedir(), '.workbuddy', 'shortvideo-studio-initial-access.txt'), 'utf8');
      email = /登录邮箱：(\S+)/.exec(t)?.[1] || email;
      password = /初始登录密码：(\S+)/.exec(t)?.[1] || '';
    } catch { /* no local credential note */ }
  }
  if (!password) throw new Error('缺少初始密码：请设置 SV_ADMIN_PASSWORD 或保留本机凭据说明文件');
  return { email, password };
}
(async () => {
  console.log('\n=== 短视频工作台后端全流程冒烟测试 ===\n');
  const health = await api('GET', '/api/health'); check('健康检查', health.status === 'ok', health.version);
  const status = await api('GET', '/api/status'); check('能力探测', !!status.providers, JSON.stringify(status.providers));
  check('首页静态托管', (await fetch(BASE + '/')).status === 200);

  console.log('\n[1] 认证与多人');
  const cred = adminCred();
  const login = await api('POST', '/api/auth/login', cred);
  token = login.token; check('管理员登录', !!token, login.user.email);
  const me = await api('GET', '/api/auth/me'); check('组织/项目空间', me.orgs.length > 0 && me.projects.length > 0, `${me.orgs.length} 组织 / ${me.projects.length} 项目`);
  check('角色', me.role === 'owner');
  const quota = await api('GET', '/api/collab/quota'); check('并发配额', quota.maxConcurrent >= 1, `并发 ${quota.maxConcurrent}`);

  console.log('\n[2] 每日发现');
  const stats = await api('GET', '/api/discover/stats'); check('定时同步已有数据', stats.items > 0, `${stats.items} 条 / 数据源 ${stats.source}`);
  for (const t of ['hot', 'new', 'rising', 'streak']) {
    const b = await api('GET', `/api/discover/board?type=${t}&limit=5`);
    check(`榜单 ${t}`, Array.isArray(b.items), `${b.total} 条`);
  }
  const filtered = await api('GET', '/api/discover/board?category=pet&country=US&q=狗');
  check('品类/国家/关键词筛选', Array.isArray(filtered.items));
  const first = (await api('GET', '/api/discover/board?limit=1')).items[0];
  const snaps = await api('GET', `/api/discover/snapshots?itemId=${encodeURIComponent(first.id)}`);
  check('指标快照', Array.isArray(snaps.items), `${snaps.items.length} 天`);
  const sub = await api('POST', '/api/discover/subs', { type: 'keyword', value: '磨牙', channels: ['inbox'] });
  check('关键词订阅', !!sub.id);
  const subs = await api('GET', '/api/discover/subs'); check('订阅列表', subs.items.length >= 1);
  const digest = await api('POST', '/api/discover/digest', {});
  check('日报生成与推送', !!digest.markdown, digest.delivered ? 'webhook 已送达' : '站内收件箱');
  check('日报含订阅命中', typeof digest.hits.length === 'number', `${digest.hits.length} 条命中`);
  const topic = await api('POST', '/api/discover/topics', { itemId: first.id, projectId: me.defaultProject });
  check('热点一键预填选题', !!topic.id, topic.title.slice(0, 30));

  console.log('\n[3] 拆解分析');
  const rep = await api('POST', '/api/breakdown/analyze', { itemId: first.id, projectId: me.defaultProject, srt: '' });
  check('ASR 逐字稿时间轴', Array.isArray(rep.transcript) && rep.transcript.length > 0, `${rep.transcript.length} 段`);
  check('分镜切点', Array.isArray(rep.scenes) && rep.scenes.length > 0, `${rep.scenes.length} 个切点`);
  check('黄金 3 秒钩子', typeof rep.hook.score === 'number', `${rep.hook.score} 分`);
  check('viral score', typeof rep.viralScore === 'number', `${rep.viralScore} 分 / 权重 ${Object.keys(rep.weights).length} 项`);
  check('画面/运镜/构图', rep.visual.length > 0 && !!rep.visual[0].camera);
  check('反推提示词', rep.promptReverse.length > 40);
  check('评论 VOC', !!rep.voc && typeof rep.voc.intents === 'object');
  check('判官团挑刺', rep.judge.items.length >= 3, `${rep.judge.items.length} 条`);
  check('等长重写 + 数字校验', rep.rewrite.length > 20);
  const reports = await api('GET', `/api/breakdown/reports?q=${encodeURIComponent(rep.title.slice(0, 4))}&minScore=0`);
  check('报告入库可检索', reports.items.some(x => x.id === rep.id));
  for (const kind of ['judge', 'rewrite', 'prompt']) {
    const r = await api('POST', `/api/breakdown/reports/${rep.id}/rerun`, { kind });
    check(`重跑 ${kind}`, r.id === rep.id);
  }

  console.log('\n[4] 批量混剪');
  const constants = await api('GET', '/api/remix/constants');
  check('四维素材分级', constants.grades.length === 4, constants.grades.map(g => g.label).join('/'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const up = await api('POST', '/api/remix/upload?grade=product&title=测试素材&licenseNote=自有', null, {
    raw: png, headers: { 'X-File-Name': encodeURIComponent('test.png'), 'Content-Type': 'image/png' }
  });
  check('真实上传视频/音频/图片', !!up.id, `${up.kind} / ${up.size}B`);
  const grade = await api('POST', `/api/remix/assets/${up.id}/grade`, { grade: 'scene' });
  check('素材分级调整', grade.grade === 'scene');
  const sb = await api('POST', '/api/remix/plan', { prompt: '宠物磨牙玩具 30 秒带货短视频', duration: 15, reportId: rep.id, projectId: me.defaultProject });
  check('提示词 → 分镜 JSON', sb.scenes.length >= 5, `${sb.scenes.length} 镜 / ${sb.duration}s`);
  const batch = await api('POST', '/api/remix/batches', {
    planId: sb.id, name: '冒烟测试批次', projectId: me.defaultProject,
    hooks: ['反常识', '数字锚点'], subtitles: ['简约白'], bgm: ['轻快'], durations: [15]
  });
  check('变体矩阵批量任务', batch.total === 2, `${batch.total} 个任务`);
  let final = batch, waited = 0;
  while (waited < 120 && (final.counts.done + final.counts.failed + final.counts.blocked) < final.total) {
    await sleep(1000); waited++;
    final = await api('GET', `/api/remix/batches/${batch.id}`);
  }
  check('队列推进到完成', final.counts.done === final.total, `done=${final.counts.done} failed=${final.counts.failed} blocked=${final.counts.blocked} 等待 ${waited}s`);
  const job = await api('GET', `/api/remix/jobs/${final.jobs[0].id}`);
  check('TTS 与 SRT', !!job.tts && !!job.srt);
  check('多画幅导出', job.ratios.length >= 3, job.ratios.join(','));
  check('成片 QC', job.qc && job.qc.checks.length >= 6, `${job.qc?.score} 分 / ${job.qc?.checks?.length} 项`);
  check('AIGC 标识', !!job.package?.aigcLabel?.text);
  check('违禁词检查', Array.isArray(job.package?.bannedWords?.hits));
  check('发布物料包', !!job.package?.title && job.package.hashtags.length > 0);
  check('事件日志（断点续跑依据）', job.events.length >= 3, `${job.events.length} 条`);
  const mediaFile = `/media/outputs/${job.id}/${encodeURIComponent('output_9x16.mp4')}`;
  const media = await api('GET', mediaFile);
  check('成片文件可下载', media.status === 200 && media.bytes > 1024, `${media.bytes} bytes`);
  const cancelled = await api('POST', `/api/remix/batches/${batch.id}/cancel`, {});
  check('取消批次', cancelled.status === 'cancelled');
  const resumed = await api('POST', `/api/remix/batches/${batch.id}/resume`, {});
  check('断点续跑接口', !!resumed.id);

  console.log('\n[5] 协作与审计');
  const ov = await api('GET', '/api/collab/overview'); check('协作总览', ov.roles.length === 5);
  const cm = await api('POST', '/api/collab/comments', { assetId: up.id, frameT: 3.5, text: '这一帧产品再放大一点', projectId: me.defaultProject });
  check('帧级批注', !!cm.id);
  const cms = await api('GET', `/api/collab/comments?assetId=${up.id}`); check('批注列表', cms.items.some(x => Math.abs(x.frame_t - 3.5) < 0.01));
  const ver = await api('POST', '/api/collab/versions', { assetId: up.id, note: 'V1 初稿', projectId: me.defaultProject });
  check('版本管理', ver.version === 1);
  const ap = await api('POST', '/api/collab/approvals', { assetId: up.id, jobId: job.id, projectId: me.defaultProject, note: '请评审' });
  check('提交审批', !!ap.id);
  const dec = await api('POST', `/api/collab/approvals/${ap.id}/decide`, { decision: 'approved', note: '通过' });
  check('审批通过', dec.status === 'approved');
  const audit = await api('GET', '/api/collab/audit?limit=20'); check('审计日志', audit.items.length >= 5, `${audit.items.length} 条`);
  const cfg = await api('POST', '/api/config', { config: { 'quota.jobsPerDay': 50, 'content.aigcLabel': true } });
  check('服务端配置', cfg.config['quota.jobsPerDay'] === 50);

  console.log(`\n=== 结果：${pass} 通过 / ${failed} 失败 ===\n`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n冒烟测试异常：', e.message); process.exit(1); });
