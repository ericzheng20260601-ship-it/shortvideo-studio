import { icon } from '../icons.js';
import { TRACKS, trackOf, AUDIENCES, STYLES, DURATIONS, SCRIPT_LIB, RADAR } from '../data.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, copyText, downloadFile } from '../ui.js';

const STYLE_PREFIX = {
  '共情叙事':'我懂这种感觉——',
  '专业测评':'先把结论放前面：',
  '轻松幽默':'别笑，这事真发生过。',
  '快节奏种草':'三秒讲完重点：',
  '温柔治愈':'慢慢来，先说一件小事。',
};
const STYLE_TAIL = {
  '共情叙事':'如果你也在纠结，先试一次就够了。',
  '专业测评':'以上判断基于可核对的信息，具体选择按你自己的情况调整。',
  '轻松幽默':'试试看，翻车了回来评论区找我。',
  '快节奏种草':'要点就这些，照着做就行。',
  '温柔治愈':'不必着急，按自己的节奏来。',
};

function generate(o) {
  const lib = SCRIPT_LIB[o.track] || SCRIPT_LIB.knowledge;
  const seed = (o.topic.length + o.style.length + o.audience.length) % lib.hooks.length;
  const hook = (o.topic.trim() ? `${STYLE_PREFIX[o.style] || ''}${lib.hooks[seed]}` : lib.hooks[0]);
  const dur = DURATIONS.find(d => d.v === o.duration) || DURATIONS[1];
  const n = o.duration <= 15 ? 2 : o.duration <= 30 ? 3 : 4;
  const bodyPoints = lib.points.slice(0, n);
  if (o.topic.trim()) bodyPoints.unshift(`今天只讲一件事：${o.topic.trim()}。`);
  const body = bodyPoints.join('') + (o.note.trim() ? `补充一句：${o.note.trim()}。` : '') + STYLE_TAIL[o.style];
  const cta = lib.cta[(o.topic.length + n) % lib.cta.length];
  return { hook, body, cta, dur, topic:o.topic.trim() || trackOf(o.track).name + ' 选题' };
}

function segCard(idx, title, badge, text, hint, color) {
  return `<div class="seg-card" data-seg="${idx}">
    <div class="seg-head"><span class="tag-dot" style="background:${color}"></span><b>${esc(title)}</b>
      <span class="badge ${badge}">${esc(hint)}</span><span class="spacer"></span>
      <button class="btn btn-sm btn-ghost" data-copyseg="${idx}" title="复制本段">${icon('copy',13)}</button></div>
    <div class="seg-text" id="segText${idx}">${esc(text)}</div>
    <div class="seg-count">${text.length} 字 · 建议 ${idx===0?'12–30':idx===1?'60–180':'10–35'} 字</div>
  </div>`;
}

