import { icon } from '../icons.js';
import { RADAR, TRACKS, BREAKDOWN_LABELS, trackOf } from '../data.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, copyText } from '../ui.js';

function splitSentences(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[。！？!?;；])/).map(s => s.trim()).filter(Boolean);
}
function decompose(text, radar) {
  if (radar) return {
    hook: radar.hook,
    pain: radar.pain,
    proof: radar.proof,
    value: `主卖点：${radar.product}；标签：${radar.tags.join(' / ')}。`,
    cta: radar.cta,
    source: radar.title,
  };
  const parts = splitSentences(text);
  if (!parts.length) return null;
  const take = (a, b) => parts.slice(a, b).join('');
  return {
    hook: parts[0] || '（未识别到开场句，建议补一句冲突或结果）',
    pain: parts[1] || '（未识别到痛点句，建议补一个具体麻烦）',
    proof: parts[2] || '（未识别到证据句，建议补实测 / 成分 / 对比）',
    value: parts.length > 4 ? take(3, parts.length - 1) : (parts[3] || '（未识别到卖点句）'),
    cta: parts[parts.length - 1] || '（未识别到行动号召）',
    source: text.slice(0, 24) + (text.length > 24 ? '…' : ''),
  };
}
function resultHTML(seg) {
  const total = BREAKDOWN_LABELS.reduce((s, l) => s + (seg[l.key] || '').length, 0) || 1;
  return `<div class="card card-pad">
    <div class="card-title"><h3>拆解结果</h3><span class="sub">${esc(seg.source)}</span></div>
    <div class="struct-bar">${BREAKDOWN_LABELS.map(l => {
      const w = ((seg[l.key] || '').length / total * 100).toFixed(1);
      return `<i style="width:${w}%;background:${l.color}" title="${esc(l.name)} ${w}%"></i>`;
    }).join('')}</div>
    <div class="legend">${BREAKDOWN_LABELS.map(l=>`<span><i style="background:${l.color}"></i>${esc(l.name)} ${((seg[l.key]||'').length/total*100).toFixed(0)}%</span>`).join('')}</div>
    <div class="divider"></div>
    ${BREAKDOWN_LABELS.map((l, i) => `<div class="block hoverable">
      <div class="block-head"><b><span class="tag-dot" style="background:${l.color}"></span>${i+1}. ${esc(l.name)}</b>
        <span class="badge gray">${(seg[l.key]||'').length} 字</span></div>
      <p>${esc(seg[l.key])}</p>
      <div class="small muted" style="margin-top:5px">${esc(l.tip)}</div>
    </div>`).join('')}
    <div class="divider"></div>
    <div class="row row-wrap">
      <button class="btn btn-soft" id="btnCopyStruct">${icon('copy',13)} 复制结构</button>
      <button class="btn" id="btnSaveStruct">${icon('save',13)} 存素材库</button>
      <button class="btn btn-primary" id="btnToScript">${icon('arrowRight',13)} 按此结构写文案</button>
    </div>
  </div>`;
}
const ADVICE = [
  '钩子只留一个信息：一个具体麻烦或一个反常识结论，不要同时讲两件事。',
  '证据要能被验证：实测天数、成分表、半脸对照，比「效果很好」有效得多。',
  'CTA 只给一个动作，且动作成本要低到看完就能做（截图、扣 1、看置顶）。',
];

