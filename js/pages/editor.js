import { icon } from '../icons.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, downloadFile, pickFile, copyText } from '../ui.js';

const LANES = [
  { key:'video',    name:'视频轨道', ico:'video',    cls:'c-video' },
  { key:'subtitle', name:'字幕轨道', ico:'subtitle', cls:'c-sub' },
  { key:'music',    name:'音乐轨道', ico:'music',    cls:'c-music' },
  { key:'fx',       name:'转场 / 特效', ico:'fx',    cls:'c-fx' },
];

function project(id) {
  const list = store.get('projects', []);
  return list.find(p => p.id === id) || list[0] || null;
}
function save(p) { store.update('projects', p.id, p); }
function clipHTML(c, lane, dur) {
  const left = Math.max(0, Math.min(100, c.start / dur * 100));
  const width = Math.max(3, Math.min(100 - left, c.len / dur * 100));
  return `<div class="tl-clip ${lane.cls} abs" data-clip="${c.id}" data-lane="${lane.key}"
    style="position:absolute;top:3px;left:${left}%;width:${width}%;height:28px"
    title="${esc(c.label)} · ${c.start}s–${c.start + c.len}s">${esc(c.label)}</div>`;
}

export default {
  render() {
    const preset = bus.pending?.project;
    const list = store.get('projects', []);
    const p = project(preset) || list[0];
    return `
    ${pageHead('在线剪辑台','四条按秒铺开的轨道，工程自动保存，刷新不丢失',
      `<button class="btn" id="btnNewProj">${icon('plus',14)} 新建工程</button>
       <button class="btn" id="btnImportProj">${icon('upload',14)} 导入工程</button>
       <button class="btn btn-primary" id="btnExportFilm">${icon('send',14)} 导出成片并送去评估</button>`)}
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="row row-wrap">
        <span class="small muted">当前工程</span>
        <select class="mini-select" id="projSel" style="min-width:190px">${list.map(x=>`<option value="${x.id}" ${p&&x.id===p.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
        <span class="badge">${icon('cloud',12)} 自动保存</span>
        <span class="spacer"></span>
        <button class="btn btn-sm" id="btnExportProj">${icon('download',13)} 导出工程 JSON</button>
        <button class="btn btn-sm btn-ghost tooltip" data-tip="工程快照可提交到仓库">${icon('info',13)}</button>
      </div>
    </div>
    <div class="split" style="grid-template-columns:1.05fr .95fr">
      <div class="card card-pad">
        <div class="card-title"><h3>画面预览</h3><span class="sub" id="pvDur">—</span></div>
        <div class="preview" id="preview">
          <div class="pv-grid"></div>
          <div class="pv-inner">${icon('video',40)}<b id="pvTitle">工程预览</b><span class="pv-sub">按时间线同步画面与字幕</span></div>
          <div class="pv-caption" id="pvCaption">字幕将在播放时同步显示</div>
        </div>
        <div class="player-bar">
          <button class="icon-btn" id="btnPlay" title="播放">${icon('play',15)}</button>
          <span id="pvTime">0.0s / 30.0s</span>
          <div class="track-line" id="seekBar"><i id="seekFill"></i></div>
          <span class="small muted">16:9 · 1080P</span>
        </div>
      </div>
      <div class="card card-pad">
        <div class="card-title"><h3>工程信息</h3><span class="badge blue">规则码 E-01</span></div>
        <div id="projInfo"></div>
        <div class="divider"></div>
        <div class="row row-wrap">
          <button class="btn btn-soft" id="btnImportSub">${icon('fileText',13)} 从文案导入字幕</button>
          <button class="btn" id="btnAddClip">${icon('plus',13)} 添加片段</button>
        </div>
        <button class="btn btn-soft btn-block collapse-btn" style="margin-top:12px" data-collapse="editorHelp">${icon('chevronDown',13)} 展开工程保存说明</button>
        <div class="collapse" id="editorHelp"><div class="notice-box" style="margin-top:10px">
          每次增删改片段都会立刻写入本机浏览器，刷新页面不丢失。静态站点无法由浏览器直接写入仓库；点「导出工程 JSON」或到「管理后台 → 数据快照」导出后提交到仓库，即可随代码版本化。
        </div></div>
      </div>
    </div>

    <div class="timeline">
      <div class="card-title"><h3>时间线</h3><span class="sub">点击片段可编辑起止；刻度单位为秒</span></div>
      <div class="tl-ruler" id="tlRuler"></div>
      <div id="tlRows"></div>
      <div class="tl-foot">
        <button class="btn btn-sm" id="btnAddClip2">${icon('plus',13)} 添加片段</button>
        <button class="btn btn-sm" id="btnImportSub2">${icon('fileText',13)} 从文案导入字幕</button>
        <button class="btn btn-sm" id="btnAutoAlign">${icon('zap',13)} 一键对齐三段结构</button>
        <span class="spacer"></span>
        <span class="small muted" id="clipCount"></span>
      </div>
      <div id="inspector"></div>
    </div>`;
  },

  mount(root) {
    let pid = $('#projSel', root)?.value || bus.pending?.project;
    let p = project(pid);
    let selected = null, playing = false, t = 0, raf = null, lastTs = 0;

    const infoHTML = () => {
      const counts = LANES.map(l => `${l.name.replace('轨道','')} ${(p[l.key]||[]).length}`).join(' · ');
      return `<div class="suggest-row"><span>工程名称</span><b>${esc(p.name)}</b></div>
        <div class="suggest-row"><span>总时长</span><b>${p.duration}s</b></div>
        <div class="suggest-row"><span>片段构成</span><b style="font-size:11.5px">${counts}</b></div>
        <div class="suggest-row"><span>创建时间</span><b>${esc(p.createdAt)}</b></div>
        <div class="suggest-row"><span>建议画幅</span><b>16:9 · 1080P · 30fps</b></div>`;
    };

    const draw = () => {
      p = project(pid) || store.get('projects', [])[0];
      if (!p) { $('#tlRows', root).innerHTML = '<div class="empty">还没有工程，点右上角「新建工程」</div>'; return; }
      pid = p.id;
      const dur = p.duration;
      $('#pvDur', root).textContent = `${dur}s · 1080P`;
      $('#pvTitle', root).textContent = p.name;
      $('#projInfo', root).innerHTML = infoHTML();
      const ticks = 6;
      $('#tlRuler', root).innerHTML = `<span>轨道 / 秒</span>${Array.from({length:ticks},(_,i)=>`<span>${Math.round((i+1)*dur/ticks)}s</span>`).join('')}`;
      $('#tlRows', root).innerHTML = LANES.map(l => `<div class="tl-row">
        <div class="small muted" style="display:flex;align-items:center;gap:5px">${icon(l.ico,13)} ${l.name}</div>
        <div class="tl-lane" style="position:relative">${(p[l.key]||[]).map(c=>clipHTML(c,l,dur)).join('')}</div>
      </div>`).join('');
      const total = LANES.reduce((s,l)=>s+(p[l.key]||[]).length,0);
      $('#clipCount', root).textContent = `共 ${total} 个片段`;
      $('#pvTime', root).textContent = `0.0s / ${dur}.0s`;
      $('#projSel', root).value = p.id;
      if (!Array.from($('#projSel', root).options).some(o=>o.value===p.id)) {
        const opt = document.createElement('option'); opt.value=p.id; opt.textContent=p.name; $('#projSel',root).appendChild(opt); $('#projSel',root).value=p.id;
      }
    };

    const inspector = () => {
      if (!selected) { $('#inspector', root).innerHTML = ''; return; }
      const { lane, id } = selected;
      const c = (p[lane]||[]).find(x=>x.id===id);
      if (!c) { $('#inspector',root).innerHTML=''; return; }
      $('#inspector', root).innerHTML = `<div class="card card-pad" style="margin-top:14px;background:var(--surface-soft)">
        <div class="card-title"><h3>编辑片段</h3><span class="sub">${esc(LANES.find(l=>l.key===lane).name)}</span></div>
        <div class="grid g3" style="gap:10px">
          <div class="field" style="margin:0"><label class="field-label">片段名称</label><input class="input" id="ciLabel" value="${esc(c.label)}" /></div>
          <div class="field" style="margin:0"><label class="field-label">起始（秒）</label><input class="input" id="ciStart" type="number" min="0" max="${p.duration-1}" value="${c.start}" /></div>
          <div class="field" style="margin:0"><label class="field-label">时长（秒）</label><input class="input" id="ciLen" type="number" min="1" max="${p.duration}" value="${c.len}" /></div>
        </div>
        <div class="row row-wrap" style="margin-top:11px">
          <button class="btn btn-sm btn-primary" id="ciSave">保存修改</button>
          <button class="btn btn-sm btn-danger" id="ciDel">删除片段</button>
          <button class="btn btn-sm btn-ghost" id="ciClose">关闭</button>
        </div></div>`;
      $('#ciSave', root).onclick = () => {
        c.label = $('#ciLabel',root).value.trim() || c.label;
        c.start = Math.max(0, Math.min(p.duration-1, Number($('#ciStart',root).value)||0));
        c.len = Math.max(1, Math.min(p.duration-c.start, Number($('#ciLen',root).value)||1));
        save(p); draw(); inspector(); toast('片段已更新','工程已自动保存');
      };
      $('#ciDel', root).onclick = () => {
        p[lane] = p[lane].filter(x=>x.id!==id); save(p); selected=null; draw(); inspector(); toast('片段已删除');
      };
      $('#ciClose', root).onclick = () => { selected=null; inspector(); $$('.tl-clip',root).forEach(x=>x.classList.remove('selected')); };
    };

    $('#tlRows', root).onclick = e => {
      const el = e.target.closest('[data-clip]');
      if (!el) return;
      selected = { lane:el.dataset.lane, id:el.dataset.clip };
      $$('.tl-clip', root).forEach(x=>x.style.outline = x===el ? '2px solid #fff' : 'none');
      inspector();
    };

    const addClip = () => modal({
      title:'添加片段', desc:'选择轨道、起始与时长',
      body:`<div class="field"><label class="field-label">轨道</label><select class="select" id="acLane">${LANES.map(l=>`<option value="${l.key}">${l.name}</option>`).join('')}</select></div>
        <div class="field"><label class="field-label">片段名称</label><input class="input" id="acLabel" value="新片段" /></div>
        <div class="grid g2"><div class="field"><label class="field-label">起始（秒）</label><input class="input" id="acStart" type="number" value="0" min="0" /></div>
        <div class="field"><label class="field-label">时长（秒）</label><input class="input" id="acLen" type="number" value="5" min="1" /></div></div>`,
      actions:[{ label:'取消' },{ label:'添加', primary:true, onClick:()=>{
        const lane = $('#acLane').value;
        const start = Math.max(0, Number($('#acStart').value)||0);
        const len = Math.max(1, Number($('#acLen').value)||1);
        p[lane] = p[lane] || [];
        p[lane].push({ id:store.uid('c'), label:$('#acLabel').value.trim()||'新片段', start, len });
        save(p); draw(); toast('已添加片段','工程已自动保存');
      }}],
    });
    $('#btnAddClip', root).onclick = addClip;
    $('#btnAddClip2', root).onclick = addClip;

    const importSub = () => {
      const scripts = store.get('scripts', []);
      if (!scripts.length) { toast('还没有口播文案','先去口播文案工坊生成一条','warn'); return; }
      modal({ title:'从文案导入字幕', desc:'按钩子 / 正文 / CTA 三段自动铺到字幕轨',
        body:`<div class="field"><label class="field-label">选择文案</label><select class="select" id="isScript">${scripts.map(s=>`<option value="${s.id}">${esc(s.title)} · ${s.duration}s</option>`).join('')}</select></div>
          <div class="notice-box">导入会覆盖当前字幕轨的三段，并按该文案时长重新对齐视频轨钩子 / 主内容 / CTA。</div>`,
        actions:[{ label:'取消' },{ label:'导入并对齐', primary:true, onClick:()=>{
          const s = scripts.find(x=>x.id===$('#isScript').value);
          if (!s) return;
          const dur = Math.max(9, Number(s.duration)||30);
          const h = Math.max(3, Math.round(dur*0.17)), c = Math.max(3, Math.round(dur*0.17)), b = dur-h-c;
          p.duration = dur; p.scriptId = s.id;
          p.subtitle = [
            { id:store.uid('t'), label:`钩子字幕 · ${s.hook.slice(0,10)}…`, start:0, len:h, text:s.hook },
            { id:store.uid('t'), label:'要点字幕 · 正文导入', start:h, len:b, text:s.body },
            { id:store.uid('t'), label:`CTA 字幕 · ${s.cta.slice(0,10)}…`, start:h+b, len:c, text:s.cta },
          ];
          p.video = [
            { id:store.uid('v'), label:'开场钩子', start:0, len:h },
            { id:store.uid('v'), label:'主内容', start:h, len:b },
            { id:store.uid('v'), label:'CTA', start:h+b, len:c },
          ];
          save(p); draw(); toast('字幕已导入',`共 3 段 · ${dur}s`);
        }}],
      });
    };
    $('#btnImportSub', root).onclick = importSub;
    $('#btnImportSub2', root).onclick = importSub;
    $('#btnAutoAlign', root).onclick = () => {
      const dur = p.duration, h = Math.max(3, Math.round(dur*0.17)), c = Math.max(3, Math.round(dur*0.17)), b = dur-h-c;
      const reshape = arr => arr.map((x,i) => ({ ...x, start:[0,h,h+b][Math.min(i,2)], len:[h,b,c][Math.min(i,2)] }));
      p.video = reshape(p.video.slice(0,3)); p.subtitle = reshape(p.subtitle.slice(0,3));
      save(p); draw(); toast('三段结构已对齐','钩子 / 主内容 / CTA 按 17% / 66% / 17% 分配');
    };

    const stop = () => { playing=false; cancelAnimationFrame(raf); $('#btnPlay',root).innerHTML = icon('play',15); };
    const frame = ts => {
      if (!playing) return;
      if (!lastTs) lastTs = ts;
      t += (ts - lastTs) / 1000; lastTs = ts;
      if (t >= p.duration) { t = 0; stop(); }
      const ratio = t / p.duration;
      $('#seekFill', root).style.width = (ratio*100)+'%';
      $('#pvTime', root).textContent = `${t.toFixed(1)}s / ${p.duration}.0s`;
      const cur = (p.subtitle||[]).find(c => t >= c.start && t < c.start + c.len);
      $('#pvCaption', root).textContent = cur ? (cur.text || cur.label) : '（无字幕）';
      if (playing) raf = requestAnimationFrame(frame);
    };
    $('#btnPlay', root).onclick = () => {
      if (playing) { stop(); return; }
      playing = true; lastTs = 0; $('#btnPlay',root).innerHTML = icon('pause',15);
      raf = requestAnimationFrame(frame);
    };
    $('#seekBar', root).onclick = e => {
      const rect = e.currentTarget.getBoundingClientRect();
      t = Math.max(0, Math.min(p.duration, (e.clientX - rect.left) / rect.width * p.duration));
      $('#seekFill',root).style.width = (t/p.duration*100)+'%';
      $('#pvTime',root).textContent = `${t.toFixed(1)}s / ${p.duration}.0s`;
    };

    $('#projSel', root).onchange = e => { pid = e.target.value; selected=null; inspector(); draw(); };
    $('#btnNewProj', root).onclick = () => modal({
      title:'新建剪辑工程', desc:'四轨时间线，创建后自动保存',
      body:`<div class="field"><label class="field-label">工程名称</label><input class="input" id="npName" value="新工程" /></div>
        <div class="field"><label class="field-label">时长（秒）</label><input class="input" id="npDur" type="number" value="30" min="9" max="180" /></div>`,
      actions:[{ label:'取消' },{ label:'创建', primary:true, onClick:()=>{
        const dur = Math.max(9, Number($('#npDur').value)||30);
        const h = Math.max(3, Math.round(dur*0.17)), c = Math.max(3, Math.round(dur*0.17)), b = dur-h-c;
        const np = { id:store.uid('p'), name:$('#npName').value.trim()||'新工程', duration:dur, createdAt:store.now(),
          video:[{id:store.uid('v'),label:'开场钩子',start:0,len:h},{id:store.uid('v'),label:'主内容',start:h,len:b},{id:store.uid('v'),label:'CTA',start:h+b,len:c}],
          subtitle:[{id:store.uid('t'),label:'钩子字幕',start:0,len:h},{id:store.uid('t'),label:'要点字幕',start:h,len:b},{id:store.uid('t'),label:'CTA 字幕',start:h+b,len:c}],
          music:[{id:store.uid('m'),label:'轻快 BGM',start:0,len:dur-3}], fx:[] };
        store.add('projects', np);
        const opt = document.createElement('option'); opt.value=np.id; opt.textContent=np.name; $('#projSel',root).appendChild(opt);
        pid = np.id; $('#projSel',root).value=np.id; draw(); toast('工程已创建','已自动保存');
      }}],
    });
    $('#btnExportProj', root).onclick = () => {
      stop();
      downloadFile(`${p.name}-工程.json`, JSON.stringify(p,null,2), 'application/json;charset=utf-8');
    };
    $('#btnImportProj', root).onclick = async () => {
      const f = await pickFile('application/json,.json');
      if (!f) return;
      try {
        const np = JSON.parse(await f.text());
        if (!np || !Array.isArray(np.video)) throw new Error('缺少视频轨道');
        np.id = store.uid('p'); np.name = np.name + '（导入）'; np.createdAt = store.now();
        store.add('projects', np);
        const opt = document.createElement('option'); opt.value=np.id; opt.textContent=np.name; $('#projSel',root).appendChild(opt);
        pid=np.id; $('#projSel',root).value=np.id; draw(); toast('工程已导入','可在下拉框切换');
      } catch (e) { toast('导入失败', e.message, 'error'); }
    };
    $('#btnExportFilm', root).onclick = () => {
      stop();
      const name = p.name;
      store.add('works', { id:store.uid('w'), title:name, track:'pet-chew', createdAt:store.now().slice(0,10) });
      store.bump('exports');
      toast('成片已导出', '工程包已生成，正在送去评估', '');
      setTimeout(() => bus.navigate('review', { title:name }), 260);
    };

    if (!p) { toast('请先新建一个工程','四条轨道会从模板开始','warn'); return; }
    draw();
  },
};
