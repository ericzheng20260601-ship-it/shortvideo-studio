import { icon } from '../icons.js';
import { QUOTES, quoteIndexByDate, TRACKS } from '../data.js';
import { store } from '../store.js';
import { bus } from '../bus.js';
import { $, $$, esc, toast, modal, pageHead, sparkline, fmtNum, downloadFile, copyText } from '../ui.js';

const QUICK = [
  { id:'radar', ico:'radar', c:'#3f9d8f', bg:'var(--teal-soft)',   t:'找爆款方向', d:'看今 日热度榜' },
  { id:'script', ico:'file', c:'#6d9dc3', bg:'var(--blue-soft)',   t:'写口播稿',   d:'选项填空出稿' },
  { id:'editor', ico:'scissors', c:'#c98a8a', bg:'var(--rose-soft)', t:'进剪辑台', d:'四轨时间线' },
  { id:'auto', ico:'wand', c:'#8d86bd', bg:'var(--purple-soft)', t:'一键成片',   d:'上传视频跑六步' },
  { id:'review', ico:'chart', c:'#c99a5c', bg:'var(--amber-soft)', t:'发布前自检', d:'打分与清单' },
  { id:'library', ico:'folder', c:'#3f9d8f', bg:'var(--teal-soft)', t:'翻素材库',  d:'复用过往积累' },
];
const FLOW = [
  ['爆款雷达','选赛道、看热度，先定方向'],
  ['AI 文案拆解','把爆款拆成钩子 / 痛点 / 证据 / CTA'],
  ['口播文案工坊','按结构填出分段稿'],
  ['在线剪辑台','四轨排布、导入字幕、导出成片'],
  ['智能成片','本地视频六步自动生成工程'],
  ['成品评估','打分、自检、一键分发'],
];

function stats() {
  const works = store.get('works', []), scripts = store.get('scripts', []), assets = store.get('assets', []), reviews = store.get('reviews', []);
  const avg = reviews.length ? (reviews.reduce((s, r) => s + r.score, 0) / reviews.length).toFixed(1) : '—';
  return [
    { key:'works', ico:'video', color:'#3f9d8f', bg:'var(--teal-soft)',   num:works.length,   label:'累计作品', foot:`近 7 天 +${Math.min(works.length,5)}`, spark:[4,5,4,7,6,8,works.length] },
    { key:'scripts', ico:'file', color:'#6d9dc3', bg:'var(--blue-soft)',  num:scripts.length, label:'口播文案', foot:`AI 生成 ${scripts.length} 条`, spark:[1,2,2,3,2,4,scripts.length] },
    { key:'assets', ico:'cloud', color:'#7b93c9', bg:'var(--purple-soft)',num:assets.length,  label:'云端素材', foot:'可复用', spark:[1,1,2,2,3,3,assets.length] },
    { key:'reviews', ico:'chart', color:'#c99a5c', bg:'var(--amber-soft)',num:avg,           label:'平均评分', foot:reviews.length ? `${reviews.length} 次评估` : '暂无评估', spark:[6,6.5,7,7.4,8,8.3,Number(avg)||8] },
  ];
}

