import { icon } from './icons.js';
import { $, $$, toast, modal, esc, pad, fmtDateCN, bindCollapse } from './ui.js';
import { store } from './store.js';
import { bus } from './bus.js';
import { loadAllowlist, verifyCode, setSession, clearSession, getSession, revalidate, logAccess, isAdmin, allowlistIsOffline } from './auth.js';

import home from './pages/home.js';
import radar from './pages/radar.js';
import breakdown from './pages/breakdown.js';
import script from './pages/script.js';
import editor from './pages/editor.js';
import auto from './pages/auto.js';
import review from './pages/review.js';
import library from './pages/library.js';
import admin from './pages/admin.js';

const NAV = [
  { id:'home',      label:'首页概览',     ico:'home',     page:home,      sub:'今天也要做好创作 ✦', stage:0 },
  { id:'radar',     label:'爆款雷达',     ico:'radar',    page:radar,     sub:'探索正在流行的带货内容', stage:1 },
  { id:'breakdown', label:'AI 文案拆解',  ico:'ai',       page:breakdown,  sub:'把别人的爆款拆成可复用结构', stage:2 },
  { id:'script',    label:'口播文案工坊', ico:'file',     page:script,     sub:'选一选、填一填，出分段稿', stage:3 },
  { id:'editor',    label:'在线剪辑台',   ico:'scissors', page:editor,    sub:'四轨时间线，工程自动保存', stage:4 },
  { id:'auto',      label:'智能成片',     ico:'wand',     page:auto,       sub:'上传视频，六步跑完工程包', stage:5 },
  { id:'review',    label:'成品评估',     ico:'chart',    page:review,     sub:'打分、自检、一键分发', stage:6 },
  { id:'library',   label:'素材库',       ico:'folder',   page:library,    sub:'文案、拆解、工程统一收纳', stage:0 },
  { id:'admin',     label:'管理后台',     ico:'shield',   page:admin,      sub:'访问授权、名单与数据快照', stage:0, adminOnly:true },
];

const STAGE_NAMES = ['准备','找方向','拆结构','写稿','剪辑','成片','评估'];

function setStage(n) {
  const label = $('#stageLabel'), bar = $('#stageBar'), steps = $('#stageSteps');
  if (!label) return;
  label.textContent = `${STAGE_NAMES[n] || '准备'} · ${n}/6`;
  bar.style.width = Math.max(6, (n / 6) * 100) + '%';
  steps.innerHTML = Array.from({ length:6 }, (_, i) => `<span class="${i < n ? 'done' : ''}"></span>`).join('');
}

function renderNav(active) {
  $('#nav').innerHTML = NAV.map(n => `
    <button class="nav-item ${n.id === active ? 'active' : ''}" data-nav="${n.id}" title="${esc(n.label)}">
      ${icon(n.ico, 17)}<span class="nav-label">${esc(n.label)}</span>
      ${n.adminOnly ? '<span class="nav-badge">管理</span>' : ''}
    </button>`).join('');
  $$('[data-nav]').forEach(btn => btn.onclick = () => {
    const n = NAV.find(x => x.id === btn.dataset.nav);
    if (n.adminOnly && !isAdmin()) {
      modal({ title:'需要管理员权限', desc:'访问授权与名单管理仅对管理员开放。',
        body:'<div class="notice-box">当前账号为普通创作者。如需管理权限，请联系管理员签发 admin 角色的授权码。</div>' });
      return;
    }
    navigate(n.id);
  });
}

function currentId() {
  const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return NAV.some(n => n.id === h) ? h : 'home';
}

function renderPage() {
  const id = currentId();
  const n = NAV.find(x => x.id === id);
  if (n.adminOnly && !isAdmin()) { location.hash = '#/home'; return renderPage(); }
  const root = $('#page-root');
  root.innerHTML = `<div class="page">${n.page.render()}</div>`;
  try { n.page.mount(root); } catch (e) { console.error('[page mount]', id, e); }
  bindCollapse(root);
  renderNav(id);
  setStage(n.stage);
  $('#crumb').textContent = n.label;
  $('#crumbSub').textContent = n.sub;
  $('#content').scrollTop = 0;
}

function navigate(id, params = {}) {
  bus.pending = params || {};
  const next = '#/' + id;
  if (location.hash === next) renderPage(); else location.hash = next;
}
bus.navigate = navigate;
window.addEventListener('hashchange', renderPage);