export default {
  render() {
    const preset = bus.pending?.radar;
    const r = RADAR.find(x => x.id === preset);
    const initTrack = r?.track || 'pet-chew';
    return `
    ${pageHead('口播文案工坊','把写稿变成选项和填空：选完就出分好段的稿子',
      `<button class="btn" id="btnHistory">${icon('clock',14)} 历史稿</button>
       <button class="btn btn-primary" id="btnGenTop">${icon('ai',14)} 生成文案</button>`)}
    <div class="split">
      <div class="card card-pad">
        <div class="card-title"><h3>配置</h3><span class="sub">5 个必填项</span></div>
        <div class="field"><label class="field-label" for="scTopic">① 选题</label>
          <input class="input" id="scTopic" placeholder="例如：换牙期磨牙物怎么选" value="${esc(r ? r.title.replace(/[？?]/g,'').slice(0,20) : '换牙期磨牙物怎么选')}" />
          <div class="field-hint">一句话写清「这条片只解决什么问题」。</div></div>
        <div class="field"><label class="field-label">② 赛道</label>
          <div class="option-grid" id="trackOpts">${TRACKS.map(t=>`<button class="option ${t.id===initTrack?'active':''}" data-opt="track" data-val="${t.id}">${t.emoji} ${esc(t.name)}</button>`).join('')}</div></div>
        <div class="field"><label class="field-label" for="scAudience">③ 目标人群</label>
          <select class="select" id="scAudience">${AUDIENCES.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div>
        <div class="field"><label class="field-label">④ 表达风格</label>
          <div class="row row-wrap" id="styleOpts">${STYLES.map((s,i)=>`<button class="chip ${i===0?'active':''}" data-opt="style" data-val="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>
        <div class="field"><label class="field-label">⑤ 时长</label>
          <div class="row row-wrap" id="durOpts">${DURATIONS.map((d,i)=>`<button class="chip ${d.v===30?'active':''}" data-opt="duration" data-val="${d.v}">${d.label}</button>`).join('')}</div></div>
        <div class="field"><label class="field-label" for="scNote">补充说明（可选）</label>
          <textarea class="textarea" id="scNote" style="min-height:64px" placeholder="例如：不要提价格，结尾引导看置顶"></textarea></div>
        <div class="row row-wrap">
          <button class="btn btn-primary btn-block" id="btnGen">${icon('spark',14)} 生成分段稿</button>
          <button class="btn btn-ghost" id="btnReset">重置</button>
        </div>
      </div>
      <div id="scResult"></div>
    </div>`;
  },

  mount(root) {
    const form = { track:(bus.pending?.radar && RADAR.find(x=>x.id===bus.pending.radar)?.track) || 'pet-chew', style:STYLES[0], duration:30 };
    let draft = null;

    const readForm = () => ({
      topic:$('#scTopic', root).value.trim(),
      track:form.track,
      audience:$('#scAudience', root).value,
      style:form.style,
      duration:Number(form.duration),
      note:$('#scNote', root).value.trim(),
    });

    const paint = (d, saveIt = true) => {
      draft = d;
      const result = $('#scResult', root);
      result.innerHTML = `<div class="card card-pad">
        <div class="card-title"><h3>分段稿 · ${esc(d.topic)}</h3><span class="sub">${esc(trackOf(d.opts.track).name)} · ${d.dur.v}s · ${esc(d.opts.style)}</span></div>
        ${segCard(0,'钩子 · 前 3 秒','','',`目标 ${d.dur.hook}s`,'#3f9d8f')}
        ${segCard(1,'正文 · 信息与节奏','blue','',`目标 ${d.dur.body}s`,'#6d9dc3')}
        ${segCard(2,'CTA · 行动号召','rose','',`目标 ${d.dur.cta}s`,'#c98a8a')}
        <div class="divider"></div>
        <div class="row row-wrap">
          <button class="btn btn-soft" id="btnCopyAll">${icon('copy',13)} 复制全文</button>
          <button class="btn" id="btnSaveScript">${icon('save',13)} 存素材库</button>
          <button class="btn" id="btnExportTxt">${icon('download',13)} 导出 TXT</button>
          <button class="btn btn-primary" id="btnToEditor">${icon('scissors',13)} 一键送去剪辑</button>
        </div>
        <div class="field-hint" style="margin-top:9px">字数按时长比例建议值估算；约 4 字/秒，可按实际语速微调。</div>
      </div>`;
      $('#segText0', root).textContent = d.hook;
      $('#segText1', root).textContent = d.body;
      $('#segText2', root).textContent = d.cta;
      $$('.seg-count', root).forEach((el, i) => {
        const txt = [d.hook, d.body, d.cta][i];
        el.textContent = `${txt.length} 字 · 建议 ${[d.dur.hook*4+'–'+d.dur.hook*8, Math.round(d.dur.body*3)+'–'+d.dur.body*5, d.dur.cta*3+'–'+d.dur.cta*6][i]} 字`;
      });

      const fullText = () => `【题目】${d.topic}\n【赛道】${trackOf(d.opts.track).name} · ${d.opts.audience} · ${d.opts.style} · ${d.dur.v}s\n\n【钩子 · 前 3 秒】\n${d.hook}\n\n【正文 · 信息与节奏】\n${d.body}\n\n【CTA · 行动号召】\n${d.cta}\n`;
      $('#btnCopyAll', root).onclick = () => copyText(fullText(), '口播全文');
      $('#btnExportTxt', root).onclick = () => downloadFile(`${d.topic.slice(0,16)}-口播稿.txt`, fullText());
      $('#btnSaveScript', root).onclick = () => {
        store.add('scripts', { id:store.uid('s'), title:d.topic, track:d.opts.track, audience:d.opts.audience, style:d.opts.style, duration:d.dur.v,
          hook:d.hook, body:d.body, cta:d.cta, createdAt:store.now() });
        toast('已存入素材库','文案同时计入首页统计');
      };
      $$('[data-copyseg]', root).forEach(b => b.onclick = () => copyText([d.hook,d.body,d.cta][Number(b.dataset.copyseg)], '本段文案'));
      $('#btnToEditor', root).onclick = () => {
        const sid = store.uid('s');
        store.add('scripts', { id:sid, title:d.topic, track:d.opts.track, audience:d.opts.audience, style:d.opts.style, duration:d.dur.v,
          hook:d.hook, body:d.body, cta:d.cta, createdAt:store.now() });
        const pid = store.uid('p');
        const total = d.dur.v;
        const h = Math.max(3, Math.round(total * 0.17)), c = Math.max(3, Math.round(total * 0.17)), b = total - h - c;
        store.add('projects', { id:pid, name:d.topic, duration:total, scriptId:sid, createdAt:store.now(),
          video:[{id:store.uid('v'),label:'开场钩子',start:0,len:h},{id:store.uid('v'),label:'主内容',start:h,len:b},{id:store.uid('v'),label:'CTA',start:h+b,len:c}],
          subtitle:[{id:store.uid('t'),label:'钩子字幕 · '+d.hook.slice(0,10),start:0,len:h},{id:store.uid('t'),label:'要点字幕 · 正文导入',start:h,len:b},{id:store.uid('t'),label:'CTA 字幕 · '+d.cta.slice(0,10),start:h+b,len:c}],
          music:[{id:store.uid('m'),label:'轻快 BGM',start:0,len:Math.max(1,total-3)}],
          fx:[{id:store.uid('f'),label:'闪白',start:h,len:1}] });
        toast('已送去剪辑台','字幕已从文案自动导入');
        bus.navigate('editor', { project:pid });
      };
    };

    const gen = () => {
      const opts = readForm();
      const d = generate(opts);
      paint({ ...d, opts });
      toast('文案已生成', `${d.dur.v} 秒 · 三段共 ${d.hook.length + d.body.length + d.cta.length} 字`);
    };
    $('#btnGen', root).onclick = gen;
    $('#btnGenTop', root).onclick = () => { gen(); $('#content')?.scrollTo({ top:0, behavior:'smooth' }); };
    $$('[data-opt]', root).forEach(b => b.onclick = () => {
      const k = b.dataset.opt;
      form[k] = k === 'duration' ? Number(b.dataset.val) : b.dataset.val;
      $$( `[data-opt="${k}"]`, root).forEach(x => x.classList.toggle('active', x === b));
    });
    $('#btnReset', root).onclick = () => {
      $('#scTopic', root).value = ''; $('#scNote', root).value = '';
      form.track = 'pet-chew'; form.style = STYLES[0]; form.duration = 30;
      $$('[data-opt]', root).forEach(x => x.classList.toggle('active',
        (x.dataset.opt==='track' && x.dataset.val==='pet-chew') || (x.dataset.opt==='style' && x.dataset.val===form.style) || (x.dataset.opt==='duration' && x.dataset.val==='30')));
      toast('已重置','按默认值重新生成即可'); gen();
    };
    $('#btnHistory', root).onclick = () => {
      const list = store.get('scripts', []);
      modal({ title:'历史口播稿', desc:`共 ${list.length} 条`, wide:true,
        body:list.length ? list.map(s=>`<div class="block hoverable"><div class="block-head"><b>${esc(s.title)}</b><span class="badge gray">${s.duration}s · ${esc(s.createdAt)}</span></div><p>${esc(s.hook)}</p><div class="row" style="margin-top:7px"><button class="btn btn-sm" data-load="${s.id}">载入到配置</button></div></div>`).join('') : '<div class="empty">还没有历史稿</div>',
        onMount:(m, close) => $$('[data-load]', m).forEach(b => b.onclick = () => {
          const s = list.find(x => x.id === b.dataset.load);
          $('#scTopic', root).value = s.title;
          form.track = s.track; form.style = s.style; form.duration = s.duration;
          $$('[data-opt]', root).forEach(x => x.classList.toggle('active', x.dataset.val === String(form[x.dataset.opt])));
          close(); gen(); toast('已载入历史稿','可在此基础上继续修改');
        }) });
    };
    gen();
  },
};
