import { icon } from '../icons.js';
import { RADAR, trackOf } from '../data.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, copyText, downloadFile, confirmDlg, fmtNum } from '../ui.js';

const TABS = [['all','全部'],['script','文案'],['breakdown','拆解'],['project','工程'],['film','成片'],['creator','达人视频'],['fav','收藏']];
const CLIP_N = 5;

// 抽取候选：按热度 Top5 或用可复现的伪随机打乱抽 5 条（seed 变化 = 换一批）
function pickClipIds(mode, seed) {
  if (mode === 'heat') return RADAR.slice().sort((a, b) => b.heat - a.heat).slice(0, CLIP_N).map(r => r.id);
  let s = (seed || 1) % 233280;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const arr = RADAR.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, CLIP_N).map(r => r.id);
}

function clipText(r) {
  return `${r.author} · ${trackOf(r.track).name} · ${r.dur}\n` +
    `钩子：${r.hook}\n痛点：${r.pain}\n证据：${r.proof}\nCTA：${r.cta}\n` +
    `播放 ${fmtNum(r.views)} · 收藏 ${fmtNum(r.saves)} · 热度 ${r.heat} · 带货：${r.product}`;
}

function openClipPicker(onDone) {
  let mode = 'heat', seed = Date.now() % 233280 + 1;
  const ids = () => pickClipIds(mode, seed);
  const paint = (mroot) => {
    const box = $('#clipPreview', mroot);
    if (!box) return;
    box.innerHTML = ids().map((id, i) => {
      const r = RADAR.find(x => x.id === id), t = trackOf(r.track);
      return `<div class="clip-row">
        <span class="clip-thumb" style="background:${t.grad}">${t.emoji}</span>
        <div style="flex:1;min-width:0"><b class="small">${esc(r.title)}</b>
          <div class="small muted">${esc(r.author)} · ${esc(t.name)} · ${r.dur} · ${fmtNum(r.views)} 播放 · 热度 ${r.heat}</div></div>
        <span class="badge ${i ? 'gray' : ''}">${i + 1}</span></div>`;
    }).join('');
    $('#clipModeInfo', mroot).textContent = mode === 'heat'
      ? '口径：按热度分从高到低取前 5 条达人发布视频。'
      : '口径：在 12 条达人发布视频里随机抽 5 条，点「换一批」可重抽。';
  };
  return modal({
    title:'抽取达人视频到素材库',
    desc:'从爆款雷达里已发布的达人内容中抽取 5 条，入库后可预览结构、拆解、写文案',
    body:`<div class="row row-wrap" style="gap:6px">
        <button class="chip active" data-cmode="heat" type="button">${icon('chart',13)} 按热度 Top5</button>
        <button class="chip" data-cmode="random" type="button">${icon('target',13)} 随机抽 5 条</button>
        <span class="spacer"></span>
        <button class="btn btn-sm" id="btnRedraw" type="button">${icon('refresh',13)} 换一批</button>
      </div>
      <div class="field-hint" id="clipModeInfo"></div>
      <div id="clipPreview"></div>
      <div class="notice-box" style="margin-top:10px">入库会替换当前达人视频素材（其他文案 / 工程 / 成片不受影响）。这里保存的是结构化参考卡：作者、赛道、时长、播放收藏、钩子与 CTA，不存放也不外链原始视频文件。</div>`,
    actions:[{ label:'取消' }, { label:`抽取 ${CLIP_N} 条入库`, primary:true, onClick:() => {
      store.set('creatorClips', ids());
      toast('已抽取 5 条达人视频','素材库 · 达人视频分类可直接查看');
      onDone?.();
    }}],
    onMount:(mroot) => {
      $$('[data-cmode]', mroot).forEach(b => b.onclick = () => {
        mode = b.dataset.cmode; seed = Date.now() % 233280 + 1;
        $$('[data-cmode]', mroot).forEach(x => x.classList.toggle('active', x === b));
        paint(mroot);
      });
      $('#btnRedraw', mroot).onclick = () => {
        seed = (seed * 7 + 13) % 233280 + 1; mode = 'random';
        $$('[data-cmode]', mroot).forEach(x => x.classList.toggle('active', x.dataset.cmode === 'random'));
        paint(mroot);
      };
      paint(mroot);
    },
  });
}