export default {
  render() {
    const s = store.get('settings', {});
    const qi = (quoteIndexByDate() + (s.quoteOffset || 0)) % QUOTES.length;
    const [cn, en] = QUOTES[qi];
    const st = stats();
    return `
    ${pageHead('首页概览','创作状态、今日灵感与快速入口，一屏掌握',
      `<button class="btn btn-primary" id="btnNew">${icon('plus',14)} 新建创作项目</button>`)}
    <div class="hero">
      <div>
        <div class="hero-kicker">${icon('spark',14)} 创作状态 · 今天也在稳步推进</div>
        <div class="hero-time" id="heroClock">--:--<span class="sec">:--</span></div>
        <div class="hero-date" id="heroDate">正在读取日期…</div>
        <div class="hero-mini">
          <span class="chip tooltip" data-tip="数据自动保存在本机">${icon('cloud',13)} 本地已保存</span>
          <span class="chip tooltip" data-tip="按做视频顺序排列">${icon('layers',13)} 9 个创作环节</span>
          <span class="chip tooltip" data-tip="宠物 / 香氛 / 护肤">${icon('target',13)} ${TRACKS.length} 条赛道</span>
        </div>
      </div>
      <div class="hero-quote">
        <div class="quote-label">${icon('spark',13)} 每日双语激励 · ${new Date().getMonth()+1}/${new Date().getDate()}</div>
        <div class="quote-cn" id="quoteCn">「${esc(cn)}」</div>
        <div class="quote-en" id="quoteEn">${esc(en)}</div>
        <div class="quote-actions row">
          <button class="btn btn-sm" id="btnQuote">${icon('refresh',13)} 换一句</button>
          <button class="btn btn-sm btn-ghost" id="btnQuoteCopy">${icon('copy',13)} 复制中英</button>
          <button class="btn btn-sm btn-ghost" id="btnQuoteAll">${icon('list',13)} 查看全部</button>
        </div>
      </div>
    </div>

    <div class="section-title">${icon('activity',15)} 创作数据 <span class="tiny">口径：本机工程与素材记录实时统计</span></div>
    <div class="grid g4">
      ${st.map(x => `<div class="card card-pad stat-card hoverable" data-go="${x.key}" role="button" tabindex="0">
        <div class="stat-top"><div class="stat-icon" style="background:${x.bg};color:${x.color}">${icon(x.ico,16)}</div></div>
        ${sparkline(x.spark, x.color)}
        <div class="stat-num">${esc(x.num)}</div>
        <div class="stat-label">${esc(x.label)}</div>
        <div class="stat-foot">${esc(x.foot)}</div>
      </div>`).join('')}
    </div>

    <div class="grid g2" style="margin-top:18px;grid-template-columns:1.15fr .85fr;align-items:start">
      <div class="card card-pad">
        <div class="card-title"><h3>快速入口</h3><span class="sub">点一下直接到对应环节</span></div>
        <div class="grid g2" style="gap:9px">
          ${QUICK.map(q => `<button class="quick-tile" data-go="${q.id}">
            <span class="q-icon" style="background:${q.bg};color:${q.c}">${icon(q.ico,16)}</span>
            <span><b>${esc(q.t)}</b><span>${esc(q.d)}</span></span>
          </button>`).join('')}
        </div>
      </div>
      <div class="card card-pad">
        <div class="card-title"><h3>今日创作建议</h3><span class="badge">${icon('zap',12)} 规则码 H-01</span></div>
        <div class="block"><div class="block-head"><b>先把方向定准</b><span class="badge blue">建议</span></div>
          <p>宠物磨牙赛道近 7 天热度分均值 88.5，高于全站均值；建议先看「爆款雷达」按热度排序的前 3 条，再决定是否开新稿。</p></div>
        <div class="block"><div class="block-head"><b>一条稿只解决一个问题</b><span class="badge purple">结构</span></div>
          <p>钩子选中一个具体麻烦，正文只给 2–3 个可验证信息点，结尾留一个低门槛动作。</p></div>
        <button class="btn btn-soft btn-block" id="btnFlow" data-collapse="flowBox">${icon('chevronDown',13)} 展开完整创作流程</button>
        <div class="collapse" id="flowBox">
          ${FLOW.map((f,i)=>`<div class="flow-step"><span class="flow-idx">${i+1}</span><div><b>${esc(f[0])}</b> <span>· ${esc(f[1])}</span></div></div>`).join('')}
        </div>
      </div>
    </div>`;
  },

  mount(root) {
    const s = store.get('settings', {});
    const qi = () => (quoteIndexByDate() + (store.get('settings', {}).quoteOffset || 0)) % QUOTES.length;
    const refreshQuote = () => {
      const [cn, en] = QUOTES[qi()];
      $('#quoteCn', root).textContent = `「${cn}」`;
      $('#quoteEn', root).textContent = en;
    };
    $('#btnQuote', root).onclick = () => {
      store.set('settings', { ...store.get('settings', {}), quoteOffset:((store.get('settings', {}).quoteOffset || 0) + 1) });
      refreshQuote(); toast('已换一句','每日默认语句仍按日期自动轮换');
    };
    $('#btnQuoteCopy', root).onclick = () => { const [cn,en] = QUOTES[qi()]; copyText(`${cn}\n${en}`, '中英激励短句'); };
    $('#btnQuoteAll', root).onclick = () => modal({
      title:'激励短句库', desc:`共 ${QUOTES.length} 条 · 每日按日期自动轮换`, wide:true,
      body:`<div class="grid g2">${QUOTES.map((q,i)=>`<div class="block ${i===qi()?'':''}" style="${i===qi()?'border-color:var(--teal);background:var(--teal-soft)':''}"><div class="block-head"><b>#${i+1} ${i===qi()?'今日':''}</b></div><p style="font-size:12.5px;color:var(--ink)">${esc(q[0])}</p><p class="small muted" style="margin-top:4px">${esc(q[1])}</p></div>`).join('')}</div>`,
    });

    $('#btnNew', root).onclick = () => modal({
      title:'新建创作项目', desc:'先选赛道与方向，再进入爆款雷达找参考',
      body:`<div class="field"><label class="field-label" for="npName">项目名称</label><input class="input" id="npName" placeholder="例如：磨牙棒 30s 种草片" value="未命名项目" /></div>
        <div class="field"><label class="field-label" for="npTrack">所属赛道</label><select class="select" id="npTrack">${TRACKS.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="notice-box">项目会记入「累计作品」，并带着赛道参数跳到爆款雷达。</div>`,
      actions:[{ label:'取消' },{ label:'创建并去雷达', primary:true, onClick:()=>{
        const name = ($('#npName')?.value || '').trim() || '未命名项目';
        const track = $('#npTrack')?.value || TRACKS[0].id;
        store.add('works', { id:store.uid('w'), title:name, track, createdAt:store.now().slice(0,10) });
        toast('项目已创建', name);
        setTimeout(()=>bus.navigate('radar',{ track }), 120);
      }}],
    });

    $$('[data-go]', root).forEach(el => el.onclick = () => {
      const key = el.dataset.go;
      const map = { works:'library', scripts:'script', assets:'library', reviews:'review' };
      bus.navigate(map[key] || key);
    });
    $('#btnFlow', root).classList.add('collapse-btn');
  },
};
