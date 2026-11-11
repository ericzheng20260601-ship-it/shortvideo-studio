// 云服务器工作台面板：每日发现 / 拆解 / 批量混剪 / 多人协作 / 服务端管理
import { $, $$, esc, toast, modal, fmtNum } from './ui.js';
import { svState, svMe, get, post, del, upload, mediaURL, fmt } from './server-api.js';

let pollTimer = null;
let activePanel = '';
export function stopConsolePolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

const TITLES = {
  home: ['云服务器总览', '每日发现 · 拆解 · 混剪 · 协作'],
  radar: ['每日爆款发现', '定时同步 · 指标快照 · 榜单 · 订阅 · 日报 · 选题'],
  breakdown: ['视频拆解分析', 'ASR 时间轴 · 分镜 · 钩子 · viral score · VOC · 判官团'],
  auto: ['提示词批量混剪', '四维分级 · 分镜 JSON · 变体矩阵 · 队列 · 成片 QC · 物料包'],
  library: ['团队协作空间', '共享素材 · 帧级批注 · 版本 · 审批 · 审计'],
  admin: ['云服务器管理', '数据源 · 模型 · 推送 · 调度 · 成员 · 配额 · 审计']
};
const badge = (text, tone = '') => `<span class="sv-badge ${tone}">${esc(text)}</span>`;
function shell(title, sub, badges, body) {
  return `<div class="sv-head"><div><div class="sv-title">${esc(title)}</div><div class="sv-sub">${esc(sub)}</div></div>
    <div class="sv-badges">${badges}</div><button class="btn btn-sm" data-act="toggle">收起</button></div>
    <div class="sv-body">${body}</div>`;
}
function offline(st) {
  return shell(TITLES.radar[0], TITLES.radar[1], badge('云服务器离线', 'amber'),
    `<div class="sv-notice"><b>当前是静态备份站，云端能力不可用。</b><br>
      每日同步、真实拆解、ffmpeg 混剪与多人协作需要启动后端服务。在云服务器上执行：<br>
      <code>cd server &amp;&amp; npm start</code>（或 <code>docker compose up -d</code>），然后通过该服务的地址访问本工作台。<br>
      <span class="muted">探测结果：${esc(st.lastError || '未检测到 /api/status')}</span></div>`);
}
function needLogin(st) {
  const p = st.providers || {};
  return shell('云服务器已连接', '请用服务端账号登录后使用云端能力',
    [badge('数据源 ' + (p.data || '—')), badge('渲染 ' + (p.render || '—'))],
    `<div class="sv-notice"><b>后端服务在线，但尚未登录服务端账号。</b><br>
      请退出当前会话并重新登录，登录时会自动同步服务端身份；或确认浏览器允许同源 Cookie。<br>
      <span class="muted">本地页面功能不受影响。</span></div>`);
}
function setBody(el, html) { const b = $('.sv-body', el); if (b) b.innerHTML = html; }
let activeHandler = null;
function hook(el, handler) {
  activeHandler = handler;
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    await handler(t.dataset.act, t, e);
  });
}
// 弹窗挂载在 #modal-root（面板 DOM 之外），用文档级委托把 data-act 交回当前面板处理器
if (!globalThis.__svModalHookBound) {
  globalThis.__svModalHookBound = true;
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]');
    if (!t || !t.closest('.modal') || !activeHandler) return;
    await activeHandler(t.dataset.act, t, e);
  });
}
async function act(fn, msg) {
  try { const r = await fn(); if (msg) toast(msg, typeof r === 'object' && r?.name ? r.name : ''); return r; }
  catch (e) { toast('操作失败', e.message, 'error'); return null; }
}
const val = (el, sel) => ($(sel, el)?.value || '').trim();

/* 邀请制开通：管理员创建 / 重置成员后，把「固定链接 + 邮箱 + 一次性初始密码」
   打包成可复制的文本。成员拿到链接就能在任意浏览器登录并上传、混剪、下载成片。 */