function collect() {
  const out = [];
  store.get('scripts', []).forEach(s => out.push({
    id:s.id, type:'script', title:s.title, text:`${s.hook} ${s.body} ${s.cta}`,
    meta:`${trackOf(s.track).name} · ${s.duration}s · ${s.style}`, at:s.createdAt, raw:s }));
  store.get('assets', []).forEach(a => out.push({
    id:a.id, type:a.type === 'breakdown' ? 'breakdown' : 'script', title:a.title, text:a.text,
    meta:`${trackOf(a.track).name} · ${a.type === 'breakdown' ? '结构拆解' : '素材'}`, at:a.createdAt, raw:a }));
  store.get('projects', []).forEach(p => out.push({
    id:p.id, type:'project', title:p.name, text:`四轨工程 · ${p.duration}s · 视频 ${p.video.length} / 字幕 ${p.subtitle.length} / 音乐 ${p.music.length} / 转场 ${(p.fx||[]).length}`,
    meta:'剪辑工程', at:p.createdAt, raw:p }));
  store.get('autoJobs', []).forEach(j => out.push({
    id:j.id, type:'film', title:j.title, text:`智能成片 · ${j.duration}s · ${j.script?.hook || ''}`,
    meta:`${j.style} · 3 段字幕`, at:j.createdAt, raw:j }));
  store.get('works', []).forEach(w => out.push({
    id:w.id, type:'film', title:w.title, text:'已导出成片记录', meta:trackOf(w.track).name + ' · 成片', at:w.createdAt, raw:w }));
  const clips = [];
  store.get('creatorClips', []).forEach(id => {
    const r = RADAR.find(x => x.id === id);
    if (!r) return;
    clips.push({ id:'clip-' + id, type:'creator', title:r.title,
      text:`${r.author} · ${r.hook}`, full:clipText(r),
      meta:`达人发布 · ${trackOf(r.track).name} · ${r.dur}`, at:'达人发布', raw:r, radarId:id });
  });
  const fav = store.get('favorites', []);
  RADAR.filter(r => fav.includes(r.id)).forEach(r => out.push({
    id:r.id, type:'fav', title:r.title, text:r.hook, meta:`${trackOf(r.track).name} · 热度 ${r.heat}`, at:'爆款雷达', raw:r }));
  return [...clips, ...out]; // 达人视频置顶，进入素材库即可看到本次抽取的 5 条
}

