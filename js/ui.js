import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export function toast(title, desc = '', type = '') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<div class="t-title">${esc(title)}</div>${desc ? `<div class="t-desc">${esc(desc)}</div>` : ''}`;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = '.25s'; setTimeout(() => el.remove(), 260); }, 2900);
}

export function modal({ title, desc = '', body = '', actions = [], wide = false, onMount }) {
  const root = $('#modal-root');
  root.hidden = false;
  root.innerHTML = `<div class="modal-mask"></div><div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><div><h3>${esc(title)}</h3>${desc ? `<p>${esc(desc)}</p>` : ''}</div>
    <button class="icon-btn" data-close title="关闭">${icon('x', 16)}</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot"></div></div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  $$('[data-close]', root).forEach(b => b.onclick = close);
  $('.modal-mask', root).onclick = close;
  const foot = $('.modal-foot', root);
  (actions.length ? actions : [{ label:'知道了', primary:true }]).forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.primary ? 'btn-primary' : (a.danger ? 'btn-danger' : ''));
    b.textContent = a.label;
    // close:false 的 action 自己接管关闭（例如成功后同步打开下一个弹窗），
    // 避免依赖 setTimeout 在后台标签页被节流而丢失后续界面。
    b.onclick = async () => {
      if (a.onClick) {
        const r = await a.onClick(close);
        if (r !== false && a.close !== false) close();
      } else close();
    };
    foot.appendChild(b);
  });
  if (onMount) onMount(root, close);
  return close;
}

export function confirmDlg(title, desc, onYes, yesLabel = '确认') {
  return modal({ title, desc, actions:[
    { label:'取消' },
    { label:yesLabel, primary:true, onClick:() => { onYes(); } },
  ]});
}

export async function copyText(text, label = '内容') {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制', `${label}已写入剪贴板`);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制', `${label}已写入剪贴板`); }
    catch (e) { toast('复制失败', '请手动选择文本复制', 'error'); }
    ta.remove();
  }
}

export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('已导出', filename);
}

export function pickFile(accept = '*/*') {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

export const fmtNum = n => {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};
export const fmtDateCN = d => `${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日 · 星期${'日一二三四五六'[d.getDay()]}`;
export const pad = n => String(n).padStart(2, '0');

export function sparkline(points, color = '#3f9d8f', w = 76, h = 30) {
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const xy = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - 3 - ((p - min) / span) * (h - 8)}`).join(' ');
  return `<svg class="stat-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${xy}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${w}" cy="${xy.split(' ').pop().split(',')[1]}" r="2.4" fill="${color}"/></svg>`;
}

export function pageHead(title, sub, actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="head-actions">${actions}</div></div>`;
}

export function card(title, sub, body, extraClass = '') {
  return `<div class="card card-pad ${extraClass}"><div class="card-title"><h3>${esc(title)}</h3>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>${body}</div>`;
}

export function empty(text, ico = 'folder') {
  return `<div class="empty">${icon(ico, 30)}<div>${esc(text)}</div></div>`;
}

export function bindCollapse(root) {
  $$('[data-collapse]', root).forEach(btn => {
    btn.onclick = () => {
      const target = document.getElementById(btn.dataset.collapse);
      if (!target) return;
      const open = target.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
  });
}
