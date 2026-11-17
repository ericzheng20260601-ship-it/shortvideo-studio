import { icon } from '../icons.js';
import { RADAR, TRACKS, trackOf } from '../data.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, fmtNum } from '../ui.js';
import { loadRadar, applyRadarItems, getEndpoint, setEndpoint, clearEndpoint, addUserVideo, fetchOEmbed, removeUserVideo, SOURCE_CONTRACT, SOURCE_LABEL } from '../radar-source.js';

const SORTS = [['heat','按热度排序'],['views','按播放量排序'],['saves','按收藏排序']];
const INSIGHT = {
  r1:'问题开场 + 明确时长收益（安静 40 分钟），把「拆家」这个高频痛点和产品直接绑定；一镜到底降低制作门槛。',
  r2:'反常识开场（早 C 晚 A 不用那么复杂）先卸下观众负担，再用 28 天记录把可信度补上。',
  r3:'用「刚洗完衣服」这种通感描述香气，比香调名词更好转述；三支对比天然适合收藏。',
  r4:'先纠正错误动作（拽绳），再给可执行的三步递进，评论区自然追问后续。',
  r5:'9 秒一镜到底 + 价格锚点，短到没有跳出机会；「出门前」是极具体的场景。',
  r6:'把镜头对准配料表而不是产品，信任感来自「敢给你看背面」。',
  r7:'用「先停手」制造反直觉，再由专业身份承接解释，避免变成硬广。',
  r8:'安全类知识天然高收藏；给剂量对照而不是只喊有害，是它能被转发的关键。',
  r9:'纠正一个几乎人人都做错的小动作，成本极低、可立即验证。',
  r10:'先替观众解释「它躲你不是不喜欢你」，情绪价值先于方法论。',
  r11:'避坑清单自带收藏理由，第 3 种留悬念提升完播。',
  r12:'半脸对照是最短的可视化证据，把归因从产品转到方法。',
};

const state = { track:'all', sort:'heat', dur:'all', ai:'all', favOnly:false };

function seconds(dur) {
  const [m, s] = dur.split(':').map(Number);
  return m * 60 + s;
}
/* 原视频链接：外部数据源条目自带 sourceUrl；演示数据无真实链接，回退到 TikTok 站内搜索 */
const srcOf = r => r.sourceUrl || r.url || '';
const isDemoSample = src => src.startsWith('/'); // 相对路径 = 服务端托管的演示样片（非原视频）
const srcLinkOf = r => srcOf(r) || ('https://www.tiktok.com/search?q=' + encodeURIComponent(String(r.title || '').slice(0, 60)));
const srcLabelOf = r => isDemoSample(srcOf(r)) ? '演示样片：服务端托管的测试视频，非原视频' : srcOf(r) ? '打开原视频' : 'TikTok 搜索原视频（演示数据无直链）';
function filtered() {
  let list = RADAR.slice();
  if (state.track !== 'all') list = list.filter(r => r.track === state.track);
  if (state.dur === 'short') list = list.filter(r => seconds(r.dur) <= 30);
  if (state.dur === 'mid') list = list.filter(r => seconds(r.dur) > 30 && seconds(r.dur) <= 60);
  if (state.dur === 'long') list = list.filter(r => seconds(r.dur) > 60);
  if (state.ai === 'ai') list = list.filter(r => r.ai);
  if (state.ai === 'human') list = list.filter(r => !r.ai);
  if (state.favOnly) { const fav = store.get('favorites', []); list = list.filter(r => fav.includes(r.id)); }
  const key = state.sort === 'views' ? 'views' : state.sort === 'saves' ? 'saves' : 'heat';
  return list.sort((a, b) => b[key] - a[key]);
}

