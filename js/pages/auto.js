// 智能成片：一步式云端出片
// 流程：导入视频（自动上传服务端）→ 提示词 → 一句话校准 → 赛道 → 风格 → 变体矩阵 → 生产数量 → 开始生成
// 由服务端 ffmpeg 渲染真实 MP4；离线 / 未登录时给出明确引导，不再产出本地模拟工程包。
// 旧的「提示词批量混剪」云面板已从本页下线（见 js/cloud-console.js 注释），本页自带上传、进度、预览与下载。
import { icon } from '../icons.js';
import { NARRATION, trackOf } from '../data.js';
import { store } from '../store.js';
import { $, $$, esc, toast, modal, pageHead } from '../ui.js';
import { svAvailable, svMe, get, post, upload, mediaURL } from '../server-api.js';

const HOOKS = ['反常识', '数字锚点', '痛点提问'];
const SUBS = ['简约白', '描边黑', '高亮黄'];
const DURS = [15, 30, 45];
const BGM_FIXED = '轻快';
const COUNT_PRESETS = [1, 2, 3, 5, 10, 20, 30, 50];
const STEPS = ['上传素材', '生成分镜', '云端渲染', '完成'];
const LANGS = [
  ['en-US', '英语（默认）'], ['de-DE', '德语'], ['pt-BR', '葡语（巴西）'], ['ja-JP', '日语'], ['ko-KR', '韩语'],
  ['es-ES', '西班牙语'], ['fr-FR', '法语'], ['zh-CN', '中文（普通话）'], ['zh-HK', '粤语']
];
const RATIO_OPTS = [['9:16', '竖版 9:16'], ['1:1', '方形 1:1'], ['16:9', '横版 16:9']];
const TRACK_PRODUCTS = {
  knowledge: '知识科普短视频',
  'pet-chew': '宠物磨牙玩具',
  'pet-toy': '宠物玩具',
  'pet-train': '宠物训练课程',
  skincare: '护肤精华',
  fragrance: '香水香氛',
};
const TRACKS = [['knowledge', '知识科普'], ['pet-chew', '宠物磨牙'], ['pet-toy', '宠物玩具'], ['pet-train', '宠物训练'], ['skincare', '女性护肤'], ['fragrance', '香水香氛']];

let pollTimer = null;
const stopPoll = () => { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } };
const fmtMB = b => (b / 1024 / 1024).toFixed(1) + ' MB';

