import { icon } from './icons.js';
import { $, $$, toast, modal, esc, pad, fmtDateCN, bindCollapse } from './ui.js';
import { store } from './store.js';
import { bus } from './bus.js';
import { loadAccounts, verifyLogin, setSession, clearSession, getSession, revalidate, logAccess, isAdmin, accountsIsOffline } from './auth.js';
import { openChangePassword } from './password-dialog.js';
import { cloudEnabled, staticFallback, cloudNotice, restoreCloudAuth, startCloudLogin, signOutCloud } from './cloud.js';
import { applyRadarItems, cachedItems } from './radar-source.js';
import { svBoot, svLogin, svLogout, svState } from './server-api.js';
import { mountCloudConsole } from './cloud-console.js';

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
        body:'<div class="notice-box">当前账号为普通创作者。如需管理权限，请联系管理员在「管理后台 → 账号与密码」中把该邮箱设为管理员。</div>' });
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
  try { mountCloudConsole(id, root); } catch (e) { console.error('[cloud console]', id, e); }
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
  const footSub = $('.side-foot-sub');
  if (footSub) footSub.textContent = session.email || '本机数据';
  bus.session = session;
  renderPage();
  tickClock();
}

function updateCloudChip() {
  const chip = $('#cloudChip');
  if (!chip) return;
  if (staticFallback) { chip.innerHTML = '<span class="dot"></span><span>静态备份站</span>'; chip.title = cloudNotice; }
  else if (!cloudEnabled) { chip.innerHTML = '<span class="dot"></span><span>云端未就绪</span>'; chip.title = '云服务 SDK 未加载'; }
  else if (bus.cloudSession) { chip.innerHTML = '<span class="dot dot-green"></span><span>云端已连接</span>'; chip.title = '已登录 WorkBuddy 账号，可上传原视频'; }
  else { chip.innerHTML = '<span class="dot dot-green"></span><span>本地已保存</span>'; chip.title = '本机工程已保存；云端上传按需登录'; }
}

async function boot() {
  // 探测云服务器后端：在线时以服务端为唯一身份源，离线时回退浏览器名单（静态备份站）
  await svBoot();
  // 若配置了授权数据源，刷新后也把缓存条目注入共享数组，保证拆解/工坊/素材库口径一致
  const cachedRadar = cachedItems();
  if (cachedRadar) applyRadarItems(cachedRadar);
  // OAuth 回调必须在授权门与路由之前分发
  bus.cloudSession = await restoreCloudAuth();
  updateCloudChip();
  await loadAccounts();
  const s = await revalidate();
  const status = $('#gateStatus');
  if (status) status.textContent = accountsIsOffline() ? '名单文件未加载，使用内置初始账号' : '账号名单已加载';
  if (s) showShell(s); else showGate();
}