export default {
  render() {
    return `
    ${pageHead('素材库','文案、结构拆解、剪辑工程、成片与达人视频统一收纳，可复制、导出、复用',
      `<button class="btn" id="btnDrawClips">${icon('target',14)} 抽取达人视频</button>
       <button class="btn" id="btnNewAsset">${icon('plus',14)} 新建素材</button>
       <button class="btn btn-primary" id="btnGoScript">${icon('file',14)} 去写文案</button>`)}
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="row row-wrap">
        <div style="position:relative;flex:1;min-width:210px"><input class="input" id="libSearch" placeholder="搜索标题或内容…" style="padding-left:34px" />
          <span style="position:absolute;left:11px;top:9px;color:var(--ink-3)">${icon('search',15)}</span></div>
        <div class="tabs" id="libTabs">${TABS.map(([v,l])=>`<button class="tab ${v==='all'?'active':''}" data-tab="${v}">${l}</button>`).join('')}</div>
        <span class="small muted" id="libCount"></span>
      </div>
      <div class="row row-wrap" style="gap:8px;margin-top:11px;padding-top:10px;border-top:1px dashed var(--line)">
        <span class="badge" id="clipBadge">达人视频 ${store.get('creatorClips',[]).length} 条</span>
        <span class="small muted">从爆款雷达抽取的达人发布视频，可预览结构 / 拆解 / 写文案，刷新不丢失</span>
        <span class="spacer"></span>
        <button class="btn btn-sm" id="btnDrawClipsInline">${icon('refresh',13)} 重新抽取 5 条</button>
      </div>
    </div>
    <div class="lib-grid" id="libGrid"></div>`;
  },

  mount(root) {
    let tab = 'all', q = '';
    const draw = () => {
      let list = collect();
      if (tab !== 'all') list = list.filter(x => x.type === tab);
      if (q) list = list.filter(x => (x.title + x.text + x.meta + (x.full || '')).toLowerCase().includes(q.toLowerCase()));
      $('#libCount', root).textContent = `${list.length} 条`;
      $('#clipBadge', root).textContent = `达人视频 ${store.get('creatorClips',[]).length} 条`;
      $('#libGrid', root).innerHTML = list.length ? list.map(x => {
        const badge = { script:['blue','文案'], breakdown:['purple','拆解'], project:['amber','工程'], film:['','成片'], creator:['blue','达人视频'], fav:['rose','收藏'] }[x.type] || ['gray','素材'];
        const r = x.type === 'creator' ? x.raw : null;
        const t = r ? trackOf(r.track) : null;
        const thumb = r ? `<div class="creator-thumb" style="background:${t.grad}">
            <span class="ct-emoji">${r.emoji}</span>
            <span class="ct-play">${icon('play',14)}</span>
            <span class="ct-dur">${esc(r.dur)}</span>
            <span class="ct-author">${esc(r.author)}</span></div>` : '';
        const metrics = r ? `<div class="clip-metrics"><span>${fmtNum(r.views)} 播放</span><span>${fmtNum(r.saves)} 收藏</span><span>热度 ${r.heat}</span></div>` : '';
        const actions = r ? `<div class="row" style="gap:5px;margin-top:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-soft" data-clip-view="${x.id}">看结构</button>
            <button class="btn btn-sm" data-clip-break="${x.id}">拆解</button>
            <button class="btn btn-sm" data-clip-script="${x.id}">写文案</button></div>` : '';
        return `<div class="lib-card" data-card="${x.id}" data-type="${x.type}">
          <div class="row" style="justify-content:space-between"><span class="badge ${badge[0]}">${badge[1]}</span><span class="small muted">${esc(String(x.at).slice(0,10))}</span></div>
          ${thumb}
          <div class="lib-title" style="margin-top:9px">${esc(x.title)}</div>
          <div class="lib-text">${esc(x.text)}</div>
          <div class="small muted" style="margin-top:6px">${esc(x.meta)}</div>
          ${metrics}${actions}
          <div class="lib-foot">
            <button class="btn btn-sm" data-copy="${x.id}">${icon('copy',12)} 复制</button>
            <button class="btn btn-sm btn-ghost" data-export="${x.id}">${icon('download',12)}</button>
            <button class="btn btn-sm btn-ghost" data-del="${x.id}" title="删除">${icon('trash',12)}</button>
          </div>
        </div>`;
      }).join('') : '<div class="empty" style="grid-column:1/-1">没有匹配的素材</div>';

      const all = collect();
      $$('[data-copy]', root).forEach(b=>b.onclick=()=>{
        const x = all.find(y=>y.id===b.dataset.copy);
        copyText(`${x.title}\n\n${x.full || x.text}`, x.title);
      });
      $$('[data-export]', root).forEach(b=>b.onclick=()=>{
        const x = all.find(y=>y.id===b.dataset.export);
        downloadFile(`${x.title.slice(0,16)}.txt`, `${x.title}\n${x.meta}\n\n${x.full || x.text}\n`);
      });
      $$('[data-clip-view]', root).forEach(b=>b.onclick=()=>{
        const x = all.find(y=>y.id===b.dataset.clipView), r = x.raw;
        modal({ title:r.title, desc:`${r.author} · ${r.dur} · ${fmtNum(r.views)} 播放 · 热度 ${r.heat}`,
          body:`<div class="preview" style="aspect-ratio:16/7"><div class="pv-grid"></div><div class="pv-inner">${icon('video',40)}<b>结构预览（不外链原视频）</b><span class="pv-sub">素材库保存的是这条达人视频的可复用骨架</span></div></div>
            <div style="margin-top:14px">
              <div class="block"><div class="block-head"><b>钩子</b><span class="badge">前 3 秒</span></div><p>${esc(r.hook)}</p></div>
              <div class="block"><div class="block-head"><b>痛点</b></div><p>${esc(r.pain)}</p></div>
              <div class="block"><div class="block-head"><b>证据</b></div><p>${esc(r.proof)}</p></div>
              <div class="block"><div class="block-head"><b>带货 / 卖点</b></div><p>${esc(r.product)}</p></div>
              <div class="block"><div class="block-head"><b>CTA</b></div><p>${esc(r.cta)}</p></div></div>`,
          actions:[{ label:'去拆解', onClick:()=>bus.navigate('breakdown',{radar:r.id}) },
                   { label:'写文案', primary:true, onClick:()=>bus.navigate('script',{radar:r.id}) }] });
      });
      $$('[data-clip-break]', root).forEach(b=>b.onclick=()=>{
        const x = all.find(y=>y.id===b.dataset.clipBreak);
        bus.navigate('breakdown',{radar:x.radarId});
      });
      $$('[data-clip-script]', root).forEach(b=>b.onclick=()=>{
        const x = all.find(y=>y.id===b.dataset.clipScript);
        bus.navigate('script',{radar:x.radarId});
      });
      $$('[data-del]', root).forEach(b=>b.onclick=()=>{
        const x = all.find(y=>y.id===b.dataset.del);
        confirmDlg('删除这条素材？', `「${x.title}」将从本机删除，此操作不可撤销。`, () => {
          const map = { script:'scripts', breakdown:'assets', project:'projects', film:'autoJobs' };
          if (x.type === 'creator') store.set('creatorClips', store.get('creatorClips',[]).filter(id=>id!==x.radarId));
          else if (x.type === 'fav') store.set('favorites', store.get('favorites',[]).filter(f=>f!==x.id));
          else if (x.type === 'film') { store.remove('autoJobs', x.id); store.remove('works', x.id); }
          else { const key = map[x.type] || 'assets'; store.remove(key, x.id); }
          draw(); toast('已删除', x.title);
        }, '删除');
      });
    };

    const picker = () => openClipPicker(draw);
    $('#libSearch', root).oninput = e => { q = e.target.value.trim(); draw(); };
    $$('[data-tab]', root).forEach(b=>b.onclick=()=>{
      tab = b.dataset.tab;
      $$('[data-tab]', root).forEach(x=>x.classList.toggle('active', x===b));
      draw();
    });
    $('#btnGoScript', root).onclick = () => bus.navigate('script');
    $('#btnDrawClips', root).onclick = picker;
    $('#btnDrawClipsInline', root).onclick = picker;
    $('#btnNewAsset', root).onclick = () => modal({
      title:'新建素材', desc:'手动补充一条可复用内容',
      body:`<div class="field"><label class="field-label">标题</label><input class="input" id="naTitle" placeholder="例如：护肤类钩子模板" /></div>
        <div class="field"><label class="field-label">类型</label><select class="select" id="naType"><option value="script">文案</option><option value="breakdown">结构拆解</option></select></div>
        <div class="field"><label class="field-label">内容</label><textarea class="textarea" id="naText" placeholder="粘贴可复用的句子或结构"></textarea></div>`,
      actions:[{ label:'取消' },{ label:'保存', primary:true, onClick:()=>{
        const title = $('#naTitle').value.trim(), text = $('#naText').value.trim();
        if (!title || !text) { toast('标题和内容不能为空','请补齐后再保存','warn'); return false; }
        store.add('assets', { id:store.uid('a'), type:$('#naType').value, title, track:'knowledge', text, createdAt:store.now().slice(0,10) });
        draw(); toast('素材已保存');
      }}],
    });
    draw();
    if (bus.pending?.drawClips) {
      bus.pending = { ...bus.pending, drawClips:false }; // 一次性消费，避免之后每次进素材库都自动弹窗
      setTimeout(() => { if ($('#libGrid', root)) openClipPicker(draw); }, 160);
    }
  },
};