function inviteText({ email, password, role, url }) {
  return [
    '短视频工作台 · 邀请',
    `访问链接：${url}`,
    `登录邮箱：${email}`,
    `初始密码：${password}`,
    `角色：${role || '创作者（editor）'}`,
    '',
    '打开链接后用上面的邮箱与初始密码登录；首次登录请在右上角头像 → 账户信息 → 修改密码。',
    '本消息含一次性凭据，请仅发给本人，不要转发或贴到公开群。'
  ].join('\n');
}
function showInvite(info) {
  const text = inviteText(info);
  modal({
    title: '邀请信息（仅显示一次）',
    desc: `已为 ${info.email} 开通账号，请立即复制并私发给本人`,
    wide: true,
    body: `<div class="sv-notice"><b>初始密码只在创建 / 重置时返回一次</b>：服务端只保存 PBKDF2 摘要，之后无法找回，只能再次重置。<br>
      当前访问链接：<span class="mono">${esc(info.url)}</span><br>成员无需安装任何软件，浏览器打开即可进行视频生产。</div>
      <textarea id="svInviteText" class="sv-input" rows="9" readonly>${esc(text)}</textarea>`,
    actions: [
      { label: '复制邀请信息', primary: true, close: false, onClick: async () => {
        const ta = document.getElementById('svInviteText');
        try { await navigator.clipboard.writeText(text); }
        catch { try { ta?.select(); document.execCommand('copy'); } catch { /* 手动复制 */ } }
        toast('已复制', '把邀请信息私发给成员即可');
        return false;
      } },
      { label: '我已保存，关闭' }
    ]
  });
}
const num = (el, sel, d = 0) => Number($(sel, el)?.value) || d;
const tbl = (cols, rows, emptyText = '暂无数据') => rows.length
  ? `<div class="sv-table-wrap"><table class="sv-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : `<div class="sv-empty">${esc(emptyText)}</div>`;
function wrap(el, st, page) {
  const [t, s] = TITLES[page];
  const p = st.providers || {};
  const badges = [badge('数据源 ' + (p.data === 'demo' ? '演示' : p.data === 'external' ? '第三方 API' : p.data || '—'), p.data === 'demo' ? 'amber' : 'green'),
    badge('模型 ' + (p.llm === 'local' ? '本地规则' : '外部 LLM')),
    badge('渲染 ' + (p.render === 'ffmpeg' ? 'ffmpeg 就绪' : '缺失'), p.render === 'ffmpeg' ? 'green' : 'amber'),
    badge((svMe()?.role || '') + '')];
  el.innerHTML = shell(t, s, badges, '<div class="sv-loading">正在加载云端数据…</div>');
  const toggle = $('[data-act="toggle"]', el);
  if (toggle) toggle.onclick = () => { const b = $('.sv-body', el); b.hidden = !b.hidden; toggle.textContent = b.hidden ? '展开' : '收起'; };
}

/* ==================== 首页总览 ==================== */
async function homePanel(el, st) {
  wrap(el, st, 'home');
  const [stats, batches, ov] = await Promise.all([
    get('/api/discover/stats').catch(() => null),
    get('/api/remix/batches').catch(() => ({ items: [] })),
    get('/api/collab/overview').catch(() => null)
  ]);
  const cards = [
    ['每日爆款', stats ? `${stats.todayItems} 条` : '—', stats ? `最近同步 ${stats.lastSyncDay || '未同步'}` : '—', '#/radar'],
    ['拆解报告', '报告库', '按钩子与 viral score 检索', '#/breakdown'],
    ['混剪批次', batches.items.length + ' 个', `进行中 ${batches.items.filter(b => b.status === 'running').length} 个`, '#/auto'],
    ['团队配额', ov ? `${ov.quota.jobs}/${ov.quota.jobsLimit < 0 ? '∞' : ov.quota.jobsLimit}` : '—', ov ? `角色 ${ov.quota.roleLabel}` : '—', '#/library']
  ];
  setBody(el, `<div class="sv-cards">${cards.map(c => `<button class="sv-stat" data-act="go" data-hash="${c[3]}"><b>${esc(c[1])}</b><span>${esc(c[0])}</span><small>${esc(c[2])}</small></button>`).join('')}</div>
    <div class="sv-note">数据源为 ${esc(stats?.source === 'demo' ? '内置演示数据（未配置第三方数据 API）' : '第三方合规数据 API')}；真实爆款指标需在「管理后台 → 云服务器管理」配置数据源。</div>`);
  hook(el, async (a, t) => { if (a === 'go') location.hash = t.dataset.hash; });
}

/* ==================== 每日发现 ==================== */
async function radarPanel(el, st) {
  wrap(el, st, 'radar');
  const stats = await get('/api/discover/stats').catch(() => ({ categories: [], countries: [] }));
  const cats = stats.categories || [], countries = stats.countries || [];
  setBody(el, `
    <div class="sv-toolbar">
      <div class="sv-tabs">${[['hot', '热榜'], ['new', '新上榜'], ['rising', '飙升'], ['streak', '连续在榜']].map(([k, l]) => `<button data-act="tab" data-type="${k}" class="${k === 'hot' ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="svCat"><option value="">全部品类</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      <select id="svCountry"><option value="">全部国家</option>${countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      <input id="svQ" placeholder="关键词 / 竞对 / 商品" />
      <button class="btn btn-sm" data-act="refresh">刷新</button>
      <button class="btn btn-sm btn-primary" data-act="sync">立即同步</button>
      <button class="btn btn-sm" data-act="digest">生成日报</button>
    </div>
    <div id="svBoard" class="sv-loading">加载榜单…</div>
    <div class="sv-grid2">
      <div class="sv-sub"><h4>竞对 / 关键词订阅</h4>
        <div class="sv-form"><select id="svSubType"><option value="keyword">关键词</option><option value="competitor">竞对达人</option><option value="hashtag">话题标签</option></select>
        <input id="svSubValue" placeholder="例：磨牙 / @petlab" /><button class="btn btn-sm btn-primary" data-act="sub-add">添加</button></div>
        <div id="svSubs"></div></div>
      <div class="sv-sub"><h4>日报与选题</h4>
        <div id="svDigests"></div><div id="svTopics"></div></div>
    </div>`);
  const state = { type: 'hot' };
  async function loadBoard() {
    const box = $('#svBoard', el); box.className = 'sv-loading'; box.textContent = '加载榜单…';
    const r = await get('/api/discover/board', { type: state.type, category: val(el, '#svCat'), country: val(el, '#svCountry'), q: val(el, '#svQ'), limit: 20 }).catch(e => ({ items: [], total: 0, error: e.message }));
    const rows = (r.items || []).map(x => `<tr>
      <td>${x.rank || '—'}</td><td><b>${esc(x.title)}</b><div class="sv-mini">${esc(x.author)} · ${esc(x.product || '')} · ${esc(x.platform)}</div></td>
      <td>${esc(x.category)}<div class="sv-mini">${esc(x.country)}</div></td><td>${fmt(x.views)}<div class="sv-mini">赞 ${fmt(x.likes)}</div></td>
      <td>${x.isNew ? '<span class="sv-tag green">新</span>' : ''}${x.growth > 0 ? `<span class="sv-tag blue">+${x.growth}%</span>` : ''}${x.streak >= 2 ? `<span class="sv-tag amber">${x.streak} 天</span>` : ''}</td>
      <td><b>${x.heat}</b></td>
      <td class="sv-ops"><button class="btn btn-sm" data-act="analyze" data-id="${esc(x.id)}" data-title="${esc(x.title)}">拆解</button>
      <button class="btn btn-sm" data-act="topic" data-id="${esc(x.id)}">选题</button>
      <button class="btn btn-sm" data-act="snap" data-id="${esc(x.id)}">快照</button></td></tr>`);
    box.className = ''; box.innerHTML = tbl(['#', '视频', '品类 / 国家', '播放', '标记', '热度', '操作'], rows,
      state.type === 'rising' || state.type === 'streak' ? '该榜单需连续 2 天以上同步与快照，明天再来看' : '当前筛选下没有数据')
      + (r.error ? `<div class="sv-note">${esc(r.error)}</div>` : '')
      + `<div class="sv-note">共 ${r.total || 0} 条 · 快照日 ${esc(r.day || '')} · 热度为可复算加权分（播放/互动/转化/新鲜度）</div>`;
  }
  async function loadSubs() {
    const r = await get('/api/discover/subs').catch(() => ({ items: [] }));
    $('#svSubs', el).innerHTML = tbl(['类型', '内容', '状态', '操作'], (r.items || []).map(s => `<tr>
      <td>${esc(s.type)}</td><td>${esc(s.value)}</td><td>${s.enabled ? '启用' : '停用'}</td>
      <td class="sv-ops"><button class="btn btn-sm" data-act="sub-toggle" data-id="${esc(s.id)}" data-on="${s.enabled ? 0 : 1}">${s.enabled ? '停用' : '启用'}</button>
      <button class="btn btn-sm" data-act="sub-del" data-id="${esc(s.id)}">删除</button></td></tr>`), '还没有订阅');
  }
  async function loadDigests() {
    const [d, t] = await Promise.all([get('/api/discover/digests').catch(() => ({ items: [] })), get('/api/discover/topics').catch(() => ({ items: [] }))]);
    $('#svDigests', el).innerHTML = `<div class="sv-mini">日报推送（${esc((st.providers || {}).push === 'webhook' ? 'Webhook' : '站内收件箱')}）</div>` +
      tbl(['日期', '渠道', '状态', ''], (d.items || []).slice(0, 5).map(x => `<tr><td>${esc(x.day)}</td><td>${esc(x.channel)}</td><td>${esc(x.status)}</td>
        <td><button class="btn btn-sm" data-act="digest-view" data-id="${esc(x.id)}">查看</button></td></tr>`), '暂无日报');
    $('#svTopics', el).innerHTML = `<div class="sv-mini" style="margin-top:10px">热点预填选题</div>` +
      tbl(['选题', '来源', '状态'], (t.items || []).slice(0, 6).map(x => `<tr><td>${esc(x.title)}</td><td>${esc(x.category || '—')}</td><td>${esc(x.status)}</td></tr>`), '暂无选题');
  }
  await Promise.all([loadBoard(), loadSubs(), loadDigests()]);
  hook(el, async (a, t) => {
    if (a === 'tab') { $$('.sv-tabs button', el).forEach(b => b.classList.remove('on')); t.classList.add('on'); state.type = t.dataset.type; await loadBoard(); }
    else if (a === 'refresh') await loadBoard();
    else if (a === 'sync') { const r = await act(() => post('/api/discover/sync'), '同步完成'); if (r) { await loadBoard(); await loadDigests(); } }
    else if (a === 'digest') { const r = await act(() => post('/api/discover/digest'), '日报已生成'); if (r) modal({ title: '每日爆款日报', desc: r.delivered ? '已推送到 Webhook' : '已存入站内收件箱', wide: true, body: `<pre class="sv-pre">${esc(r.markdown || '')}</pre>` }); }
    else if (a === 'digest-view') { const r = await act(() => get('/api/discover/digests/' + t.dataset.id)); if (r) modal({ title: '日报详情', desc: r.day, wide: true, body: `<pre class="sv-pre">${esc(r.payload?.markdown || '')}</pre>` }); }
    else if (a === 'sub-add') { const v = val(el, '#svSubValue'); if (!v) return toast('请填写订阅内容', '', 'warn'); await act(() => post('/api/discover/subs', { type: val(el, '#svSubType'), value: v, channels: ['inbox'] }), '订阅已添加'); $('#svSubValue', el).value = ''; await loadSubs(); }
    else if (a === 'sub-toggle') { await act(() => post('/api/discover/subs/' + t.dataset.id + '/toggle', { enabled: Number(t.dataset.on) === 1 })); await loadSubs(); }
    else if (a === 'sub-del') { await act(() => del('/api/discover/subs/' + t.dataset.id), '订阅已删除'); await loadSubs(); }
    else if (a === 'topic') { await act(() => post('/api/discover/topics', { itemId: t.dataset.id }), '已生成选题'); await loadDigests(); }
    else if (a === 'analyze') { sessionStorage.setItem('sv.pendingItem', t.dataset.id); location.hash = '#/breakdown'; }
    else if (a === 'snap') { const r = await act(() => get('/api/discover/snapshots', { itemId: t.dataset.id })); if (r) modal({ title: '指标快照', desc: '每日定时同步留下的历史指标', wide: true, body: tbl(['日期', '播放', '点赞', '收藏', '排名', '热度'], (r.items || []).map(s => `<tr><td>${esc(s.day)}</td><td>${fmt(s.views)}</td><td>${fmt(s.likes)}</td><td>${fmt(s.saves)}</td><td>${s.rank || '—'}</td><td>${s.heat}</td></tr>`), '暂无快照') }); }
  });
}