export default {
  render() {
    const online = svAvailable() && !!svMe();
    return `
    ${pageHead('智能成片', '导入视频 → 填提示词 → 选变体与数量 → 点「开始生成」，云端直接产出可下载的 MP4',
      `<span class="badge ${online ? 'blue' : 'amber'}">${icon(online ? 'cloud' : 'lock', 12)} ${online ? '云端渲染 · 真实视频' : '未连接云服务'}</span>`)}
    ${online ? '' : `<div class="notice-box" style="margin-bottom:12px"><b>当前未连接云服务器（或未登录服务端账号）。</b>「开始生成」由服务端 ffmpeg 渲染真实 MP4，请先通过在线服务地址登录后再使用本页。</div>`}
    <div>
      <div class="card card-pad">
        <div class="card-title"><h3>① 导入本地视频</h3><span class="sub">选中后自动上传到服务端素材库，可多选</span></div>
        <div class="dropzone" id="dropzone">
          ${icon('video', 34)}<b>点击选择或拖入本地视频</b>
          <span>支持 MP4 / MOV / WebM · 可多选 · 上传到你自己的工作台服务端</span>
        </div>
        <div id="fileBox"></div>
        <div class="divider"></div>
        <div class="field"><label class="field-label" for="voSel">口播文案 <span class="muted small">（可选，选中后自动填入下方提示词）</span></label>
          <div class="row" style="gap:6px">
            <select class="select" id="voSel" style="flex:1"><option value="">— 不使用口播文案 —</option></select>
          </div>
          <div class="field-hint" id="voHint"></div></div>
        <div class="field"><label class="field-label" for="prompt">② 提示词 <span class="muted small">（想让视频讲什么、怎么卖）</span></label>
          <textarea class="textarea" id="prompt" style="min-height:72px" placeholder="例：宠物磨牙玩具 30 秒带货，突出耐咬、缓解独处焦虑，结尾引导收藏">宠物磨牙玩具，30 秒带货短视频，突出耐咬与独处焦虑</textarea></div>
        <div class="field"><label class="field-label" for="calib">③ 一句话校准内容 <span class="muted small">（选填，说明画面里实际发生了什么，提升贴合度）</span></label>
          <input class="input" id="calib" placeholder="例：先是小狗啃咬玩具，接着给出耐咬测试特写，最后狗主人出镜推荐"></div>
        <div class="grid g3">
          <div class="field"><label class="field-label" for="track">④ 赛道</label>
            <select class="select" id="track">${TRACKS.map(([v, l]) => `<option value="${v}" ${v === 'pet-chew' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="field"><label class="field-label" for="style">⑤ 风格</label>
            <select class="select" id="style">${NARRATION.map(s => `<option value="${esc(s)}" ${s === '共情叙事' ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
          <div class="field"><label class="field-label" for="lang">⑥ 配音语言 <span class="muted small">（配音与文案语言）</span></label>
            <select class="select" id="lang">${LANGS.map(([v, l]) => `<option value="${v}" ${v === 'en-US' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label class="field-label">⑦ 变体矩阵 <span class="muted small">（点选 / 取消，多选 = 每条视频在这些维度上变化）</span></label>
          <div class="grid g3" style="margin-top:2px">
            <div><div class="small muted" style="margin-bottom:5px">钩子</div>
              <div class="row row-wrap" style="gap:6px">${HOOKS.map(h => `<button class="chip active" type="button" data-hook="${esc(h)}">${esc(h)}</button>`).join('')}</div></div>
            <div><div class="small muted" style="margin-bottom:5px">字幕</div>
              <div class="row row-wrap" style="gap:6px">${SUBS.map(s => `<button class="chip active" type="button" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>
            <div><div class="small muted" style="margin-bottom:5px">时长</div>
              <div class="row row-wrap" style="gap:6px">${DURS.map(d => `<button class="chip ${d === 30 ? 'active' : ''}" type="button" data-dur="${d}">${d}s</button>`).join('')}</div></div>
          </div></div>
        <div class="grid g2">
          <div class="field"><label class="field-label" for="countN">⑧ 生产数量 <span class="muted small">（1–50 条；多于矩阵组合数时自动轮换变体补足）</span></label>
            <div class="row row-wrap" style="gap:6px">
              <input class="input" id="countN" type="number" min="1" max="50" step="1" value="5" inputmode="numeric" style="width:84px;text-align:center;padding:9px 6px" />
              ${COUNT_PRESETS.map(n => `<button class="chip ${n === 5 ? 'active' : ''}" type="button" data-count="${n}">${n}</button>`).join('')}
            </div>
            <div class="field-hint" id="countHint"></div></div>
          <div class="field"><label class="field-label">⑨ 画幅 <span class="muted small">（可多选，每条任务导出所选画幅）</span></label>
            <div class="row row-wrap" style="gap:6px">
              ${RATIO_OPTS.map(([v, l]) => `<button class="chip ${v === '9:16' ? 'active' : ''}" type="button" data-ratio="${v}">${esc(l)}</button>`).join('')}
            </div></div>
        </div>
        <div class="field"><label class="field-label">⑩ 去水印 <span class="muted small">（导入的视频带抖音/TikTok 角标时开启，对左上/右上/右下角标区域做消除）</span></label>
          <div class="row row-wrap" style="gap:6px">
            <button class="chip" type="button" data-delogo>开启去水印</button>
            <span class="small muted" id="delogoHint">默认关闭；开启后渲染时自动模糊三处常见水印位</span>
          </div></div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-primary" id="btnGenerate" style="height:44px;padding:0 26px;font-size:14px">${icon('zap', 15)} 开始生成</button>
          <span class="small muted" id="genStatus"></span></div>
      </div>

      <div class="card card-pad" style="margin-top:14px">
        <div class="card-title"><h3>生成进度</h3><span class="sub" id="stepStatus">等待开始</span></div>
        <div class="steps" id="steps">${STEPS.map((s, i) => `${i ? '<div class="step-line" data-line="' + i + '"></div>' : ''}<div class="step" data-step="${i}"><i>${i + 1}</i>${esc(s)}</div>`).join('')}</div>
        <div class="progress" style="margin-top:10px"><i id="genProgress" style="width:0%"></i></div>
        <div class="proc-log" id="procLog" style="margin-top:10px"><div class="muted">导入视频、填好提示词后点「开始生成」。</div></div>
      </div>
      <div class="card card-pad" style="margin-top:14px">
        <div class="card-title"><h3>成片结果</h3><span class="sub" id="batchSub">还没有任务</span></div>
        <div id="resultBox"><div class="empty">生成完成后，这里可以预览与下载 MP4 / SRT / 配音，也可一键批量导出</div></div>
      </div>
    </div>`;
  },

  mount(root) {
    stopPoll();
    const online = svAvailable() && !!svMe();
    const picks = [];   // {file, name, size, status:'uploading'|'ready'|'error', assetId, error}
    let busy = false;
    let batchId = '';

    const log = t => {
      const box = $('#procLog', root);
      if (box.querySelector('.muted') && box.children.length === 1) box.innerHTML = '';
      const d = document.createElement('div');
      d.textContent = `› ${t}`;
      box.appendChild(d); box.scrollTop = box.scrollHeight;
    };
    const setStep = (i, state) => {
      $$('#steps .step', root).forEach((el, k) => {
        el.classList.toggle('done', k < i || (k === i && state === 'done'));
        el.classList.toggle('running', k === i && state === 'running');
      });
      $$('#steps .step-line', root).forEach((el, k) => el.classList.toggle('done', k < i));
    };
    const setProgress = pct => { const el = $('#genProgress', root); if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%'; };
    const selChips = attr => $$(`[data-${attr}].active`, root).map(b => b.dataset[attr]);

    /* ---- 数量与矩阵提示 ---- */
    const updateHint = () => {
      const m = Math.max(1, selChips('hook').length || HOOKS.length) * Math.max(1, selChips('sub').length || SUBS.length) * Math.max(1, selChips('dur').length || 1);
      const n = Number.parseInt($('#countN', root).value, 10) || 1;
      const extra = n > m ? '；数量多于组合数，自动轮换变体补足' : n < m ? '；取前 ' + n + ' 种组合' : '';
      $('#countHint', root).textContent = `变体矩阵共 ${m} 种组合，本次将生成 ${n} 条${extra}。上限 50 条 / 次。`;
      $$('[data-count]', root).forEach(b => b.classList.toggle('active', Number(b.dataset.count) === n));
    };
    const clampCount = () => {
      const el = $('#countN', root);
      let n = Number.parseInt(el.value, 10);
      if (!Number.isFinite(n)) n = 5;
      const c = Math.min(50, Math.max(1, n));
      if (String(c) !== el.value) el.value = String(c);
      updateHint();
      return c;
    };

    /* ---- 导入视频并自动上传 ---- */
    const paintFiles = () => {
      $('#fileBox', root).innerHTML = picks.length ? picks.map((p, i) => `<div class="file-pill">${icon('video', 20)}
        <div><b>${esc(p.name)}</b><span>${fmtMB(p.size)} · ${p.status === 'uploading' ? '上传中…' : p.status === 'ready' ? '已上传服务端' : '上传失败：' + esc(p.error || '')}</span></div>
        <span class="spacer"></span>
        ${p.status === 'error' ? `<button class="btn btn-sm" data-pick-retry="${i}">重试</button>` : `<span class="badge ${p.status === 'ready' ? 'blue' : ''}">${p.status === 'ready' ? '已就绪' : '上传中'}</span>`}
        <button class="btn btn-sm btn-ghost" data-pick-remove="${i}" title="从本次生成中移除">${icon('x', 12)}</button></div>`).join('') : '';
    };
    const uploadPick = async p => {
      p.status = 'uploading'; p.error = ''; paintFiles();
      try {
        const r = await upload(`/api/remix/upload?grade=product&title=${encodeURIComponent(p.name)}&licenseNote=${encodeURIComponent('自有 / 已授权')}`, p.file);
        p.assetId = r?.id || ''; p.status = 'ready';
      } catch (e) { p.status = 'error'; p.error = e.message; }
      paintFiles();
    };
    const addFiles = list => {
      for (const f of list) {
        if (!f.type.startsWith('video/')) { toast('已跳过非视频文件', f.name, 'warn'); continue; }
        const p = { file: f, name: f.name, size: f.size, status: 'uploading', assetId: '', error: '' };
        picks.push(p);
        if (online) uploadPick(p);
        else { p.status = 'error'; p.error = '未连接云服务'; paintFiles(); }
      }
      paintFiles();
    };
    const dz = $('#dropzone', root);
    dz.onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'video/*'; i.multiple = true; i.onchange = () => addFiles(i.files); i.click(); };
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };

    /* ---- 结果区 ---- */
    const jobRow = j => {
      const v = j.variant || {};
      const tone = j.status === 'done' ? 'blue' : j.status === 'failed' ? 'amber' : '';
      return `<div class="block hoverable" style="padding:10px 12px">
        <div class="block-head"><b>#${j.idx + 1} ${esc(v.hookKind || '')} · ${esc(v.subtitleStyle || '')} · ${esc(String(v.duration || ''))}s</b>
          <span class="badge ${tone}">${esc(j.status)}${j.progress ? ' ' + j.progress + '%' : ''}</span></div>
        ${j.status === 'failed' ? `<p class="small muted">${esc(String(j.error || '渲染失败').slice(0, 140))}</p><div class="row" style="margin-top:6px"><button class="btn btn-sm" data-job-retry="${esc(j.id)}">重试</button></div>` : ''}
        ${j.status === 'done' ? `<div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" data-job-preview="${esc(j.id)}">${icon('play', 12)} 预览</button>
          <a class="btn btn-sm" href="${mediaURL(j.id, 'output_9x16.mp4')}?download=1" download>${icon('download', 12)} MP4 竖版</a>
          <a class="btn btn-sm" href="${mediaURL(j.id, 'output_1x1.mp4')}?download=1" download>方形</a>
          <a class="btn btn-sm" href="${mediaURL(j.id, 'output_16x9.mp4')}?download=1" download>横版</a>
          <a class="btn btn-sm btn-ghost" href="${mediaURL(j.id, 'subtitle.srt')}?download=1" download>SRT</a></div>` : ''}
      </div>`;
    };
    const paintBatch = b => {
      const done = b.counts?.done || 0, failed = b.counts?.failed || 0;
      $('#batchSub', root).textContent = `${b.name || ''} · ${done}/${b.total} 完成`;
      setProgress(b.progress || 0);
      const action = b.status === 'running'
        ? `<button class="btn btn-sm btn-ghost" data-batch-cancel="${esc(b.id)}">${icon('pause', 12)} 取消生成</button>`
        : done ? `<a class="btn btn-sm" href="/api/remix/batches/${esc(b.id)}/export?download=1" download>${icon('download', 12)} 批量导出（${done} 条成片打包 .tar.gz）</a>` : '';
      $('#resultBox', root).innerHTML = `
        ${action ? `<div class="row" style="justify-content:flex-end;margin-bottom:8px">${action}</div>` : ''}
        ${(b.jobs || []).map(jobRow).join('') || '<div class="empty">暂无任务</div>'}`;
    };
    const preview = j => {
      modal({
        title: '成片预览', desc: `#${j.idx + 1} ${(j.variant || {}).hookKind || ''}${j.qc ? ' · QC ' + j.qc.score + ' 分' : ''}`, wide: true,
        body: `<video controls autoplay src="${mediaURL(j.id, 'output_9x16.mp4')}" style="width:100%;max-height:58vh;border-radius:12px;background:#000"></video>
          <div class="field-hint" style="margin-top:8px">下载请使用「成片结果」卡片中的对应按钮，或整批「批量导出」。</div>`
      });
    };

    /* ---- 轮询批次（循环刷新；网络抖动时退避重试，不再一次失败就停摆） ---- */
    const armPoll = (ms = 3000) => {
      if (pollTimer || !document.body.contains(root)) return;
      pollTimer = setTimeout(() => { pollTimer = null; pollOnce(); }, ms);
    };
    const finishBatch = b => {
      stopPoll();
      sessionStorage.removeItem('sv.autoBatchId');
      const done = b.counts?.done || 0, failed = b.counts?.failed || 0;
      setStep(2, 'done'); setStep(3, 'done'); setProgress(b.progress || 100);
      $('#stepStatus', root).textContent = b.status === 'done' ? '已完成' : `已结束（${b.status}）`;
      log(`批次结束：${done}/${b.total} 成功${failed ? `，${failed} 失败（可点重试）` : ''}`);
      $('#btnGenerate', root).disabled = false; $('#genStatus', root).textContent = '';
      busy = false;
      toast('生成结束', `${done}/${b.total} 条成片可预览与下载`);
    };
    const pollOnce = async () => {
      if (!document.body.contains(root)) return stopPoll();
      const b = await get('/api/remix/batches/' + batchId).catch(e => { log('进度查询失败：' + e.message); return null; });
      if (!b) { armPoll(5000); return; }
      paintBatch(b);
      if (b.status !== 'running') finishBatch(b);
      else armPoll(3000);
    };
    /* 页面刷新后恢复未完成的批次，继续轮询直到出片 */
    const resumeActiveBatch = async () => {
      const saved = sessionStorage.getItem('sv.autoBatchId');
      if (!saved || !online) return;
      const b = await get('/api/remix/batches/' + saved).catch(() => null);
      if (!b) { sessionStorage.removeItem('sv.autoBatchId'); return; }
      batchId = saved;
      if (b.status === 'running') {
        busy = true;
        $('#btnGenerate', root).disabled = true; $('#genStatus', root).textContent = '渲染中…';
        setStep(0, 'done'); setStep(1, 'done'); setStep(2, 'running');
        $('#stepStatus', root).textContent = '云端渲染中…';
        log('检测到进行中的批次，已恢复进度刷新');
        paintBatch(b); armPoll(800);
      } else {
        setStep(0, 'done'); setStep(1, 'done');
        log('上次批次已结束，结果如下');
        paintBatch(b); finishBatch(b);
      }
    };

    /* ---- 开始生成：上传素材 → 分镜 → 批次 → 轮询 ---- */
    const generate = async () => {
      if (busy) return;
      if (!online) { toast('请先连接并登录云服务', '本页由服务端 ffmpeg 渲染真实 MP4', 'warn'); return; }
      if (!picks.length) { toast('请先导入视频', '支持多选，选中后自动上传服务端', 'warn'); return; }
      if (picks.some(p => p.status === 'uploading')) { toast('视频还在上传中', '上传完成后请再点「开始生成」', 'warn'); return; }
      if (picks.some(p => p.status !== 'ready')) { toast('有视频未上传成功', '请点失败条目的「重试」后再开始', 'warn'); return; }
      const prompt = $('#prompt', root).value.trim();
      if (!prompt) { toast('请填写提示词', '想让视频讲什么、怎么卖', 'warn'); return; }
      const ratios = selChips('ratio');
      if (!ratios.length) { toast('请至少选择一个画幅', '竖版 / 方形 / 横版可多选', 'warn'); return; }
      busy = true;
      $('#btnGenerate', root).disabled = true; $('#genStatus', root).textContent = '处理中…';
      $('#procLog', root).innerHTML = '';
      setStep(0, 'running'); setProgress(6);
      try {
        setStep(0, 'done');
        log(`素材就绪：${picks.length} 个视频已上传服务端`);
        setStep(1, 'running'); $('#stepStatus', root).textContent = '生成分镜…';
        const track = $('#track', root).value, style = $('#style', root).value;
        const calib = $('#calib', root).value.trim();
        const durs = selChips('dur').map(Number);
        const d0 = durs[0] || 30;
        let composed = prompt + `\n赛道：${trackOf(track).name}（产品：${TRACK_PRODUCTS[track] || track}）`;
        if (calib) composed += `\n画面校准：${calib}`;
        const langSel = $('#lang', root);
        const langLabel = (langSel.options[langSel.selectedIndex]?.text || '英语').replace('（默认）', '');
        composed += `\n配音语言：${langLabel}（文案与配音使用该语言）`;
        const lang = $('#lang', root).value;
        const planBody = { prompt: composed, style, duration: d0, product: TRACK_PRODUCTS[track] || '', lang };
        const pendingReport = sessionStorage.getItem('sv.pendingReport');
        if (pendingReport) { planBody.reportId = pendingReport; sessionStorage.removeItem('sv.pendingReport'); log('已带入拆解报告作为参考结构'); }
        const plan = await post('/api/remix/plan', planBody);
        log(`分镜完成：${(plan.scenes || []).length} 个镜头 · 来源 ${plan.sourceMode === 'llm-external' ? '外部模型' : '本地规则'}`);
        if (plan.sourceMode !== 'llm-external' && !/^zh/i.test(lang)) {
          log(`提示：当前为本地规则分镜（未接外部大模型），字幕暂以中文呈现；配置 LLM 服务后，字幕将自动使用「${langLabel}」`);
        }
        setStep(1, 'done');
        setStep(2, 'running'); $('#stepStatus', root).textContent = '云端渲染中…';
        const n = clampCount();
        const delogo = $('[data-delogo]', root)?.classList.contains('active');
        const batch = await post('/api/remix/batches', {
          planId: plan.id,
          name: `智能成片 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
          hooks: selChips('hook'), subtitles: selChips('sub'), bgm: [BGM_FIXED], durations: durs,
          ratios, voice: $('#lang', root).value, count: n, delogo
        });
        batchId = batch.id;
        sessionStorage.setItem('sv.autoBatchId', batch.id);
        log(`批次已创建：${batch.total} 条任务开始渲染，进度自动刷新${delogo ? '（已启用去水印）' : ''}`);
        store.set('autoJobs', [{
          id: store.uid('j'), title: prompt.slice(0, 24), style, duration: d0, track,
          createdAt: store.now(), demo: false, script: plan.script || null, frames: [],
          suggestion: { aspect: '9:16', resolution: '1080P', subtitles: 3, music: 1, keyframes: 3 }
        }, ...store.get('autoJobs', [])].slice(0, 300));
        paintBatch(batch);
        pollOnce();
      } catch (e) {
        toast('生成失败', e.message, 'error');
        log(`失败：${e.message}`);
        setStep(1, ''); $('#stepStatus', root).textContent = '失败';
        $('#btnGenerate', root).disabled = false; $('#genStatus', root).textContent = '';
        busy = false;
      }
    };

    /* ---- 事件绑定 ---- */
    $$('[data-hook],[data-sub],[data-dur],[data-ratio]', root).forEach(b => b.onclick = () => { b.classList.toggle('active'); updateHint(); });
    const delogoBtn = $('[data-delogo]', root);
    if (delogoBtn) delogoBtn.onclick = () => {
      delogoBtn.classList.toggle('active');
      $('#delogoHint', root).textContent = delogoBtn.classList.contains('active')
        ? '已开启：渲染时对左上/右上/右下三处常见水印位做模糊消除'
        : '默认关闭；开启后渲染时自动模糊三处常见水印位';
    };
    $$('[data-count]', root).forEach(b => b.onclick = () => { $('#countN', root).value = b.dataset.count; clampCount(); });
    $('#countN', root).oninput = updateHint;
    $('#countN', root).onblur = clampCount;
    $('#btnGenerate', root).onclick = generate;
    /* 口播文案选择器：素材库里保存的历史口播稿，选中即填入提示词 */
    const paintVoiceover = () => {
      const list = store.get('scripts', []);
      const sel = $('#voSel', root);
      sel.innerHTML = '<option value="">— 不使用口播文案 —</option>' +
        list.map(s => `<option value="${esc(s.id)}">${esc((s.title || '未命名').slice(0, 22))} · ${s.duration || 30}s</option>`).join('');
      $('#voHint', root).textContent = list.length
        ? `素材库共 ${list.length} 篇口播稿；也可在口播文案工坊点「送去智能成片」直接带入`
        : '素材库还没有口播稿：可在「口播文案」页生成并保存，或从工坊一键跳转过来';
    };
    $('#voSel', root).onchange = () => {
      const s = store.get('scripts', []).find(x => x.id === $('#voSel', root).value);
      if (!s) return;
      const text = [s.hook, s.body, s.cta].filter(Boolean).join('\n');
      if (text) { $('#prompt', root).value = text.slice(0, 1500); toast('口播文案已填入提示词', `${(s.title || '').slice(0, 20)} · 可继续编辑`); }
    };
    paintVoiceover();
    /* 口播文案工坊「送去智能成片」联动：工坊稿直接填入提示词 */
    (async () => {
      const pendingCopy = sessionStorage.getItem('sv.pendingPrompt');
      if (pendingCopy) {
        sessionStorage.removeItem('sv.pendingPrompt');
        $('#prompt', root).value = pendingCopy.slice(0, 1500);
        log('已带入口播工坊文案，可编辑后直接开始生成');
      }
    })();
    /* 爆款雷达拆解联动：从拆解报告「送去批量生成」跳转过来时，
       用报告的反推提示词 / 等长重写稿预填提示词（报告 ID 仍保留给 /plan 作参考结构） */
    (async () => {
      const rid = sessionStorage.getItem('sv.pendingReport');
      if (!rid || !online) return;
      const r = await get('/api/breakdown/reports/' + rid).catch(() => null);
      if (!r) return;
      const copy = String(r.promptReverse || r.rewrite || r.hook?.text || '').trim();
      if (copy) {
        $('#prompt', root).value = copy.slice(0, 1500);
        log(`已带入爆款拆解文案「${String(r.title || '').slice(0, 30)}」，可编辑后直接开始生成`);
      } else {
        log('已关联拆解报告，生成时将作为参考结构');
      }
    })();
    resumeActiveBatch();
    root.addEventListener('click', async e => {
      const t = e.target.closest('[data-pick-remove],[data-pick-retry],[data-job-preview],[data-job-retry],[data-batch-cancel]');
      if (!t || !root.contains(t)) return;
      try {
        if (t.dataset.pickRemove !== undefined) { picks.splice(Number(t.dataset.pickRemove), 1); paintFiles(); }
        else if (t.dataset.pickRetry !== undefined) { const p = picks[Number(t.dataset.pickRetry)]; if (p && online) uploadPick(p); }
        else if (t.dataset.jobPreview) {
          const b = await get('/api/remix/batches/' + batchId).catch(() => null);
          const j = b?.jobs?.find(x => x.id === t.dataset.jobPreview);
          if (j) preview(j);
        }
        else if (t.dataset.jobRetry) { await post('/api/remix/jobs/' + t.dataset.jobRetry + '/retry'); toast('已重新入队'); if (!pollTimer) pollOnce(); }
        else if (t.dataset.batchCancel) { await post('/api/remix/batches/' + t.dataset.batchCancel + '/cancel'); toast('已取消', '剩余任务停止渲染'); pollOnce(); }
      } catch (err) { toast('操作失败', err.message, 'error'); }
    });
    paintFiles(); updateHint();
  },
};