function showGate() {
  $('#shell').hidden = true;
  $('#gate').hidden = false;
  const emailEl = $('#gateEmail'), passEl = $('#gatePass'), err = $('#gateError');
  emailEl.value = ''; passEl.value = ''; passEl.type = 'password';
  const eye = $('#gateEye');
  eye.textContent = '显示';
  eye.onclick = () => {
    const show = passEl.type === 'password';
    passEl.type = show ? 'text' : 'password';
    eye.textContent = show ? '隐藏' : '显示';
    eye.title = show ? '隐藏密码' : '显示密码';
  };
  const submit = async () => {
    err.hidden = true;
    const email = emailEl.value.trim(), pass = passEl.value;
    const st = svState();
    // 云服务器在线：服务端鉴权为准，后台新加的成员也能直接登录
    if (st.available) {
      const r = await svLogin(email, pass);
      if (!r.ok) {
        logAccess(`服务端登录失败：${r.reason}`);
        err.textContent = `服务端登录失败：${r.reason}`; err.hidden = false;
        (pass ? emailEl : passEl).focus();
        return;
      }
      const u = r.user || {};
      const s = { email:u.email || email, name:u.name || email.split('@')[0],
        role:(u.role === 'owner' || u.role === 'admin') ? 'admin' : 'user',
        loginAt:store.now(), usingInitial:!!u.mustChange, serverAuth:true };
      setSession(s);
      logAccess(`${s.name}（${s.email}）登录工作台（服务端身份）`);
      showShell(s);
      toast('欢迎回来', `${s.name}，云服务器已连接`);
      if (s.usingInitial) setTimeout(() => toast('安全提示', '首次登录请在右上角头像 → 账户信息 → 修改密码', 'warn'), 1100);
      return;
    }
    // 静态备份站：沿用浏览器名单
    const res = await verifyLogin(email, pass);
    if (!res.ok) {
      logAccess(`登录失败：${res.reason}`);
      err.textContent = res.reason; err.hidden = false;
      (pass ? emailEl : passEl).focus();
      return;
    }
    const s = { email:res.email, name:res.account.name, role:res.account.role,
      loginAt:store.now(), usingInitial:res.usingInitial, credTag:res.credTag };
    setSession(s);
    logAccess(`${res.account.name}（${res.email}）登录工作台`);
    showShell(s);
    toast('欢迎回来', `${res.account.name}，今天也要做好创作`);
    if (res.usingInitial) setTimeout(() => toast('安全提示', '当前使用初始密码，可在右上角头像菜单修改', 'warn'), 1100);
  };
  $('#gateSubmit').onclick = submit;
  [emailEl, passEl].forEach(el => el.onkeydown = e => { if (e.key === 'Enter') submit(); });
  $('#gateHelp').onclick = () => {
    const online = svState().available;
    modal({
      title:'如何登录工作台', desc: online ? '邀请制 · 服务端统一账号，任意浏览器打开链接即可' : '本工作台采用邀请制，按邮箱开通账号',
      body: online
        ? `<div class="block"><div class="block-head"><b>1 · 找管理员开通</b></div><div class="small muted">管理员在「管理后台 → 云服务器管理 → 成员与角色」添加你的邮箱，会把<b>访问链接 + 初始密码</b>私发给你。</div></div>
           <div class="block"><div class="block-head"><b>2 · 打开链接登录</b></div><div class="small muted">任意设备用浏览器打开同一个链接，输入邮箱与初始密码。账号、素材、混剪任务都在云服务器，换设备不丢数据。</div></div>
           <div class="block"><div class="block-head"><b>3 · 首次登录改密码</b></div><div class="small muted">右上角头像 → 账户信息 → 修改密码，服务端立即生效；忘记密码请管理员点「重置密码」。</div></div>`
        : `<div class="block"><div class="block-head"><b>1 · 找管理员开通</b></div><div class="small muted">管理员在「管理后台 → 账号与密码」添加你的邮箱，并告知初始登录密码。</div></div>
           <div class="block"><div class="block-head"><b>2 · 用邮箱 + 密码登录</b></div><div class="small muted">名单只保存 PBKDF2 加盐摘要，仓库与页面里都不出现明文密码；新账号需管理员导出名单并提交仓库后才能在其他设备登录。</div></div>
           <div class="block"><div class="block-head"><b>3 · 首次登录改密码</b></div><div class="small muted">右上角头像 → 账户信息 → 修改密码。改完本机立即生效；忘记密码可请管理员「重置为初始密码」。</div></div>`,
      actions:[{ label:'知道了', primary:true }],
    });
  };
  setTimeout(() => emailEl.focus(), 100);
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
      body:`<div class="block"><div class="block-head"><b>登录邮箱</b></div><div class="small muted mono">${esc(s?.email || '—')}</div></div>
        <div class="block"><div class="block-head"><b>密码状态</b><span class="badge ${s?.usingInitial ? 'amber' : ''}">${s?.usingInitial ? '初始密码' : '已自定义'}</span></div>
          <div class="small muted">${svState().available ? '密码由云服务器统一校验，修改后所有设备立即生效。' : (s?.usingInitial ? '建议尽快修改为仅自己知道的密码。' : '修改后本机立即生效；其他设备需同步账号名单。')}</div></div>
        <div class="block"><div class="block-head"><b>登录时间</b></div><div class="small muted">${esc(s?.loginAt || '—')}</div></div>
        <div class="block"><div class="block-head"><b>云服务器</b><span class="badge ${svState().available ? 'teal' : ''}">${svState().available ? '已连接' : '离线'}</span></div>
          <div class="small muted">${svState().available ? '身份、素材、拆解报告与混剪任务由服务端统一管理；后台可配置数据源、成员与配额。' : '当前为静态备份站，工程保存在本机浏览器；管理后台可导出快照提交到仓库。'}</div></div>`,
      actions:[
        { label:'修改密码', close:false, onClick:(close)=>{ close(); openChangePassword(); } },
        { label:'退出登录', onClick:async()=>{ await svLogout(); clearSession(); logAccess('退出登录'); location.hash='#/home'; location.reload(); } },
        { label:'关闭', primary:true },
      ] });
  };
  $('#sideMore').onclick = () => $('#btnHelp').click();
  const chip = $('.cloud-chip');
  if (chip) {
    chip.style.cursor = 'pointer';
    chip.onclick = () => {
      const signed = !!bus.cloudSession;
      modal({
        title:'数据与存储说明', desc:'本地工程 + 云端原视频',
        body:`<div class="block"><div class="block-head"><b>本机工程</b></div><div class="small muted">文案、四轨剪辑工程、拆解与自检状态保存在浏览器 localStorage，刷新不丢失；「管理后台 → 数据快照」可导出 JSON 随仓库版本化。</div></div>
          <div class="block"><div class="block-head"><b>云端原视频</b></div><div class="small muted">「素材库 → 上传原视频」会把视频文件存入应用云存储，元数据进入云数据库。上传与播放需要登录 WorkBuddy 账号；未登录不影响其他功能。</div></div>
          <div class="notice-box">${staticFallback ? esc(cloudNotice) : (cloudEnabled ? (signed ? '当前已登录云端账号。' : '当前未登录云端账号，上传时会提示登录。') : '云服务 SDK 未加载，请检查网络后刷新。')}</div>`,
        actions: signed
          ? [{ label:'退出云端账号', onClick:async()=>{ await signOutCloud(); bus.cloudSession=null; updateCloudChip(); location.reload(); } },{ label:'关闭',primary:true }]
          : (cloudEnabled && !staticFallback
              ? [{ label:'关闭' },{ label:'使用 WorkBuddy 登录',primary:true,onClick:async()=>{ const r=await startCloudLogin(); if(r.error) toast('登录未启动',r.error.message,'error'); } }]
              : [{ label:'关闭',primary:true }]),
      });
    };
  }
}

wireChrome();
boot();