/* ==================== 拆解分析 ==================== */
async function breakdownPanel(el, st) {
  wrap(el, st, 'breakdown');
  const board = await get('/api/discover/board', { limit: 40 }).catch(() => ({ items: [] }));
  const pending = sessionStorage.getItem('sv.pendingItem') || '';
  setBody(el, `
    <div class="sv-toolbar">
      <select id="svItem" style="max-width:340px"><option value="">选择榜单视频…</option>${(board.items || []).map(x => `<option value="${esc(x.id)}" ${x.id === pending ? 'selected' : ''}>${esc(x.title.slice(0, 34))}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" data-act="analyze">生成拆解报告</button>
      <button class="btn btn-sm" data-act="custom">粘贴逐字稿 / SRT</button>
      <input id="svRq" placeholder="检索报告" style="max-width:160px" />
      <input id="svRmin" type="number" min="0" max="100" value="0" style="max-width:74px" title="最低 viral score" />
      <button class="btn btn-sm" data-act="search">检索</button>
    </div>
    <div id="svReport" class="sv-empty">选择一条爆款视频，生成含逐字稿、分镜、钩子评分、VOC 与判官团意见的拆解报告。</div>
    <div class="sv-sub" style="margin-top:14px"><h4>拆解报告库（可检索）</h4><div id="svReports"></div></div>`);
  let current = null;
  function renderReport(r) {
    current = r;
    const w = r.weights || {};
    const rows = (r.structure || []).map(s => `<tr><td>${esc(s.label)}</td><td>${s.start}–${s.end}s</td><td>${esc(s.text || '—')}</td></tr>`);
    const visuals = (r.visual || []).map(v => `<tr><td>${esc(v.label)}</td><td>${esc(v.subject)}</td><td>${esc(v.composition)}</td><td>${esc(v.camera)}</td><td>${esc(v.rhythm)}</td></tr>`);
    const judge = (r.judge?.items || []).map(j => `<div class="sv-judge ${esc(j.level)}"><b>${esc(j.role)}</b><span class="sv-tag ${j.level === 'invariant' ? 'rose' : j.level === 'default' ? 'amber' : ''}">${esc(j.level)}</span>
      <div>${esc(j.why)}</div><div class="sv-mini">引用：${esc(j.quote)} · 建议：${esc(j.fix)}</div></div>`).join('');
    $('#svReport', el).className = '';
    $('#svReport', el).innerHTML = `
      <div class="sv-cards sv-cards-3">
        <div class="sv-stat"><b>${r.viralScore}</b><span>viral score</span><small>权重 ${Object.keys(w).length} 项可复算</small></div>
        <div class="sv-stat"><b>${r.hook?.score ?? 0}</b><span>黄金 3 秒钩子</span><small>${esc((r.hook?.text || '').slice(0, 28))}</small></div>
        <div class="sv-stat"><b>${(r.transcript || []).length}</b><span>逐字稿片段</span><small>${(r.scenes || []).length} 个分镜切点 · ${r.duration}s</small></div>
      </div>
      <div class="sv-grid2">
        <div class="sv-sub"><h4>结构分段</h4>${tbl(['段落', '时间', '文本'], rows)}</div>
        <div class="sv-sub"><h4>画面 / 运镜 / 构图</h4>${tbl(['镜', '主体', '构图', '运镜', '节奏'], visuals)}</div>
      </div>
      <div class="sv-grid2" style="margin-top:12px">
        <div class="sv-sub"><h4>ASR 逐字稿时间轴 <span class="sv-mini">${esc(r.sourceMode)}</span></h4>
          <div class="sv-scroll">${(r.transcript || []).map(s => `<div class="sv-line"><span>${s.start.toFixed(1)}s</span>${esc(s.text)}</div>`).join('') || '<div class="sv-empty">无逐字稿</div>'}</div></div>
        <div class="sv-sub"><h4>评论 VOC</h4>
          <div class="sv-mini">样本 ${r.voc?.count || 0} 条 · 意图 ${Object.keys(r.voc?.intents || {}).length} 类 · 情感 ${JSON.stringify(r.voc?.sentiment || {})}</div>
          <div class="sv-chips">${(r.voc?.top || []).slice(0, 10).map(w => `<span class="sv-chip">${esc(w.word)} ×${w.count}</span>`).join('') || '暂无高频词'}</div>
          <h4 style="margin-top:12px">反推提示词</h4><pre class="sv-pre">${esc(r.promptReverse || '')}</pre>
          <button class="btn btn-sm" data-act="to-remix" style="margin-top:8px">送去批量混剪</button></div>
      </div>
      <div class="sv-sub" style="margin-top:12px"><h4>脚本判官团 <span class="sv-mini">${r.judge?.autoAdopt ?? 0} 条可自动采纳</span></h4>${judge || '<div class="sv-empty">暂无意见</div>'}
        <div class="sv-form" style="margin-top:10px"><button class="btn btn-sm" data-act="rerun" data-kind="judge">重跑判官</button>
        <button class="btn btn-sm" data-act="rerun" data-kind="rewrite">重新改写</button>
        <button class="btn btn-sm" data-act="rerun" data-kind="prompt">重推提示词</button></div></div>
      <div class="sv-sub" style="margin-top:12px"><h4>等长重写稿（数字事实校验）</h4><pre class="sv-pre">${esc(r.rewrite || '')}</pre></div>`;
  }
  async function loadReports() {
    const r = await get('/api/breakdown/reports', { q: val(el, '#svRq'), minScore: num(el, '#svRmin'), limit: 20 }).catch(() => ({ items: [] }));
    $('#svReports', el).innerHTML = tbl(['报告', '钩子分', 'viral', '模式', ''], (r.items || []).map(x => `<tr>
      <td>${esc(x.title.slice(0, 40))}</td><td>${x.hookScore}</td><td><b>${x.viralScore}</b></td><td>${esc(x.sourceMode)}</td>
      <td><button class="btn btn-sm" data-act="open" data-id="${esc(x.id)}">打开</button></td></tr>`), '还没有拆解报告');
  }
  await loadReports();
  if (pending) { sessionStorage.removeItem('sv.pendingItem'); const r = await act(() => post('/api/breakdown/analyze', { itemId: pending })); if (r) { renderReport(r); await loadReports(); } }
  hook(el, async (a, t) => {
    if (a === 'analyze') { const id = val(el, '#svItem'); if (!id) return toast('请先选择视频', '', 'warn'); const r = await act(() => post('/api/breakdown/analyze', { itemId: id }), '拆解完成'); if (r) { renderReport(r); await loadReports(); } }
    else if (a === 'custom') modal({ title: '粘贴逐字稿或 SRT', desc: '无 ASR 服务时可手工导入，生成的时间轴与拆解同样可复算', wide: true,
      body: `<label class="field-label">视频标题</label><input id="svCustomTitle" class="sv-input" placeholder="例：狗狗磨牙玩具实测" />
        <label class="field-label" style="margin-top:10px">逐字稿 / SRT（每行一句，或标准 SRT 时间码）</label><textarea id="svCustomText" class="sv-input" rows="9" placeholder="别再买第 8 根咬胶了…&#10;狗独处时会焦虑…"></textarea>`,
      actions: [{ label: '取消' }, { label: '生成拆解', primary: true, onClick: async () => {
        const title = (document.getElementById('svCustomTitle')?.value || '自定义视频').trim();
        const text = document.getElementById('svCustomText')?.value || '';
        if (!text.trim()) { toast('请填写逐字稿', '', 'warn'); return false; }
        const r = await act(() => post('/api/breakdown/analyze', { title, srt: text }), '拆解完成');
        if (r) { renderReport(r); await loadReports(); }
      } }] });
    else if (a === 'search') await loadReports();
    else if (a === 'open') { const r = await act(() => get('/api/breakdown/reports/' + t.dataset.id)); if (r) renderReport(r); }
    else if (a === 'rerun' && current) { const r = await act(() => post(`/api/breakdown/reports/${current.id}/rerun`, { kind: t.dataset.kind }), '已重跑'); if (r) renderReport(r); }
    else if (a === 'to-remix' && current) { sessionStorage.setItem('sv.pendingReport', current.id); location.hash = '#/auto'; }
  });
}

/* ==================== 批量混剪 ==================== */
async function remixPanel(el, st) {
  wrap(el, st, 'auto');
  const [c, plans, pendingReport] = await Promise.all([
    get('/api/remix/constants').catch(() => ({ grades: [], hooks: [], subtitles: [], bgm: [], ratios: {} })),
    get('/api/remix/plans').catch(() => ({ items: [] })),
    Promise.resolve(sessionStorage.getItem('sv.pendingReport') || '')
  ]);
  sessionStorage.removeItem('sv.pendingReport');
  const checks = (arr, name) => arr.map(x => `<label class="sv-check"><input type="checkbox" name="${name}" value="${esc(x)}" checked><span>${esc(x)}</span></label>`).join('');
  setBody(el, `
    <div class="sv-toolbar"><span class="sv-mini">上传自有 / 已授权素材 → 提示词生成分镜 → 变体矩阵 → 云端 ffmpeg 渲染 → QC 与物料包</span>
      <button class="btn btn-sm" data-act="refresh-all">刷新全部</button></div>
    <div class="sv-grid2">
      <div class="sv-sub"><h4>素材四维分级与上传</h4>
        <div class="sv-form"><input type="file" id="svFile" accept="video/*,audio/*,image/*" />
          <select id="svGrade">${(c.grades || []).map(g => `<option value="${esc(g.key)}">${esc(g.label)} · ${esc(g.hint)}</option>`).join('')}</select>
          <button class="btn btn-sm btn-primary" data-act="upload">上传</button></div>
        <div id="svAssets"></div></div>
      <div class="sv-sub"><h4>提示词 → 分镜 JSON</h4>
        <textarea id="svPrompt" class="sv-input" rows="3" placeholder="例：宠物磨牙玩具，30 秒，前 3 秒反常识钩子，结尾引导收藏">宠物磨牙玩具，30 秒带货短视频，突出耐咬与独处焦虑</textarea>
        <div class="sv-form"><input id="svDur" type="number" min="10" max="90" value="30" style="max-width:90px" title="时长（秒）" />
          <select id="svPlanReport"><option value="">不参考拆解报告</option>${(plans.items || []).map(p => `<option value="${esc(p.id)}">计划 ${esc(p.prompt.slice(0, 20))}</option>`).join('')}</select>
          <button class="btn btn-sm btn-primary" data-act="plan">生成分镜</button></div>
        <div id="svPlan" class="sv-mini">${pendingReport ? '已从拆解报告带入，可直接生成分镜。' : '生成后可创建变体批次。'}</div></div>
    </div>
    <div class="sv-sub" style="margin-top:12px"><h4>变体矩阵（钩子 × 字幕 × BGM × 时长，最多 50 条）</h4>
      <div class="sv-matrix"><div><b>钩子</b>${checks(c.hooks || [], 'hooks')}</div><div><b>字幕样式</b>${checks(c.subtitles || [], 'subtitles')}</div>
      <div><b>BGM 情绪</b>${checks(c.bgm || [], 'bgm')}</div><div><b>时长</b>${[15, 30, 45].map(d => `<label class="sv-check"><input type="checkbox" name="durations" value="${d}" ${d === 30 ? 'checked' : ''}><span>${d}s</span></label>`).join('')}</div></div>
      <div class="sv-form"><span id="svMatrixCount" class="sv-mini">预计 3 条</span><button class="btn btn-sm btn-primary" data-act="batch">创建批量任务</button></div>
      <div class="sv-note">批量任务定位为自有 / 授权素材的多版本 A/B 创意测试；不做规避平台查重的伪原创，不自动发布到平台账号。</div></div>
    <div class="sv-sub" style="margin-top:12px"><h4>批次与任务队列（进度 / 取消 / 断点续跑）</h4><div id="svBatches"></div></div>`);
  let planId = '';
  async function loadAssets() {
    const r = await get('/api/remix/assets').catch(() => ({ items: [] }));
    $('#svAssets', el).innerHTML = tbl(['素材', '类型', '分级', '大小', ''], (r.items || []).slice(0, 12).map(a => `<tr>
      <td>${esc(a.title)}<div class="sv-mini">${esc(a.file_name || '')}</div></td><td>${esc(a.kind)}</td>
      <td><select data-asset-grade="${esc(a.id)}">${(c.grades || []).map(g => `<option value="${esc(g.key)}" ${g.key === a.grade ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></td>
      <td>${(a.size / 1024).toFixed(0)}KB</td><td></td></tr>`), '还没有上传素材');
    $$('[data-asset-grade]', el).forEach(s => s.onchange = async () => { await act(() => post(`/api/remix/assets/${s.dataset.assetGrade}/grade`, { grade: s.value }), '分级已更新'); });
  }
  async function loadBatches() {
    const r = await get('/api/remix/batches').catch(() => ({ items: [] }));
    $('#svBatches', el).innerHTML = (r.items || []).length ? (r.items || []).map(b => `<div class="sv-batch">
      <div class="sv-batch-head"><b>${esc(b.name)}</b><span class="sv-tag ${b.status === 'done' ? 'green' : b.status === 'running' ? 'blue' : ''}">${esc(b.status)}</span>
        <span class="sv-mini">${b.done}/${b.total} · ${esc(b.createdAt?.slice(0, 16) || '')}</span>
        <div class="sv-ops"><button class="btn btn-sm" data-act="batch-detail" data-id="${esc(b.id)}">详情</button>
        <button class="btn btn-sm" data-act="batch-cancel" data-id="${esc(b.id)}">取消</button>
        <button class="btn btn-sm" data-act="batch-resume" data-id="${esc(b.id)}">断点续跑</button></div></div>
      <div class="progress"><div style="width:${b.progress || 0}%"></div></div></div>`).join('') : '<div class="sv-empty">还没有批次</div>';
  }
  function selected(name) { return $$(`input[name="${name}"]:checked`, el).map(i => Number(i.value) || i.value); }
  function updateCount() {
    const n = Math.min(50, (selected('hooks').length || 1) * (selected('subtitles').length || 1) * (selected('bgm').length || 1) * (selected('durations').length || 1));
    const e = $('#svMatrixCount', el); if (e) e.textContent = `预计 ${n} 条任务（今日配额在服务端校验）`;
  }
  $$('.sv-matrix input', el).forEach(i => i.onchange = updateCount);
  updateCount();
  async function showBatch(id) {
    const b = await act(() => get('/api/remix/batches/' + id)); if (!b) return;
    const rows = b.jobs.map(j => `<tr><td>${j.idx + 1}</td><td>${esc(j.variant?.hookKind || '')} / ${esc(j.variant?.subtitleStyle || '')} / ${esc(j.variant?.duration || '')}s</td>
      <td><span class="sv-tag ${j.status === 'done' ? 'green' : j.status === 'failed' ? 'rose' : 'blue'}">${esc(j.status)}</span></td><td>${j.progress}%</td>
      <td>${j.qc ? `QC ${j.qc.score} 分` : esc(j.error || j.stage || '—')}</td>
      <td class="sv-ops"><button class="btn btn-sm" data-act="job-detail" data-id="${esc(j.id)}">详情</button>
      <button class="btn btn-sm" data-act="job-retry" data-id="${esc(j.id)}">重试</button></td></tr>`);
    modal({ title: '批次详情', desc: `${b.name} · ${b.done}/${b.total} 完成`, wide: true,
      body: `<div class="progress"><div style="width:${b.progress}%"></div></div>${tbl(['#', '变体', '状态', '进度', 'QC / 错误', '操作'], rows, '暂无任务')}` });
  }
  async function showJob(id) {
    const j = await act(() => get('/api/remix/jobs/' + id)); if (!j) return;
    const qc = j.qc ? tbl(['检查项', '结果', '详情'], j.qc.checks.map(c => `<tr><td>${esc(c.name)}</td><td>${c.ok ? '✓' : '✗'}</td><td>${esc(c.detail)}</td></tr>`)) : '<div class="sv-empty">暂无 QC</div>';
    const p = j.package || {};
    const file = j.output ? `output_${(j.ratios[0] || '9:16').replace(':', 'x')}.mp4` : '';
    const video = j.output ? `<div class="sv-video"><video controls src="${mediaURL(j.id, file)}"></video>
      <div class="sv-form"><a class="btn btn-sm" href="${mediaURL(j.id, file)}?download=1" download>下载成片</a>
      <a class="btn btn-sm" href="${mediaURL(j.id, 'subtitle.srt')}?download=1" download>下载 SRT</a>
      <a class="btn btn-sm" href="${mediaURL(j.id, 'voice.m4a')}?download=1" download>下载配音</a></div>
      <div class="sv-mini">多画幅：${(j.ratios || []).map(r => `<a href="${mediaURL(j.id, 'output_' + r.replace(':', 'x') + '.mp4')}?download=1" download>${esc(r)}</a>`).join(' · ')}</div></div>` : '<div class="sv-empty">尚未产出成片</div>';
    modal({ title: '任务详情', desc: `${j.status} · ${j.stage || ''} · ${j.progress}%`, wide: true,
      body: `${video}<h4>成片 QC（${j.qc?.score ?? '—'} 分）</h4>${qc}
        <h4 style="margin-top:12px">发布物料包</h4><pre class="sv-pre">${esc([p.title, (p.hashtags || []).join(' '), p.description, '置顶：' + p.pinnedComment, 'AIGC：' + (p.aigcLabel?.text || '未开启'), '违禁词：' + (p.bannedWords?.hits || []).join('、'), p.publishNote].filter(Boolean).join('\n'))}</pre>
        <h4 style="margin-top:12px">任务事件</h4><div class="sv-scroll">${(j.events || []).map(e => `<div class="sv-line"><span>${esc(e.ts?.slice(11, 19) || '')}</span>${esc(e.stage)} · ${esc(e.message)}</div>`).join('')}</div>` });
  }
  await Promise.all([loadAssets(), loadBatches()]);
  hook(el, async (a, t) => {
    if (a === 'upload') {
      const f = $('#svFile', el)?.files?.[0]; if (!f) return toast('请先选择文件', '', 'warn');
      const g = val(el, '#svGrade') || 'product';
      const r = await act(() => upload(`/api/remix/upload?grade=${encodeURIComponent(g)}&title=${encodeURIComponent(f.name)}&licenseNote=${encodeURIComponent('自有 / 已授权')}`, f), '上传成功');
      if (r) await loadAssets();
    }
    else if (a === 'plan') {
      const body = { prompt: val(el, '#svPrompt') || '带货短视频', duration: num(el, '#svDur', 30) };
      if (pendingReport) body.reportId = pendingReport;
      const r = await act(() => post('/api/remix/plan', body), '分镜已生成');
      if (r) { planId = r.id; $('#svPlan', el).innerHTML = tbl(['镜', '段落', '时间', '素材分级', '文本'], (r.scenes || []).map(s => `<tr><td>${esc(s.id)}</td><td>${esc(s.label)}</td><td>${s.start}–${s.end}s</td><td>${esc(s.grade)}</td><td>${esc(s.text)}</td></tr>`)) + `<div class="sv-note">来源 ${esc(r.sourceMode)} · ${r.duration}s · 约束 ${(r.constraints || []).length} 条</div>`; }
    }
    else if (a === 'batch') {
      const usePlan = planId || val(el, '#svPlanReport');
      if (!usePlan) return toast('请先生成分镜计划，或选择已有计划', '', 'warn');
      const body = { planId: usePlan, name: `批次 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`, hooks: selected('hooks'), subtitles: selected('subtitles'), bgm: selected('bgm'), durations: selected('durations') };
      const r = await act(() => post('/api/remix/batches', body), '批次已创建'); if (r) await loadBatches();
    }
    else if (a === 'refresh-all') { await loadAssets(); await loadBatches(); }
    else if (a === 'batch-detail') await showBatch(t.dataset.id);
    else if (a === 'batch-cancel') { await act(() => post('/api/remix/batches/' + t.dataset.id + '/cancel'), '已取消'); await loadBatches(); }
    else if (a === 'batch-resume') { await act(() => post('/api/remix/batches/' + t.dataset.id + '/resume'), '已重新入队'); await loadBatches(); }
    else if (a === 'job-detail') await showJob(t.dataset.id);
    else if (a === 'job-retry') { await act(() => post('/api/remix/jobs/' + t.dataset.id + '/retry'), '已重新入队'); }
  });
  pollTimer = setInterval(async () => { if (!document.body.contains(el)) return stopConsolePolling(); await loadBatches(); }, 5000);
}