export default {
  render() {
    const preset = bus.pending?.radar;
    return `
    ${pageHead('AI 文案拆解','把别人的爆款拆成结构，再复用成自己的骨架',
      `<button class="btn" id="btnRules">${icon('info',14)} 拆解规则</button>
       <button class="btn btn-primary" id="btnFromRadar">${icon('radar',14)} 从爆款雷达选一条</button>`)}
    <div class="split">
      <div>
        <div class="card card-pad">
          <div class="card-title"><h3>输入爆款文案</h3><span class="sub">粘贴或从雷达带入</span></div>
          <div class="field"><label class="field-label" for="bdSource">来源（可选）</label>
            <select class="select" id="bdSource"><option value="">手动粘贴</option>${RADAR.map(r=>`<option value="${r.id}" ${preset===r.id?'selected':''}>${esc(r.title.slice(0,26))}…</option>`).join('')}</select></div>
          <div class="field"><label class="field-label" for="bdText">文案全文</label>
            <textarea class="textarea" id="bdText" placeholder="把爆款口播逐字稿粘进来，系统会按钩子 / 痛点 / 证据 / 卖点 / CTA 五段切分。">${esc('你家狗是不是一转身就把沙发咬了？换牙期牙床痒，它不是调皮。我们连续 7 天对比了 4 类磨牙物，硬度能用指甲划出印子的才安全。这款软胶环冻过之后能同时缓解肿胀和痒感，每天固定两个时段给就行。收藏这条，买之前对照一遍。')}</textarea>
            <div class="field-hint">规则码 B-01：按句末标点切句 → 首句归钩子、次句归痛点、第三句归证据、末句归 CTA、其余归卖点。</div>
          </div>
          <div class="row row-wrap">
            <button class="btn btn-primary" id="btnRun">${icon('ai',14)} 开始拆解</button>
            <button class="btn" id="btnSample">${icon('refresh',13)} 换示例</button>
            <button class="btn btn-ghost" id="btnClear">清空</button>
          </div>
        </div>
        <div class="card card-pad" style="margin-top:14px">
          <button class="btn btn-soft btn-block collapse-btn" data-collapse="ruleBox" id="btnCollapse">${icon('chevronDown',13)} 展开五段结构说明</button>
          <div class="collapse" id="ruleBox">
            ${BREAKDOWN_LABELS.map(l=>`<div class="block" style="margin-top:10px"><div class="block-head"><b><span class="tag-dot" style="background:${l.color}"></span>${esc(l.name)}</b></div><p>${esc(l.tip)}</p></div>`).join('')}
          </div>
        </div>
      </div>
      <div id="bdResult"></div>
    </div>
    <div class="section-title">${icon('zap',15)} 复用建议 <span class="tiny">从结构到稿子的三条硬规则</span></div>
    <div class="grid g3">${ADVICE.map((a,i)=>`<div class="card card-pad hoverable"><div class="row" style="gap:9px"><span class="flow-idx">${i+1}</span><span class="small">${esc(a)}</span></div></div>`).join('')}</div>`;
  },

  mount(root) {
    const result = $('#bdResult', root);
    let current = null, currentRadarId = null;
    const show = (seg, radarId = null) => {
      current = seg; currentRadarId = radarId;
      result.innerHTML = resultHTML(seg);
      $('#btnCopyStruct', root).onclick = () => copyText(
        BREAKDOWN_LABELS.map(l=>`【${l.name}】\n${seg[l.key]}`).join('\n\n'), '五段结构');
      $('#btnSaveStruct', root).onclick = () => {
        store.add('assets', { id:store.uid('a'), type:'breakdown', title:`结构拆解 · ${seg.source.slice(0,18)}`, track:radarId ? (RADAR.find(r=>r.id===radarId)?.track || 'knowledge') : 'knowledge',
          text:BREAKDOWN_LABELS.map(l=>`${l.name}：${seg[l.key]}`).join(' / '), createdAt:store.now().slice(0,10) });
        toast('已存入素材库','可在素材库按「拆解」筛选');
      };
      $('#btnToScript', root).onclick = () => bus.navigate('script', { radar:radarId, topic:seg.source });
    };

    const run = () => {
      const id = $('#bdSource', root).value;
      const radar = RADAR.find(r => r.id === id);
      const text = $('#bdText', root).value.trim();
      if (!radar && !text) { toast('请先粘贴文案','或从爆款雷达选一条','warn'); return; }
      const seg = decompose(text, radar);
      if (!seg) { toast('无法拆解','文本太短','error'); return; }
      show(seg, radar?.id || null);
      toast('拆解完成','五段结构已生成');
    };
    $('#btnRun', root).onclick = run;
    $('#bdSource', root).onchange = e => {
      const r = RADAR.find(x => x.id === e.target.value);
      if (r) {
        $('#bdText', root).value = [r.hook, r.pain, r.proof, `主卖点：${r.product}，${r.tags.join(' / ')}。`, r.cta].join('');
        run();
      }
    };
    $('#btnSample', root).onclick = () => {
      const r = RADAR[Math.floor(Math.random() * RADAR.length)];
      $('#bdSource', root).value = r.id;
      $('#bdSource', root).onchange({ target:{ value:r.id } });
    };
    $('#btnClear', root).onclick = () => { $('#bdText', root).value = ''; $('#bdSource', root).value = ''; result.innerHTML = '<div class="card card-pad"><div class="empty">拆解结果会显示在这里</div></div>'; };
    $('#btnFromRadar', root).onclick = () => bus.navigate('radar');
    $('#btnRules', root).onclick = () => modal({ title:'拆解规则', desc:'规则码 B-01 · 可复算',
      body:'<div class="notice-box">按句末标点（。！？!?;；）切句 → 首句归钩子、次句归痛点、第三句归证据、末句归 CTA、其余归卖点。占比 = 该段字数 ÷ 五段总字数。若从爆款雷达带入，则直接读取该条目的结构化字段，不做文本推断。</div>' });
    $('#btnCollapse', root).classList.add('collapse-btn');

    const preset = bus.pending?.radar;
    if (preset && RADAR.some(r => r.id === preset)) {
      $('#bdSource', root).value = preset;
      $('#bdSource', root).dispatchEvent(new Event('change'));
    } else {
      const seg = decompose($('#bdText', root).value, null);
      show(seg);
    }
  },
};
