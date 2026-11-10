import { icon } from '../icons.js';
import { AUTO_STEPS, NARRATION, SCRIPT_LIB, trackOf } from '../data.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, downloadFile, copyText } from '../ui.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mb = b => (b / 1024 / 1024).toFixed(1) + ' MB';

function narration(calib, style, track) {
  const lib = SCRIPT_LIB[track] || SCRIPT_LIB.knowledge;
  const topic = (calib || '这段画面').replace(/[。.!！]$/, '');
  return {
    hook: `${style === '轻松幽默' ? '别眨眼——' : ''}${topic.slice(0, 22)}，重点其实在前三秒。`,
    body: `先看画面里发生了什么：${topic}。${lib.points[0]} 接着留意节奏变化，${lib.points[1]} 最后把注意力落回收尾动作，${lib.points[2]}`,
    cta: lib.cta[0],
  };
}

async function grabFrames(file, seconds) {
  if (!file || !file.type.startsWith('video/')) return [];
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; setTimeout(() => rej(new Error('timeout')), 8000); });
    const dur = v.duration || seconds || 10;
    const times = [dur * 0.12, dur * 0.5, dur * 0.86];
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    const out = [];
    for (const t of times) {
      v.currentTime = t;
      await Promise.race([
        new Promise(res => { v.onseeked = res; }),
        sleep(2500),
      ]);
      try { ctx.drawImage(v, 0, 0, 320, 180); out.push({ t:t.toFixed(1), url:canvas.toDataURL('image/jpeg', 0.65) }); }
      catch (_) { out.push({ t:t.toFixed(1), url:'' }); }
    }
    return out;
  } catch (_) { return []; }
  finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}