/* ==================== 多人协作 ==================== */
async function collabPanel(el, st) {
  wrap(el, st, 'library');
  const [ov, assets] = await Promise.all([get('/api/collab/overview').catch(() => null), get('/api/remix/assets').catch(() => ({ items: [] }))]);
  const opts = (assets.items || []).map(a => `<option value="${esc(a.id)}">${esc(a.title)}</option>`).join('');
  setBody(el, `
    <div class="sv-cards sv-cards-4">
      <div class="sv-stat"><b>${ov?.orgs?.length || 0}</b><span>组织</span><small>${ov?.projects?.length || 0} 个项目空间</small></div>
      <div class="sv-stat"><b>${ov?.assets || 0}</b><span>共享素材</span><small>${ov?.comments || 0} 条帧级批注</small></div>
      <div class="sv-stat"><b>${ov?.approvalsPending || 0}</b><span>待审批</span><small>${ov?.users || 0} 位成员</small></div>
      <div class="sv-stat"><b>${ov?.quota?.roleLabel || '—'}</b><span>我的角色</span><small>今日任务 ${ov?.quota?.jobs || 0}/${ov?.quota?.jobsLimit < 0 ? '∞' : ov?.quota?.jobsLimit}</small></div>
    </div>
    <div class="sv-grid2" style="margin-top:12px">
      <div class="sv-sub"><h4>帧级批注（精确到时间点）</h4>
        <div class="sv-form"><select id="svCmtAsset">${opts || '<option value="">暂无素材</option>'}</select>
          <input id="svCmtT" type="number" step="0.1" value="3.0" style="max-width:78px" title="时间（秒）" />
          <input id="svCmtText" placeholder="这一帧产品再放大一点" /><button class="btn btn-sm btn-primary" data-act="cmt-add">添加</button></div>
        <div id="svComments"></div></div>
      <div class="sv-sub"><h4>版本与审批</h4>
        <div class="sv-form"><select id="svVerAsset">${opts || '<option value="">暂无素材</option>'}</select>
          <input id="svVerNote" placeholder="版本说明" /><button class="btn btn-sm" data-act="ver-add">添加版本</button></div>
        <div id="svVersions"></div>
        <div class="sv-form" style="margin-top:10px"><input id="svApJob" placeholder="任务 ID（可留空）" />
          <button class="btn btn-sm" data-act="ap-add">提交审批</button></div>
        <div id="svApprovals"></div></div>
    </div>
    <div class="sv-note">成员、角色与审计日志在「管理后台 → 云服务器管理」；上传的素材与成片对同项目成员共享，权限由服务端角色控制。</div>`);
  async function loadComments() {
    const id = val(el, '#svCmtAsset'); if (!id) { $('#svComments', el).innerHTML = '<div class="sv-empty">暂无素材</div>'; return; }
    const r = await get('/api/collab/comments', { assetId: id }).catch(() => ({ items: [] }));
    $('#svComments', el).innerHTML = tbl(['时间', '批注', '作者', ''], (r.items || []).map(c => `<tr><td>${Number(c.frame_t).toFixed(1)}s</td><td>${esc(c.text)}</td><td>${esc(c.author)}</td>
      <td><button class="btn btn-sm" data-act="cmt-resolve" data-id="${esc(c.id)}" data-on="${c.resolved ? 0 : 1}">${c.resolved ? '重开' : '解决'}</button></td></tr>`), '暂无批注');
  }
  async function loadVersions() {
    const id = val(el, '#svVerAsset'); if (!id) { $('#svVersions', el).innerHTML = '<div class="sv-empty">暂无素材</div>'; return; }
    const r = await get('/api/collab/versions', { assetId: id }).catch(() => ({ items: [] }));
    $('#svVersions', el).innerHTML = tbl(['版本', '说明', '时间'], (r.items || []).map(v => `<tr><td>V${v.version}</td><td>${esc(v.note || '—')}</td><td>${esc(v.created_at?.slice(0, 16) || '')}</td></tr>`), '暂无版本');
  }
  async function loadApprovals() {
    const r = await get('/api/collab/approvals').catch(() => ({ items: [] }));
    $('#svApprovals', el).innerHTML = tbl(['对象', '状态', '说明', ''], (r.items || []).slice(0, 8).map(a => `<tr><td>${esc((a.job_id || a.asset_id || '').slice(0, 18))}</td>
      <td><span class="sv-tag ${a.status === 'approved' ? 'green' : a.status === 'pending' ? 'amber' : 'rose'}">${esc(a.status)}</span></td><td>${esc(a.note || '—')}</td>
      <td>${a.status === 'pending' ? `<button class="btn btn-sm" data-act="ap-ok" data-id="${esc(a.id)}">通过</button><button class="btn btn-sm" data-act="ap-no" data-id="${esc(a.id)}">驳回</button>` : ''}</td></tr>`), '暂无审批');
  }
  await Promise.all([loadComments(), loadVersions(), loadApprovals()]);
  ['#svCmtAsset', '#svVerAsset'].forEach(s => { const e = $(s, el); if (e) e.onchange = () => { if (s === '#svCmtAsset') loadComments(); else loadVersions(); }; });
  hook(el, async (a, t) => {
    if (a === 'cmt-add') { const text = val(el, '#svCmtText'); if (!text) return toast('请填写批注', '', 'warn'); await act(() => post('/api/collab/comments', { assetId: val(el, '#svCmtAsset'), frameT: num(el, '#svCmtT'), text }), '批注已添加'); $('#svCmtText', el).value = ''; await loadComments(); }
    else if (a === 'cmt-resolve') { await act(() => post('/api/collab/comments/' + t.dataset.id + '/resolve', { resolved: Number(t.dataset.on) === 1 })); await loadComments(); }
    else if (a === 'ver-add') { await act(() => post('/api/collab/versions', { assetId: val(el, '#svVerAsset'), note: val(el, '#svVerNote') }), '版本已记录'); await loadVersions(); }
    else if (a === 'ap-add') { await act(() => post('/api/collab/approvals', { jobId: val(el, '#svApJob') || null, note: '请评审成片' }), '审批已提交'); await loadApprovals(); }
    else if (a === 'ap-ok' || a === 'ap-no') { await act(() => post('/api/collab/approvals/' + t.dataset.id + '/decide', { decision: a === 'ap-ok' ? 'approved' : 'rejected', note: '' }), '审批已处理'); await loadApprovals(); }
  });
}