function tickClock() {
  const d = new Date();
  const el = $('#topClock');
  if (el) el.innerHTML = `${icon('clock', 13)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const hero = $('#heroClock');
  if (hero) hero.innerHTML = `${pad(d.getHours())}:${pad(d.getMinutes())}<span class="sec">:${pad(d.getSeconds())}</span>`;
  const hd = $('#heroDate');
  if (hd) hd.textContent = fmtDateCN(d);
}
setInterval(tickClock, 1000);

function showShell(session) {
  $('#gate').hidden = true;
  $('#shell').hidden = false;
  $('#sideUserName').textContent = session.name || '创作者';
  $('#sideAvatar').textContent = (session.name || '创')[0];
  $('#topAvatar').textContent = (session.name || '创')[0];
  bus.session = session;
  renderPage();
  tickClock();
}

async function boot() {
  const r = await loadAllowlist();
  const s = await revalidate();
  const status = $('#gateStatus');
  if (status) status.textContent = allowlistIsOffline() ? '名单文件未加载，使用内置初始名单' : '授权名单已加载';
  if (s) showShell(s); else showGate();
}

function showGate() {
  $('#shell').hidden = true;
  $('#gate').hidden = false;
  const input = $('#gateCode'), err = $('#gateError');
  input.value = '';
  const submit = async () => {
    err.hidden = true;
    const code = input.value.trim();
    if (!code) { err.textContent = '请输入授权码'; err.hidden = false; return; }
    const res = await verifyCode(code);
    if (!res.ok) {
      logAccess(`验证失败：${res.reason}`);
      err.textContent = res.reason; err.hidden = false;
      input.focus(); return;
    }
    const s = { code:code.toUpperCase(), name:res.entry.name, role:res.entry.role, loginAt:store.now() };
    setSession(s);
    logAccess(`${res.entry.name} 通过授权进入工作台`);
    showShell(s);
    toast('欢迎回来', `${res.entry.name}，今天也要做好创作`);
  };
  $('#gateSubmit').onclick = submit;
  input.onkeydown = e => { if (e.key === 'Enter') submit(); };
  $('#gateHelp').onclick = () => modal({
    title:'如何获得授权', desc:'本工作台采用邀请制访问',
    body:`<div class="block"><div class="block-head"><b>1 · 找管理员</b></div><div class="small muted">授权码由「管理后台 → 访问授权」签发，可设置有效期与角色。</div></div>
      <div class="block"><div class="block-head"><b>2 · 输入授权码</b></div><div class="small muted">名单只保存授权码的 SHA-256 摘要，仓库中不出现明文；管理员签发后需更新仓库名单文件才会对所有人生效。</div></div>
      <div class="block"><div class="block-head"><b>3 · 开始创作</b></div><div class="small muted">文案、剪辑工程与素材保存在本机浏览器，刷新不丢失；可在管理后台导出工程快照提交到仓库。</div></div>`,
    actions:[{ label:'知道了', primary:true }],
  });
  setTimeout(() => input.focus(), 100);
}

// 顶部与侧边通用交互
function wireChrome() {
  $('#sideCollapse').onclick = () => {
    const sb = $('#sidebar');
    const collapsed = sb.classList.toggle('collapsed');
    $('#sideCollapse').innerHTML = icon(collapsed ? 'chevronRight' : 'chevronLeft', 14);
    $('#sideCollapse').title = collapsed ? '展开导航' : '收起导航';
  };
  $('#sideCollapse').innerHTML = icon('chevronLeft', 14);
  $('#sideLogo').innerHTML = icon('video', 21);
  $('#gateLogo').innerHTML = icon('video', 21);
  const clockChip = document.createElement('div');
  clockChip.className = 'clock-chip'; clockChip.id = 'topClock';
  $('#topbar-right').prepend(clockChip);

  $('#btnHelp').onclick = () => modal({
    title:'工作台使用说明', desc:'按做视频的顺序，九个页面串成一条流水线', wide:true,
    body:`<div class="grid g2">
      ${NAV.slice(0,8).map((n,i)=>`<div class="block"><div class="block-head"><b>${i+1}. ${esc(n.label)}</b><span class="badge">${icon(n.ico,12)} ${esc(STAGE_NAMES[n.stage])}</span></div><div class="small muted">${esc(n.sub)}</div></div>`).join('')}
      </div><div class="divider"></div><div class="notice-box">交互提示：卡片可悬停查看详情；带「展开」的区域可收起；文案可一键送去剪辑，剪辑工程可送去评估；所有工程自动保存在本机。</div>`,
  });
  $('#btnNotice').onclick = () => {
    const logs = store.get('logs', []);
    modal({ title:'最近动态', desc:'本机操作记录', body: logs.length
      ? logs.slice(0,8).map(l=>`<div class="log-line"><time>${esc(l.at)}</time><span>${esc(l.text)}</span></div>`).join('')
      : '<div class="empty">暂无记录</div>' });
  };
  $('#topAvatar').onclick = () => {
    const s = getSession();
    modal({ title:'账户信息', desc:`${s?.name || '创作者'} · ${s?.role === 'admin' ? '管理员' : '创作者'}`,
      body:`<div class="block"><div class="block-head"><b>登录时间</b></div><div class="small muted">${esc(s?.loginAt || '—')}</div></div>
        <div class="block"><div class="block-head"><b>数据位置</b></div><div class="small muted">本机浏览器存储；管理后台可导出工程快照提交到仓库。</div></div>`,
      actions:[{ label:'退出登录', onClick:()=>{ clearSession(); logAccess('退出登录'); location.hash='#/home'; location.reload(); } },{ label:'关闭', primary:true }] });
  };
  $('#sideMore').onclick = () => $('#btnHelp').click();
  const cloud = $('.cloud-chip');
  if (cloud) { cloud.style.cursor='pointer'; cloud.title='点击查看存储说明'; cloud.onclick = () => modal({
    title:'工程存储说明', desc:'刷新不丢失，跨设备需导出快照',
    body:'<div class="notice-box">文案、剪辑工程、素材与自检状态保存在本机浏览器（localStorage），刷新页面不会丢失。由于站点托管在静态页面服务上，浏览器无法直接写入仓库；在「管理后台 → 数据快照」导出 JSON 并提交到仓库，即可把工程随代码一起版本化。</div>' }); }
}

wireChrome();
boot();