function cardHTML(r) {
  const t = TRACKS.find(x => x.id === r.track) || TRACKS[0];
  const fav = store.get('favorites', []).includes(r.id);
  const miss = r._missing || [];
  const views = miss.includes('views') ? '—' : fmtNum(r.views);
  const saves = miss.includes('saves') ? '—' : fmtNum(r.saves);
  const sales = miss.includes('views') ? '—' : fmtNum(Math.round(r.views * 0.0042));
  const heat = r.heat ? String(r.heat) : '—';
  return `<div class="radar-card" data-id="${r.id}">
    <div class="radar-cover" style="background:${t.grad}">
      <span class="cover-emoji">${t.emoji}</span>
      <div class="cover-top"><span class="cover-pill">${r.dur}</span>
        <button class="fav-btn ${fav?'on':''}" data-act="fav" data-id="${r.id}" title="${fav?'取消收藏':'收藏'}">${icon('heart',14)}</button></div>
      <button class="play-btn" data-act="play" data-id="${r.id}" title="预览结构">${icon('play',17)}</button>
      <div class="cover-bottom"><span class="cover-tag">${esc(r.author)}</span>${r.ad?'<span class="cover-tag">AD</span>':''}${r.ai?'<span class="cover-tag">AI</span>':''}</div>
    </div>
    <div class="radar-body">
      <div class="radar-title tooltip" data-tip="${esc(r.title)}">${esc(r.title)}</div>
      <div class="row" style="gap:5px;margin-top:7px;flex-wrap:wrap">${r.tags.map(x=>`<span class="badge gray">${esc(x)}</span>`).join('')}<span class="badge">${esc(t.name)}</span></div>
      <div class="radar-metrics">
        <div class="metric"><b>${views}</b><span>播放量</span></div>
        <div class="metric"><b>${saves}</b><span>收藏</span></div>
        <div class="metric"><b>${sales}</b><span>销量估算</span></div>
      </div>
      <div class="heat"><span class="small muted">热度分</span><div class="heat-bar"><i style="width:${r.heat || 0}%"></i></div><b>${heat}</b></div>
      <div class="radar-actions">
        <button class="btn btn-sm" data-act="insight" data-id="${r.id}">看新解</button>
        <button class="btn btn-sm" data-act="break" data-id="${r.id}">拆解</button>
        <button class="btn btn-sm btn-soft" data-act="script" data-id="${r.id}">写文案</button>
        <a class="btn btn-sm btn-ghost" href="${esc(srcLinkOf(r))}" target="_blank" rel="noopener noreferrer" title="${esc(srcLabelOf(r))}">${icon('external', 12)} ${r._user ? '打开视频' : '原视频'}</a>
        ${r._user ? `<button class="btn btn-sm btn-ghost" data-act="remove" data-id="${r.id}" title="从雷达列表移除">${icon('x', 12)} 移除</button>` : ''}
      </div>
    </div>
  </div>`;
}