/* ==================== 管理后台 ==================== */
const CFG_FIELDS = [
  ['数据源', [['data.apiUrl', '第三方数据 API URL（无 TikTok 官方权限时必填）'], ['data.apiKey', '数据 API Key'], ['discover.limit', '每次同步条数']]],
  ['AI 能力', [['llm.baseUrl', 'LLM OpenAI 兼容 Base URL'], ['llm.apiKey', 'LLM API Key'], ['llm.model', '模型名'], ['asr.apiUrl', 'ASR 转写接口'], ['asr.apiKey', 'ASR Key'], ['tts.apiUrl', 'TTS 接口'], ['tts.apiKey', 'TTS Key']]],
  ['调度与推送', [['discover.syncHour', '每日同步小时（0–23）'], ['discover.digestHour', '日报推送小时'], ['discover.timezone', '时区'], ['push.webhookUrl', '企微/飞书/Slack Webhook'], ['push.channel', '推送渠道 wecom/feishu/slack']]],
  ['配额与内容', [['quota.jobsPerDay', '每人每日任务上限'], ['quota.rendersPerDay', '每人每日渲染上限'], ['remix.maxConcurrent', '渲染并发数'], ['content.aigcLabel', 'AIGC 标识（true/false）'], ['content.bannedWords', '违禁词（逗号分隔）']]]
];
async function adminPanel(el, st) {
  wrap(el, st, 'admin');
  const [cfg, members, audit, status] = await Promise.all([
    get('/api/config').catch(() => null), get('/api/collab/members').catch(() => ({ items: [] })),
    get('/api/collab/audit', { limit: 20 }).catch(() => ({ items: [] })), get('/api/status').catch(() => null)
  ]);
  if (!cfg) { setBody(el, '<div class="sv-notice">当前账号无权读取服务端配置（需要管理员及以上角色）。</div>'); return; }
  const fields = CFG_FIELDS.map(([group, list]) => `<div class="sv-sub"><h4>${group}</h4>${list.map(([k, label]) => {
    const v = cfg.config[k];
    const shown = Array.isArray(v) ? v.join(',') : (v === true ? 'true' : v === false ? 'false' : (v ?? ''));
    return `<label class="sv-field"><span>${esc(label)}</span><input data-cfg="${esc(k)}" class="sv-input" value="${esc(String(shown))}" /></label>`;
  }).join('')}</div>`).join('');
  setBody(el, `
    <div class="sv-toolbar"><span class="sv-mini">能力：${esc(JSON.stringify(status?.providers || {}))}</span>
      <span class="sv-mini">调度：${esc(JSON.stringify(status?.cron || {}))}</span></div>
    <div class="sv-grid2">${fields}</div>
    <div class="sv-form" style="margin-top:12px"><button class="btn btn-sm btn-primary" data-act="cfg-save">保存服务端配置</button>
      <button class="btn btn-sm" data-act="sync-now">立即同步一次</button></div>
    <div class="sv-sub" style="margin-top:14px"><h4>成员与角色（服务端鉴权）</h4>
      <div class="sv-form"><input id="svMEmail" placeholder="邮箱" /><input id="svMName" placeholder="姓名" /><input id="svMPwd" placeholder="初始密码（≥8 位）" />
        <select id="svMRole"><option value="viewer">查看者</option><option value="reviewer">评审员</option><option value="editor" selected>创作者</option><option value="admin">管理员</option></select>
        <button class="btn btn-sm btn-primary" data-act="member-add">添加成员</button></div>
      <div id="svMembers"></div></div>
    <div class="sv-sub" style="margin-top:12px"><h4>审计日志</h4><div id="svAudit"></div></div>`);
  function renderMembers(items) {
    $('#svMembers', el).innerHTML = tbl(['邮箱', '组织 / 项目', '角色', '状态', '操作'], items.map(m => `<tr>
      <td>${esc(m.email)}</td><td>${esc(m.orgName || '')}${m.projectName ? ' / ' + esc(m.projectName) : ''}</td>
      <td><select data-role="${esc(m.id)}">${['viewer', 'reviewer', 'editor', 'admin', 'owner'].map(r => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td>${esc(m.status)}</td><td class="sv-ops"><button class="btn btn-sm" data-act="member-reset" data-id="${esc(m.user_id)}" data-email="${esc(m.email)}">重置密码</button><button class="btn btn-sm" data-act="member-status" data-id="${esc(m.user_id)}" data-email="${esc(m.email)}" data-status="${m.status === 'active' ? 'disabled' : 'active'}">${m.status === 'active' ? '停用' : '启用'}</button></td></tr>`), '暂无成员');
    $$('[data-role]', el).forEach(s => s.onchange = async () => { await act(() => post(`/api/collab/members/${s.dataset.role}/role`, { role: s.value }), '角色已更新'); });
  }
  renderMembers(members.items || []);
  $('#svAudit', el).innerHTML = tbl(['时间', '操作者', '动作', '对象'], (audit.items || []).map(a => `<tr><td>${esc(a.ts?.slice(0, 16) || '')}</td><td>${esc(a.actor_email)}</td><td>${esc(a.action)}</td><td>${esc(a.target || '')}</td></tr>`), '暂无日志');
  hook(el, async (a, t) => {
    if (a === 'cfg-save') {
      const config = {};
      $$('[data-cfg]', el).forEach(i => {
        const k = i.dataset.cfg, v = i.value.trim();
        if (v === '••••••••') return;
        if (['discover.syncHour', 'discover.digestHour', 'discover.limit', 'quota.jobsPerDay', 'quota.rendersPerDay', 'remix.maxConcurrent'].includes(k)) config[k] = Number(v) || 0;
        else if (k === 'content.aigcLabel') config[k] = v === 'true';
        else if (k === 'content.bannedWords') config[k] = v.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        else config[k] = v;
      });
      await act(() => post('/api/config', { config }), '配置已保存');
    }
    else if (a === 'sync-now') await act(() => post('/api/discover/sync'), '同步完成');
    else if (a === 'member-add') {
      const body = { email: val(el, '#svMEmail'), name: val(el, '#svMName'), password: val(el, '#svMPwd'), role: val(el, '#svMRole') };
      const r = await act(() => post('/api/collab/members', body), '成员已添加');
      if (r) {
        const m = await get('/api/collab/members'); renderMembers(m.items || []);
        if (r.created && r.initialPassword) {
          showInvite({ email: r.email, password: r.initialPassword, role: r.role, url: location.href.split('#')[0] });
        } else toast('成员已加入', '该邮箱已有账号，沿用其现有密码');
        ['#svMEmail', '#svMName', '#svMPwd'].forEach(s => { const i = $(s, el); if (i) i.value = ''; });
      }
    }
    else if (a === 'member-reset') {
      const email = t.dataset.email, id = t.dataset.id;
      modal({ title: '重置初始密码', desc: email,
        body: `<label class="field-label">新的初始密码（≥8 位含字母数字，留空自动生成）</label>
          <input id="svResetPwd" class="sv-input" placeholder="留空自动生成" />
          <div class="field-hint">重置会立即注销该成员的全部登录会话；新密码只在本次返回一次。</div>`,
        actions: [
          { label: '取消' },
          { label: '确认重置', primary: true, close: false, onClick: async (close) => {
            const v = (document.getElementById('svResetPwd')?.value || '').trim();
            const pwd = v || `Sv@${Math.random().toString(36).slice(2, 10)}9`;
            const r = await act(() => post(`/api/collab/users/${id}/reset`, { password: pwd }), '密码已重置');
            close();
            if (r) showInvite({ email, password: r.initialPassword || pwd, role: '沿用原角色', url: location.href.split('#')[0] });
            return false;
          } }
        ] });
    }
    else if (a === 'member-status') {
      await act(() => post(`/api/collab/users/${t.dataset.id}/status`, { status: t.dataset.status }), '状态已更新');
      const m = await get('/api/collab/members'); renderMembers(m.items || []);
    }
  });
}

/* ==================== 挂载入口 ==================== */
const PANELS = { home: homePanel, radar: radarPanel, breakdown: breakdownPanel, auto: remixPanel, library: collabPanel, admin: adminPanel };
export function mountCloudConsole(page, root) {
  stopConsolePolling();
  activePanel = page;
  const fn = PANELS[page];
  if (!fn || !root) return;
  const host = root.querySelector('.page') || root;
  const el = document.createElement('section');
  el.className = 'sv-panel';
  el.id = 'cloudConsole';
  host.prepend(el);
  const st = svState();
  if (!st.available) { el.innerHTML = offline(st); return; }
  if (!st.me) { el.innerHTML = needLogin(st); return; }
  Promise.resolve(fn(el, st)).catch(e => { console.error('[cloud console]', page, e); setBody(el, `<div class="sv-notice">面板加载失败：${esc(e.message)}</div>`); });
}
