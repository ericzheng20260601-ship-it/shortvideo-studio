import { icon, brand } from '../icons.js';
import { CHECKLIST, PLATFORMS } from '../data.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, downloadFile } from '../ui.js';

const DIMS = [
  ['钩子吸引力', .22], ['信息密度', .18], ['节奏控制', .18], ['字幕可读性', .16], ['CTA 明确度', .14], ['合规与版权', .12],
];

function evaluate(title, checked, duration = 30) {
  const c = id => checked[id] ? 1 : 0;
  const len = title.length;
  const hasNum = /\d/.test(title) ? 1 : 0;
  const lenOk = len >= 8 && len <= 26 ? 1 : 0;
  const short = duration <= 45 ? 1 : 0;
  const vals = [
    72 + 6*hasNum + 8*lenOk + 10*c('c2'),
    70 + 8*lenOk + 12*c('c1') + 8*c('c5'),
    74 + 12*c('c2') + 8*short,
    76 + 14*c('c3') + 8*c('c4'),
    72 + 10*c('c1') + 8*c('c5') + 6*c('c6'),
    70 + 22*c('c6'),
  ].map(v => Math.min(100, v));
  const score = Math.round((vals.reduce((s, v, i) => s + v * DIMS[i][1], 0) / 10) * 10) / 10;
  const dims = vals.map((v, i) => [DIMS[i][0], Math.round(v)]);
  const advice = [];
  if (!c('c1')) advice.push('标题里补一个明确的利益点（省时间 / 避坑 / 可复制的方法）。');
  if (!c('c2')) advice.push('把结果画面提前到前 3 秒，删掉开场铺垫。');
  if (!c('c3')) advice.push('逐字校对字幕，重点核对产品名、成分名与口令词。');
  if (!c('c4')) advice.push('封面文案与标题对齐，避免标题党带来的前 3 秒跳出。');
  if (!c('c5')) advice.push('按「大词 + 赛道词 + 场景词」补到 3–5 个话题标签。');
  if (!c('c6')) advice.push('确认音乐商用授权与出镜素材授权，再进入分发。');
  const lowest = dims.slice().sort((a,b)=>a[1]-b[1])[0];
  advice.push(`当前最低维度是「${lowest[0]}」(${lowest[1]} 分)，优先补这一项对总分的边际收益最大。`);
  return { score, dims, advice, formula:`Σ(维度分×权重)÷10 = ${score.toFixed(1)} · 权重 ${DIMS.map(d=>d[1]).join('/')}` };
}