export default {
  render() {
    const preset = bus.pending?.track;
    if (preset && TRACKS.some(t => t.id === preset)) state.track = preset;
    return `
    ${pageHead('爆款雷达','探索 TikTok 上正在流行的带货内容，按热度找方向',
      `<button class="btn" id="btnDataSource">${icon('cloud',14)} 数据源</button>
       <button class="btn" id="btnToLibrary">${icon('folder',14)} 抽取 5 条到素材库</button>
       <button class="btn" id="btnRefresh">${icon('refresh',14)} 刷新榜单</button>
       <button class="btn btn-primary" id="btnPick">${icon('target',14)} 按赛道抽签</button>`)}
    <div class="filter-bar">
      <span class="f-label">赛道</span>
      <button class="chip ${state.track==='all'?'active':''}" data-track="all">全部</button>
      ${TRACKS.map(t=>`<button class="chip ${state.track===t.id?'active':''}" data-track="${t.id}">${t.emoji} ${esc(t.name)}</button>`).join('')}
    </div>
    <div class="filter-bar" style="margin-top:-6px">
      <span class="f-label">筛选</span>
      <select class="mini-select" id="sortSel">${SORTS.map(([v,l])=>`<option value="${v}" ${state.sort===v?'selected':''}>${l}</option>`).join('')}</select>
      <select class="mini-select" id="durSel"><option value="all">时长不限</option><option value="short">≤ 30s</option><option value="mid">31–60s</option><option value="long">&gt; 60s</option></select>
      <select class="mini-select" id="aiSel"><option value="all">是否 AI · 全部</option><option value="ai">AI 生成</option><option value="human">真人实拍</option></select>
      <button class="chip ${state.favOnly?'active':''}" id="favOnly">${icon('bookmark',13)} 只看收藏</button>
      <button class="chip" id="btnAddVideo">${icon('plus',13)} 添加视频链接</button>
      <span class="spacer"></span>
      <span class="small muted" id="radarCount"></span>
      <span class="badge amber" id="radarSource" style="cursor:pointer" title="查看数据源状态与字段契约">演示数据 · 结构化样例</span>
    </div>
    <div class="radar-grid" id="radarGrid"></div>`;
  },

  async mount(root) {
    const grid = $('#radarGrid', root);
    let info = { mode:'demo', note:'演示数据 · 结构化样例', error:null };
    const draw = () => {
      const list = filtered();
      const label = SORTS.find(s => s[0] === state.sort)?.[1] || '按热度排序';
      $('#radarCount', root).textContent = `共 ${list.length} 条 · ${label}`;
      const [text, cls] = SOURCE_LABEL[info.mode] || SOURCE_LABEL.demo;
      const badge = $('#radarSource', root);
      if (badge) { badge.textContent = text; badge.className = `badge ${cls}`; badge.title = info.note; }
      grid.innerHTML = list.length ? list.map(cardHTML).join('') : '<div class="empty" style="grid-column:1/-1">没有符合条件的条目，换个筛选试试</div>';
    };
    const openSource = () => modal({
      title:'爆款雷达 · 数据源', desc:'演示数据与授权数据源之间的适配层', wide:true,
      body:`<div class="notice-box">当前状态：${esc(info.note)}${info.error ? `（${esc(info.error)}）` : ''}</div>
        <div class="divider"></div>
        <div class="field"><label class="field-label" for="dsEndpoint">合规数据代理地址（返回 JSON 数组）</label>
          <input class="input" id="dsEndpoint" placeholder="https://your-api.example/radar.json" value="${esc(getEndpoint())}" />
          <div class="field-hint">留空则自动拉取 YouTube 真实数据（管理后台配置 radar.youtubeKey 走官方 API；不配置走开源 Invidious 公共实例，免 Key）。也可填你自建的服务端接口，不要填 TikTok 页面地址；浏览器直连公共页会被跨域与反爬拦截。</div></div>
        <div class="divider"></div>
        <div class="block"><div class="block-head"><b>字段契约</b><span class="badge">${SOURCE_CONTRACT.length} 项</span></div>
          ${SOURCE_CONTRACT.map(([f,d,n]) => `<div class="clip-row" style="margin-bottom:5px"><span class="badge gray" style="flex:none">${esc(f)}</span><div style="flex:1;min-width:0"><b class="small">${esc(d)}</b><div class="small muted">${esc(n)}</div></div></div>`).join('')}
        </div>
        <div class="notice-box" style="margin-top:10px">合规边界：TikTok 服务条款禁止未经书面批准的自动化提取；Research API 不提供播放量、收藏数与视频文件。本站不内置采集器。接入前请先确定官方批准的数据源或已获授权的数据供应商，并确认字段口径（缺失的指标会显示 —）。达人原视频只保留链接与元数据，不下载转存。</div>`,
      actions:[
        { label:'恢复演示数据', onClick:()=>{ clearEndpoint(); location.reload(); } },
        { label:'取消' },
        { label:'保存并刷新', primary:true, onClick:()=>{
          const v = ($('#dsEndpoint')?.value || '').trim();
          if (v && !/^https?:\/\//i.test(v)) { toast('地址格式不正确', '请填写 http(s):// 开头的接口地址', 'warn'); return false; }
          setEndpoint(v); location.reload();
        }},
      ],
    });
    $('#btnDataSource', root).onclick = openSource;
    $('#radarSource', root).onclick = openSource;

    /* 手动添加视频链接：粘贴公开视频页 URL → 官方 oEmbed 取元数据（尽力而为）→ 入列表，播放走内嵌播放器 */
    const openAddVideo = () => modal({
      title:'添加爆款视频', desc:'粘贴 TikTok / YouTube 公开视频页链接，点开后在本页内嵌播放', wide:true,
      body:`<div class="field"><label class="field-label" for="avUrl">视频链接</label>
          <input class="input" id="avUrl" placeholder="https://www.tiktok.com/@用户名/video/1234567890 或 https://www.youtube.com/watch?v=..." />
          <div class="field-hint">TikTok 需标准视频页链接（不支持 vm.tiktok.com 短链，请先在浏览器打开后复制地址栏）；只保存链接与官方元数据，不下载转存视频。</div></div>
        <div class="field" style="margin-top:8px"><label class="field-label" for="avTrack">赛道归类</label>
          <select class="select" id="avTrack">${TRACKS.map(([v, l]) => `<option value="${v}" ${v === 'knowledge' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="notice-box" style="margin-top:10px">添加后条目会出现在雷达列表顶部；标题/作者/封面通过平台官方 oEmbed 接口获取（若网络无法访问平台则显示占位文案，不影响内嵌播放）。播放量等指标需接入数据源后按同一口径替换。</div>`,
      actions:[
        { label:'取消' },
        { label:'添加', primary:true, onClick:async () => {
          const v = ($('#avUrl')?.value || '').trim();
          if (!v) { toast('请粘贴视频链接', '', 'warn'); return false; }
          const en = await fetchOEmbed(v);
          const res = addUserVideo(v, { title: en?.title, author: en?.author, cover: en?.cover, track: $('#avTrack')?.value });
          if (!res.ok) { toast('无法添加', res.error, 'warn'); return false; }
          const fres = await loadRadar();
          applyRadarItems(fres.items);
          info = fres; draw();
          toast('已添加到雷达列表', en ? '元数据已通过官方 oEmbed 获取，点播放即内嵌播放' : '已保存链接（网络原因未取到元数据），点播放即内嵌播放');
        }},
      ],
    });
    $('#btnAddVideo', root).onclick = openAddVideo;

    grid.onclick = e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.id, act = btn.dataset.act;
      const r = RADAR.find(x => x.id === id);
      if (!r) return;
      if (act === 'fav') {
        const fav = store.get('favorites', []);
        const had = fav.includes(id);
        store.set('favorites', had ? fav.filter(x => x !== id) : [...fav, id]);
        toast(had ? '已取消收藏' : '已加入收藏', '可在素材库查看');
        draw(); return;
      }
      if (act === 'remove') {
        modal({ title:'移除手动添加的视频', desc:r.title,
          body:'<div class="notice-box">只移除雷达列表中的条目记录，不影响平台上的原视频，也不删除任何成片。</div>',
          actions:[{ label:'取消' }, { label:'移除', primary:true, onClick:async () => {
            removeUserVideo(id);
            const fres = await loadRadar();
            applyRadarItems(fres.items);
            info = fres; draw();
            toast('已移除', '', '');
          }}] });
        return;
      }
      if (act === 'play') {
        /* 播放按数据源能力分四级：
           ① TikTok 视频页链接 → 官方 embed iframe 内嵌播放（无需 Key）
           ② YouTube 链接（含 Shorts）→ 官方 embed iframe 内嵌播放
           ③ 直接视频文件（.mp4/.webm/.ogg）→ 内联 <video> 播放
           ④ 只有平台短链或无链接（含演示数据）→ 结构预览 + 打开原视频/说明 */
        const src = srcOf(r);
        const ttId = src ? (src.match(/tiktok\.com\/(?:@[\w.\-]+)\/video\/(\d{6,})/) || [])[1] : null;
        const ytId = src ? (src.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/) || [])[1] : null;
        const direct = src && /\.(mp4|webm|ogg)(\?|#|$)/i.test(src);
        const embedNote = `<div class="small muted" style="margin-top:6px">内嵌播放器由平台官方提供；若浏览器无法访问该平台或视频非公开，请改用「打开原视频」。</div>`;
        let media;
        if (ttId) {
          media = `<div style="display:flex;justify-content:center"><iframe src="https://www.tiktok.com/embed/v2/${esc(ttId)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen scrolling="no" style="width:min(340px,100%);aspect-ratio:9/16;border:0;border-radius:12px;background:#000" title="TikTok 原视频内嵌播放"></iframe></div>${embedNote}`;
        } else if (ytId) {
          media = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(ytId)}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;background:#000" title="YouTube 原视频内嵌播放"></iframe>${embedNote}`;
        } else if (direct) {
          media = `<video controls autoplay playsinline src="${esc(src)}" style="width:100%;aspect-ratio:16/9;border-radius:12px;background:#000"></video>` +
            (isDemoSample(src) ? `<div class="small muted" style="margin-top:6px">正在播放的是服务端托管的演示样片（主题配音贴合该条目，画面非原视频）；接入真实数据源后，此处将内嵌播放原视频。</div>` : '');
        } else {
          media = `<div class="preview" style="aspect-ratio:16/7"><div class="pv-grid"></div><div class="pv-inner">${icon('video',40)}<b>结构预览</b><span class="pv-sub">${src ? '该链接为平台分享短链，无法直接内嵌播放；可点击下方按钮去原平台观看' : '演示数据为结构化样例，不含视频文件；接入真实数据源（TikTok/YouTube 视频链接或视频直链）后此处将内嵌直接播放'}</span></div></div>
            <div style="margin-top:10px"><a class="btn btn-sm" href="${esc(srcLinkOf(r))}" target="_blank" rel="noopener noreferrer">${icon('external', 12)} ${src ? '打开原视频 ↗' : '去 TikTok 搜索原视频 ↗'}</a> <span class="small muted">${srcLabelOf(r)}</span></div>`;
        }
        modal({ title:r.title, desc:`${r.author} · ${r.dur} · ${fmtNum(r.views)} 播放`,
          body:`${media}
            <div style="margin-top:14px"><div class="block"><div class="block-head"><b>钩子</b><span class="badge">前 3 秒</span></div><p>${esc(r.hook)}</p></div>
            <div class="block"><div class="block-head"><b>痛点</b></div><p>${esc(r.pain)}</p></div>
            <div class="block"><div class="block-head"><b>证据</b></div><p>${esc(r.proof)}</p></div>
            <div class="block"><div class="block-head"><b>CTA</b></div><p>${esc(r.cta)}</p></div></div>` });
        return;
      }
      if (act === 'break') { bus.navigate('breakdown', { radar:id }); return; }
      if (act === 'script') { bus.navigate('script', { radar:id }); return; }
      if (act === 'insight') {
        modal({ title:'看新解 · 为什么这条能跑起来', desc:r.title,
          body:`<div class="notice-box">${esc(INSIGHT[id] || '该条为真实数据，尚无人工拆解点评。可先看下方钩子与结构字段，或点「去拆解」用规则引擎生成。')}</div>
            <div class="divider"></div>
            <div class="grid g2"><div class="block"><div class="block-head"><b>钩子类型</b></div><p>${esc(r.hook)}</p></div>
            <div class="block"><div class="block-head"><b>可复用点</b></div><p>${esc(r.proof)} → ${esc(r.cta)}</p></div></div>
            <div class="divider"></div><div class="small muted">规则码 R-02：热度分由播放、收藏、增速三项加权；本页为结构化样例，接入数据源后按同一口径替换。</div>`,
          actions:[{ label:'去拆解', onClick:()=>bus.navigate('breakdown',{radar:id}) },{ label:'写文案', primary:true, onClick:()=>bus.navigate('script',{radar:id}) }] });
      }
    };

    $$('[data-track]', root).forEach(b => b.onclick = () => {
      state.track = b.dataset.track;
      $$('[data-track]', root).forEach(x => x.classList.toggle('active', x === b));
      draw();
    });
    $('#sortSel', root).onchange = e => { state.sort = e.target.value; draw(); };
    $('#durSel', root).onchange = e => { state.dur = e.target.value; draw(); };
    $('#aiSel', root).onchange = e => { state.ai = e.target.value; draw(); };
    $('#favOnly', root).onclick = () => { state.favOnly = !state.favOnly; $('#favOnly', root).classList.toggle('active', state.favOnly); draw(); };
    $('#btnToLibrary', root).onclick = () => {
      bus.navigate('library', { drawClips:true, track:state.track });
      toast('去素材库抽 5 条','可切换按热度或随机抽取','');
    };
    $('#btnRefresh', root).onclick = async () => {
      const res = await loadRadar({ force:true });
      applyRadarItems(res.items);
      info = res; draw();
      toast(res.mode === 'demo' ? '榜单已刷新' : '数据源已重新拉取', res.note, ['fallback'].includes(res.mode) ? 'warn' : '');
    };
    $('#btnPick', root).onclick = () => {
      const list = filtered();
      if (!list.length) { toast('没有可抽的条目','请放宽筛选','warn'); return; }
      const r = list[Math.floor(Math.random() * list.length)];
      const t = TRACKS.find(x => x.id === r.track);
      modal({ title:'今天先看这条', desc:`${t?.name || ''} · 热度分 ${r.heat}`,
        body:`<div class="block"><div class="block-head"><b>${esc(r.title)}</b></div><p>${esc(r.hook)}</p></div><div class="block"><div class="block-head"><b>动作建议</b></div><p>先拆解结构，再按同一骨架写一条自己赛道（${esc(t?.name||'')}）的稿子。</p></div>`,
        actions:[{ label:'去拆解', onClick:()=>bus.navigate('breakdown',{radar:idOf(r)}) },{ label:'去写文案', primary:true, onClick:()=>bus.navigate('script',{radar:idOf(r)}) }] });
    };
    draw();
    const res = await loadRadar();
    applyRadarItems(res.items);
    info = res;
    draw();
  },
};
function idOf(r) { return r.id; }
