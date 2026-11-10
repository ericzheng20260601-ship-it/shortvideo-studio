import { icon } from '../icons.js';
import { RADAR, TRACKS, trackOf } from '../data.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, fmtNum } from '../ui.js';
import { loadRadar, applyRadarItems, getEndpoint, setEndpoint, clearEndpoint, SOURCE_CONTRACT, SOURCE_LABEL } from '../radar-source.js';

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
          <div class="field-hint">留空则使用内置演示数据。这里应填你自建的服务端接口，不要填 TikTok 页面地址；浏览器直连公共页会被跨域与反爬拦截。仓库内 data/sample-radar.json 是返回格式样例。</div></div>
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
      if (act === 'play') {
        modal({ title:r.title, desc:`${r.author} · ${r.dur} · ${fmtNum(r.views)} 播放`,
          body:`<div class="preview" style="aspect-ratio:16/7"><div class="pv-grid"></div><div class="pv-inner">${icon('video',40)}<b>结构预览（不外链原视频）</b><span class="pv-sub">下方是这条内容的可复用骨架</span></div></div>
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
          body:`<div class="notice-box">${esc(INSIGHT[id] || '')}</div>
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
      toast(res.mode === 'demo' ? '榜单已刷新' : '数据源已重新拉取', res.note, res.mode === 'fallback' ? 'warn' : '');
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