export default {
  render() {
    const works = store.get('works', []);
    const reviews = store.get('reviews', []);
    const checked = store.get('checklist', {});
    const preset = bus.pending?.title;
    return `
    ${pageHead('成品评估','成片打分、发布前自检，评估完成后一键分发到海外主流平台',
      `<button class="btn" id="btnHistoryReview">${icon('clock',14)} 评估记录</button>
       <button class="btn btn-primary" id="btnRun">${icon('chart',14)} 开始评估</button>`)}
    <div class="grid g2" style="grid-template-columns:.95fr 1.05fr;align-items:start">
      <div class="card card-pad">
        <div class="card-title"><h3>成片评分</h3><span class="badge blue">规则码 V-01</span></div>
        <div class="field"><label class="field-label" for="rvTitle">选择成片 / 输入标题</label>
          <input class="input" id="rvTitle" list="rvWorks" value="${esc(preset || works[0]?.title || '')}" placeholder="例如：磨牙棒 30s 种草片" />
          <datalist id="rvWorks">${works.map(w=>`<option value="${esc(w.title)}"></option>`).join('')}</datalist></div>
        <div class="field"><label class="field-label" for="rvDur">片长（秒）</label><input class="input" id="rvDur" type="number" value="30" min="5" max="600" /></div>
        <div id="scoreBox" style="margin-top:8px"></div>
      </div>
      <div class="card card-pad">
        <div class="card-title"><h3>发布前自检清单</h3><span class="sub" id="checkProgress">0 / 6</span></div>
        <div class="progress" style="margin:0 0 14px"><i id="checkBar" style="width:0%"></i></div>
        <div id="checkList">${CHECKLIST.map(c=>`<div class="check-item ${checked[c.id]?'checked':''}" data-check="${c.id}">
          <span class="check-box">${checked[c.id]?icon('check',12):''}</span>
          <div><b>${esc(c.title)}</b><span>${esc(c.desc)}</span></div></div>`).join('')}</div>
        <div class="divider"></div>
        <div class="row row-wrap"><button class="btn btn-sm" id="btnCheckAll">全选</button><button class="btn btn-sm btn-ghost" id="btnCheckNone">清空</button><span class="spacer"></span>
          <button class="btn btn-sm" id="btnExportReport">${icon('download',13)} 导出评估报告</button></div>
      </div>
    </div>

    <div class="section-title">${icon('share',15)} 一键分发 <span class="tiny">评估完成后解锁平台入口</span></div>
    <div class="card card-pad">
      <div id="platformHint" class="notice-box" style="margin-bottom:14px">先点「开始评估」，下方平台入口即会解锁；建议在分发前把 6 项自检全部勾完。</div>
      <div class="platforms ${reviews.length?'':'locked'}" id="platforms">${PLATFORMS.map(p=>`<a class="platform" href="${p.url}" target="_blank" rel="noopener noreferrer" data-platform="${p.id}" title="打开 ${esc(p.name)} · ${esc(p.sub)}">
        <span style="color:${p.color}">${brand(p.id,24)}</span><b>${esc(p.name)}</b><span>${esc(p.sub)}</span></a>`).join('')}</div>
      <div class="small muted" style="margin-top:12px">跳转均为新标签页打开对应平台后台；本工作台不代发内容、不保存平台账号凭据。</div>
    </div>`;
  },

  mount(root) {
    let current = null;
    const checked = () => store.get('checklist', {});
    const paintChecks = () => {
      const c = checked(), n = CHECKLIST.filter(x=>c[x.id]).length;
      $('#checkProgress', root).textContent = `${n} / 6`;
      $('#checkBar', root).style.width = (n/6*100)+'%';
      $$('[data-check]', root).forEach(el => {
        const on = !!c[el.dataset.check];
        el.classList.toggle('checked', on);
        $('.check-box', el).innerHTML = on ? icon('check',12) : '';
      });
      return n;
    };
    const unlock = () => {
      $('#platforms', root).classList.remove('locked');
      $('#platformHint', root).className = 'notice-box';
      $('#platformHint', root).style.cssText = 'margin-bottom:14px;background:var(--teal-soft);border-color:var(--teal-line);color:var(--teal-dark)';
      $('#platformHint', root).textContent = `评估完成 · 自检 ${paintChecks()}/6 · 平台入口已解锁，点击图标即可跳转对应后台。`;
    };

    const run = () => {
      const title = $('#rvTitle', root).value.trim();
      if (!title) { toast('请先填写成片标题','或从下拉框选择一个作品','warn'); return; }
      const duration = Number($('#rvDur', root).value) || 30;
      const r = evaluate(title, checked(), duration);
      current = { title, duration, ...r };
      $('#scoreBox', root).innerHTML = `<div class="score-ring" style="background:conic-gradient(var(--teal) ${r.score*36}deg, #e9f2f0 0deg)">
          <b>${r.score.toFixed(1)}</b><span>综合评分 / 10</span></div>
        <div class="small muted" style="text-align:center;margin:10px 0 16px">${esc(r.formula)}</div>
        ${r.dims.map(([n,v])=>`<div class="score-dim"><div class="score-dim-head"><b>${esc(n)}</b><span>${v}</span></div><div class="dim-bar"><i style="width:${v}%"></i></div></div>`).join('')}
        <div class="divider"></div><div class="section-title" style="margin:0 0 9px">${icon('zap',14)} 优化建议</div>
        ${r.advice.map((a,i)=>`<div class="block"><div class="block-head"><b>${i+1}. 建议</b></div><p>${esc(a)}</p></div>`).join('')}`;
      store.add('reviews', { id:store.uid('rv'), title, score:r.score, createdAt:store.now(),
        dims:r.dims, advice:r.advice, formula:r.formula });
      unlock();
      toast('评估完成', `${title} · ${r.score.toFixed(1)} 分`);
    };

    $$('[data-check]', root).forEach(el => el.onclick = () => {
      const c = checked(); c[el.dataset.check] = !c[el.dataset.check]; store.set('checklist', c);
      const n = paintChecks();
      if (current) { $('#platformHint',root).textContent = `评估完成 · 自检 ${n}/6 · 平台入口已解锁，点击图标即可跳转对应后台。`; }
    });
    $('#btnCheckAll', root).onclick = () => {
      const c={}; CHECKLIST.forEach(x=>c[x.id]=true); store.set('checklist',c);
      const n = paintChecks(); toast('已全部勾选', `自检 ${n}/6，可重新评估以更新分数`);
      if (current) $('#platformHint',root).textContent = `评估完成 · 自检 ${n}/6 · 平台入口已解锁，分数会在重新评估后更新。`;
    };
    $('#btnCheckNone', root).onclick = () => { store.set('checklist',{}); paintChecks(); toast('已清空自检'); };
    $('#btnRun', root).onclick = run;
    $('#btnExportReport', root).onclick = () => {
      if (!current) { toast('请先完成一次评估','报告基于评估结果生成','warn'); return; }
      const c = checked(), n = CHECKLIST.filter(x=>c[x.id]).length;
      const text = `成品评估报告\n生成时间：${store.now()}\n成片：${current.title}\n片长：${current.duration}s\n综合评分：${current.score.toFixed(1)}/10\n计算口径：${current.formula}\n\n维度分\n${current.dims.map(([a,b])=>`- ${a}：${b}`).join('\n')}\n\n发布前自检（${n}/6）\n${CHECKLIST.map(x=>`[${c[x.id]?'x':' '}] ${x.title} — ${x.desc}`).join('\n')}\n\n优化建议\n${current.advice.map((a,i)=>`${i+1}. ${a}`).join('\n')}\n`;
      downloadFile(`${current.title.slice(0,16)}-评估报告.txt`, text);
    };
    $('#btnHistoryReview', root).onclick = () => {
      const list = store.get('reviews', []);
      modal({ title:'评估记录', desc:`共 ${list.length} 次`, wide:true,
        body:list.length ? list.map(r=>`<div class="block"><div class="block-head"><b>${esc(r.title)}</b><span class="badge">${r.score} 分</span></div><p class="small muted">${esc(r.createdAt)} · ${esc(r.formula||'')}</p></div>`).join('') : '<div class="empty">暂无评估记录</div>' });
    };
    $$('[data-platform]', root).forEach(a => a.onclick = e => {
      if ($('#platforms', root).classList.contains('locked')) { e.preventDefault(); toast('请先完成评估','评估后平台入口会解锁','warn'); }
      else toast('正在打开', `${a.dataset.platform} 后台将在新标签页打开`);
    });
    paintChecks();
    if (bus.pending?.title) setTimeout(run, 120);
  },
};