export default {
  render() {
    const jobs = store.get('autoJobs', []);
    return `
    ${pageHead('智能成片','上传本地视频，自动识别画面、写解说、排字幕、配乐，导出可用工程包',
      `<span class="badge blue">${icon('lock',12)} 本地处理 · 半自动工程包</span>
       <button class="btn" id="btnToLibrary">${icon('cloud',14)} 成片入库</button>
       <button class="btn btn-primary" id="btnStart">${icon('zap',14)} 开始生成</button>`)}
    <div class="split" style="grid-template-columns:1.35fr .65fr;align-items:start">
      <div>
        <div class="card card-pad">
          <div class="card-title"><h3>上传视频，一键生成解说 / 字幕 / 配乐</h3><span class="sub">视频仅在本机读取与预览，不上传云端</span></div>
          <div class="dropzone" id="dropzone">
            ${icon('video',34)}<b>点击选择或拖入本地视频</b>
            <span>支持 MP4 / MOV / WebM · 抽帧图片仅用于本机画面识别</span>
          </div>
          <div id="fileBox"></div>
          <div class="row" style="margin-top:10px"><button class="btn btn-sm" id="btnDemoFile">${icon('image',13)} 载入示例文件信息</button>
            <button class="btn btn-sm btn-ghost" id="btnClearFile">清除</button></div>
          <div class="divider"></div>
          <div class="field"><label class="field-label" for="calib">一句话校准画面内容 <span class="muted small">（选填，能显著提升解说贴合度）</span></label>
            <textarea class="textarea" id="calib" style="min-height:66px" placeholder="例如：下班后在家做 10 分钟早餐，重点是备菜顺序和时间安排">机器人踢球：先是小步调整，接着起脚射门，最后球滚向镜头。</textarea></div>
          <div class="grid g2">
            <div class="field"><label class="field-label" for="narrStyle">解说风格</label>
              <select class="select" id="narrStyle">${NARRATION.map(s=>`<option value="${esc(s)}" ${s==='共情叙事'?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
            <div class="field"><label class="field-label" for="batchN">批量生成数量 <span class="muted small">（1–50 条，单次最多 50）</span></label>
              <div class="row" style="gap:6px">
                <button class="btn btn-sm btn-ghost" id="batchMinus" type="button" title="减 1">−</button>
                <input class="input" id="batchN" type="number" min="1" max="50" step="1" value="2" inputmode="numeric" style="width:84px;text-align:center;padding:9px 6px" />
                <button class="btn btn-sm btn-ghost" id="batchPlus" type="button" title="加 1">+</button>
                <span class="small muted">条工程包</span>
              </div>
              <div class="batch-presets" id="batchPresets">
                ${[1,2,3,5,10,20,30,50].map(n=>`<button class="chip ${n===2?'active':''}" type="button" data-batch="${n}">${n} 条</button>`).join('')}
              </div>
              <div class="field-hint" id="batchHint">将生成 2 条工程包，每条含 3 段字幕 / 1 段配乐。</div>
            </div>
          </div>
          <div class="row row-wrap"><span class="small muted">赛道</span>
            <select class="mini-select" id="autoTrack"><option value="knowledge">知识科普</option><option value="pet-chew">宠物磨牙</option><option value="pet-toy">宠物玩具</option><option value="pet-train">宠物训练</option><option value="skincare">女性护肤</option><option value="fragrance">香水香氛</option></select>
            <span class="spacer"></span><button class="btn btn-primary" id="btnStart2">${icon('wand',14)} 一键生成工程包</button></div>
        </div>

        <div class="card card-pad" style="margin-top:14px">
          <div class="card-title"><h3>处理进度</h3><span class="sub" id="stepStatus">等待上传</span></div>
          <div class="steps" id="steps">${AUTO_STEPS.map((s,i)=>`${i?'<div class="step-line" data-line="'+i+'"></div>':''}<div class="step" data-step="${i}"><i>${i+1}</i>${esc(s)}</div>`).join('')}</div>
          <div class="proc-log" id="procLog" style="margin-top:12px"><div class="muted">尚未开始。上传视频后点「开始生成」，六步会依次跑完。</div></div>
          <div id="frames" style="margin-top:12px"></div>
        </div>
      </div>

      <div>
        <div class="card card-pad">
          <div class="card-title"><h3>工程建议</h3><span class="badge">规则码 A-01</span></div>
          <div id="suggestBox"></div>
          <div class="divider"></div>
          <div class="notice-box">建议口径：画幅按 16:9 / 1080P 输出；字幕按钩子 / 正文 / CTA 三段；配乐 1 段贯穿全片。抽帧数 = 3，关键帧时间点取片长 12% / 50% / 86%。</div>
        </div>
        <div class="card card-pad" style="margin-top:14px">
          <div class="card-title"><h3>批量结果</h3><span class="sub" id="jobCount">${jobs.length} 条</span></div>
          <div id="jobList"></div>
        </div>
      </div>
    </div>`;
  },

  mount(root) {
    let file = null, meta = { name:'', size:0, duration:0, w:0, h:0, demo:false }, frames = [], busy = false;
    let showAllJobs = false;

    // 批量数量口径 A-02：1–50 条，越界自动钳制，快捷档位与输入框双向同步
    const syncBatchUI = () => {
      const v = Number($('#batchN', root).value);
      $$('[data-batch]', root).forEach(b => b.classList.toggle('active', Number(b.dataset.batch) === v));
    };
    const clampN = () => {
      const el = $('#batchN', root), raw = el.value.trim();
      let n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n)) n = 2;
      const capped = Math.min(50, Math.max(1, n));
      if (String(capped) !== raw) {
        el.value = String(capped);
        toast(n > 50 ? '单次最多 50 条' : '数量已调整', n > 50 ? '已按上限 50 条生成' : '请输入 1–50 之间的整数', n > 50 ? 'warn' : '');
      }
      syncBatchUI();
      $('#batchHint', root).textContent = capped >= 50
        ? '已达上限：本次生成 50 条工程包，右侧可展开查看全部结果。'
        : capped >= 20
          ? `将生成 ${capped} 条工程包，大批量结果已做折叠展示。`
          : `将生成 ${capped} 条工程包，每条含 3 段字幕 / 1 段配乐。`;
      return capped;
    };

    const setFile = (f, demo = false) => {
      file = demo ? null : f;
      if (demo) {
        meta = { name:'机器人踢球.mp4', size:30.4*1024*1024, duration:66.8, w:1916, h:1076, demo:true };
      } else {
        meta = { name:f.name, size:f.size, duration:0, w:0, h:0, demo:false };
        const url = URL.createObjectURL(f), v = document.createElement('video');
        v.preload='metadata'; v.src=url;
        v.onloadedmetadata = () => {
          meta.duration = Number(v.duration.toFixed(1)); meta.w = v.videoWidth; meta.h = v.videoHeight;
          paintFile(); paintSuggest(); URL.revokeObjectURL(url);
        };
      }
      paintFile(); paintSuggest();
    };
    const paintFile = () => {
      $('#fileBox', root).innerHTML = `<div class="file-pill">${icon('video',20)}
        <div><b>${esc(meta.name)}</b><span>${mb(meta.size)} · ${meta.duration ? meta.duration+' 秒' : '读取时长中…'}${meta.w ? ` · ${meta.w}×${meta.h}` : ''}${meta.demo ? ' · 示例元数据' : ''}</span></div>
        <span class="spacer"></span><span class="badge">已就绪</span></div>`;
    };

    const paintSuggest = () => {
      const d = meta.duration || 30;
      const subs = 3, music = 1, kf = Math.max(3, Math.round(d / 20));
      $('#suggestBox', root).innerHTML = `
        <div class="suggest-row"><span>输出画幅</span><b>16:9 · 1080P</b></div>
        <div class="suggest-row"><span>片长</span><b>${d} 秒</b></div>
        <div class="suggest-row"><span>字幕</span><b>${subs} 段（钩子 / 正文 / CTA）</b></div>
        <div class="suggest-row"><span>配乐</span><b>${music} 段贯穿</b></div>
        <div class="suggest-row"><span>关键帧</span><b>${kf} 张 · ${(d*.12).toFixed(1)}s / ${(d*.5).toFixed(1)}s / ${(d*.86).toFixed(1)}s</b></div>
        <div class="suggest-row"><span>源分辨率</span><b>${meta.w ? `${meta.w}×${meta.h}` : '待读取'}</b></div>`;
    };

    const jobsHTML = () => {
      const jobs = store.get('autoJobs', []);
      const visible = showAllJobs ? jobs : jobs.slice(0, 8);
      const list = $('#jobList', root);
      $('#jobCount', root).textContent = `${jobs.length} 条`;
      const scroll = showAllJobs && jobs.length > 8;
      list.style.maxHeight = scroll ? '520px' : '';
      list.style.overflowY = scroll ? 'auto' : '';
      list.style.paddingRight = scroll ? '6px' : '';
      list.innerHTML = (jobs.length ? visible.map(j=>`<div class="block hoverable">
        <div class="block-head"><b>${esc(j.title)}</b><span class="badge ${j.demo?'amber':''}">${esc(j.style)}</span></div>
        <p class="small muted">${esc(j.createdAt)} · ${j.duration}s · 3 段字幕 · 1 段配乐</p>
        <div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" data-job-review="${j.id}">送去评估</button>
          <button class="btn btn-sm" data-job-editor="${j.id}">送到剪辑台</button>
          <button class="btn btn-sm" data-job-library="${j.id}">${icon('cloud',12)} 成片入库</button>
          <button class="btn btn-sm btn-ghost" data-job-download="${j.id}">${icon('download',12)} 工程包</button>
        </div></div>`).join('') : '<div class="empty">还没有生成结果</div>')
        + (jobs.length > 8 ? `<div class="row" style="justify-content:center;margin-top:10px"><button class="btn btn-sm" id="btnToggleJobs">${showAllJobs ? '收起结果' : `展开全部 ${jobs.length} 条`} ${icon(showAllJobs ? 'chevronUp' : 'chevronDown',12)}</button></div>` : '');
      const toggle = $('#btnToggleJobs', root);
      if (toggle) toggle.onclick = () => { showAllJobs = !showAllJobs; jobsHTML(); };
      $$('[data-job-review]', root).forEach(b=>b.onclick=()=>bus.navigate('review',{title:store.get('autoJobs',[]).find(j=>j.id===b.dataset.jobReview)?.title}));
      $$('[data-job-editor]', root).forEach(b=>b.onclick=()=>{
        const j = store.get('autoJobs',[]).find(x=>x.id===b.dataset.jobEditor);
        const d = j?.duration || 30, h=Math.round(d*.17), c=Math.round(d*.17), body=d-h-c;
        const np = { id:store.uid('p'), name:j?.title || '智能成片工程', duration:d, createdAt:store.now(),
          video:[{id:store.uid('v'),label:'开场钩子',start:0,len:h},{id:store.uid('v'),label:'主内容',start:h,len:body},{id:store.uid('v'),label:'CTA',start:h+body,len:c}],
          subtitle:[{id:store.uid('t'),label:'钩子字幕',start:0,len:h,text:j?.script?.hook},{id:store.uid('t'),label:'要点字幕',start:h,len:body,text:j?.script?.body},{id:store.uid('t'),label:'CTA 字幕',start:h+body,len:c,text:j?.script?.cta}],
          music:[{id:store.uid('m'),label:'贯穿 BGM',start:0,len:d}], fx:[] };
        store.add('projects', np); toast('已送到剪辑台','四轨工程已生成'); bus.navigate('editor',{project:np.id});
      });
      $$('[data-job-library]', root).forEach(b=>b.onclick=()=>{
        const j = store.get('autoJobs',[]).find(x=>x.id===b.dataset.jobLibrary);
        bus.navigate('library',{uploadGenerated:true, title:j?.title || ''});
      });
      $$('[data-job-download]', root).forEach(b=>b.onclick=()=>{
        const j = store.get('autoJobs',[]).find(x=>x.id===b.dataset.jobDownload);
        downloadFile(`${j.title}-工程包.json`, JSON.stringify(j,null,2), 'application/json;charset=utf-8');
      });
    };

    const log = (text) => {
      const box = $('#procLog', root);
      if (box.querySelector('.muted') && box.children.length === 1) box.innerHTML = '';
      const d = document.createElement('div');
      d.textContent = `› ${text}`;
      box.appendChild(d); box.scrollTop = box.scrollHeight;
    };
    const setStep = (i, state) => {
      $$('#steps .step', root).forEach((el, k) => {
        el.classList.toggle('done', k < i || (k === i && state === 'done'));
        el.classList.toggle('running', k === i && state === 'running');
      });
      $$('#steps .step-line', root).forEach((el, k) => el.classList.toggle('done', k < i));
    };

    const start = async () => {
      if (busy) return;
      if (!meta.name) { toast('请先选择视频','或点「载入示例文件信息」体验流程','warn'); return; }
      busy = true;
      $('#btnStart', root).disabled = true; $('#btnStart2', root).disabled = true;
      $('#procLog', root).innerHTML = ''; frames = [];
      $('#stepStatus', root).textContent = '处理中…';
      const calib = $('#calib', root).value.trim();
      const style = $('#narrStyle', root).value;
      const track = $('#autoTrack', root).value;
      const n = clampN();
      const d = meta.duration || 30;
      // 预排六步节拍：避免标签页切到后台时定时器被浏览器节流，导致流程停在中途
      const ticks = AUTO_STEPS.map((_, i) => new Promise(r => setTimeout(r, 380 * (i + 1))));
      for (let i = 0; i < AUTO_STEPS.length; i++) {
        setStep(i, 'running');
        $('#stepStatus', root).textContent = `${i+1}/6 ${AUTO_STEPS[i]}`;
        log(`第 ${i+1} 步：${AUTO_STEPS[i]}…`);
        if (i === 1) {
          frames = file ? await grabFrames(file, d) : [];
          if (frames.length && frames.some(f=>f.url)) {
            $('#frames', root).innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap">${frames.map(f=>`<div style="text-align:center"><img src="${f.url}" alt="关键帧 ${f.t}s" style="width:112px;height:63px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" /><div class="small muted">${f.t}s</div></div>`).join('')}</div>`;
            log(`抽到 ${frames.length} 张关键帧（本机 canvas 截取）`);
          } else {
            $('#frames', root).innerHTML = '<div class="notice-box">示例元数据或浏览器未能解码该视频，抽帧步骤以占位方式跳过；其余五步照常产出工程包。</div>';
            log('未能解码视频帧，按占位方式继续（不影响工程包结构）');
          }
        }
        if (i === 2) log(`画面识别：${calib ? '已结合校准语句「'+calib.slice(0,18)+'…」' : '未填写校准，按通用画面结构推断'}`);
        if (i === 3) log(`解说风格：${style}；主赛道：${trackOf(track).name}`);
        await ticks[i];
        setStep(i, 'done');
      }
      const script = narration(calib, style, track);
      const batch = [];
      for (let k = 0; k < n; k++) {
        const j = { id:store.uid('j'), title:`${meta.name.replace(/\.[^.]+$/,'')} · 版本 ${k+1}`,
          style: k === 0 ? style : NARRATION[(NARRATION.indexOf(style)+k) % NARRATION.length],
          duration:d, track, createdAt:store.now(), demo:meta.demo,
          frames:frames.map(f=>f.t), script, suggestion:{ aspect:'16:9', resolution:'1080P', subtitles:3, music:1, keyframes:3 } };
        batch.push(j);
      }
      // A-02：大批量一次性写入，避免 50 条时逐条序列化 localStorage
      const newestFirst = batch.slice().reverse();
      store.set('autoJobs', [...newestFirst, ...store.get('autoJobs', [])].slice(0, 300));
      const works = newestFirst.map(j => ({ id:store.uid('w'), title:j.title, track, createdAt:store.now().slice(0,10) }));
      store.set('works', [...works, ...store.get('works', [])].slice(0, 300));
      log(`完成：生成 ${n} 条工程建议，含 3 段字幕 / 1 段配乐。`);
      if (n >= 20) log(`批量写入：${n} 条工程包已保存到本机（最多保留最近 300 条），右侧可展开查看。`);
      $('#stepStatus', root).textContent = `已完成 · ${n} 条工程包`;
      jobsHTML();
      busy = false;
      $('#btnStart', root).disabled = false; $('#btnStart2', root).disabled = false;
      toast('智能成片完成',`${n} 条工程包已生成，可送去评估或剪辑台`);
    };

    const dz = $('#dropzone', root);
    dz.onclick = () => { const i=document.createElement('input'); i.type='file'; i.accept='video/*'; i.onchange=()=>{ if(i.files[0]) setFile(i.files[0]); }; i.click(); };
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); };
    $('#btnDemoFile', root).onclick = () => { setFile(null, true); toast('已载入示例元数据','30.4 MB · 66.8 秒 · 1916×1076'); };
    $('#btnClearFile', root).onclick = () => { file=null; meta={name:'',size:0,duration:0,w:0,h:0,demo:false}; $('#fileBox',root).innerHTML=''; paintSuggest(); };
    $$('[data-batch]', root).forEach(b => b.onclick = () => { $('#batchN', root).value = b.dataset.batch; clampN(); });
    $('#batchN', root).oninput = syncBatchUI;
    $('#batchN', root).onblur = clampN;
    $('#batchMinus', root).onclick = () => {
      const el = $('#batchN', root); el.value = Math.max(1, (Number.parseInt(el.value, 10) || 2) - 1); clampN();
    };
    $('#batchPlus', root).onclick = () => {
      const el = $('#batchN', root); el.value = Math.min(50, (Number.parseInt(el.value, 10) || 1) + 1); clampN();
    };
    $('#btnStart', root).onclick = start;
    $('#btnStart2', root).onclick = start;
    $('#btnToLibrary', root).onclick = () => bus.navigate('library',{uploadGenerated:true});
    paintSuggest(); jobsHTML(); clampN();
  },
};
