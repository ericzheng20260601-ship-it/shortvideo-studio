import { icon } from './icons.js';
import { TRACKS, trackOf } from './data.js';
import { $, $$, esc, toast, modal, confirmDlg, pickFile } from './ui.js';
import { cloud, cloudEnabled, staticFallback, cloudNotice, getCloudSession, startCloudLogin, signOutCloud } from './cloud.js';
import { bus } from './bus.js';

/*
 * 云端素材库：视频 / 音频 / 图片统一存入应用云存储，按「来源」分到不同文件夹：
 *   shared/<uid>/media/original/<kind>/...   用户上传的原视频、原音频、原图
 *   shared/<uid>/media/generated/<kind>/...  剪辑 / 智能成片产出的新视频与配套素材
 * 元数据写入 video_assets（沿用历史表名，已扩展为通用媒体素材表）。
 * 静态备份站没有云服务 Origin，明确禁用，不把本地文件冒充已上传。
 */
const TABLE = 'video_assets';

const KINDS = {
  video: { label: '视频', ico: 'video', accept: 'video/*', exts: ['mp4', 'mov', 'webm', 'm4v', 'mkv'], max: 200 * 1024 * 1024, maxLabel: '200 MB', fallbackType: 'video/mp4' },
  audio: { label: '音频', ico: 'music', accept: 'audio/*', exts: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aiff'], max: 50 * 1024 * 1024, maxLabel: '50 MB', fallbackType: 'audio/mpeg' },
  image: { label: '图片', ico: 'image', accept: 'image/*', exts: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'avif', 'bmp'], max: 20 * 1024 * 1024, maxLabel: '20 MB', fallbackType: 'image/png' },
};
const CATEGORIES = {
  original: { label: '原素材', folder: 'media/original', ico: 'upload', desc: '我拍摄或已获授权的原始视频、音频、图片' },
  generated: { label: '生产成片', folder: 'media/generated', ico: 'wand', desc: '剪辑台、智能成片产出的新视频与配套素材' },
};
const KIND_ORDER = ['video', 'audio', 'image'];
const CAT_ORDER = ['original', 'generated'];
const sizeText = b => b < 1024 * 1024 ? (b / 1024).toFixed(0) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB';
const signedUrlOf = d => typeof d === 'string' ? d : (d?.url || d?.signedUrl || d?.data?.url || '');
const errMsg = (e, fallback) => e?.message || e?.error?.message || fallback;
const kindOf = v => KINDS[v] ? v : 'video';
const catOf = v => CATEGORIES[v] ? v : 'original';

function extOf(file, kind) {
  const hit = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return hit ? '.' + hit[1] : ({ video: '.mp4', audio: '.mp3', image: '.png' })[kind] || '.bin';
}

function detectKind(file) {
  const mime = String(file.type || '').toLowerCase();
  const ext = (String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  for (const k of KIND_ORDER) if (mime.startsWith(k + '/')) return k;
  for (const k of KIND_ORDER) if (KINDS[k].exts.includes(ext)) return k;
  return null;
}

function probeDuration(file, kind) {
  return new Promise(resolve => {
    if (kind === 'image') { resolve(null); return; }
    let done = false;
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    const finish = value => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => finish(isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : null);
    el.onerror = () => finish(null);
    el.src = url;
    setTimeout(() => finish(null), 5000);
  });
}

function folderOf(category, kind) {
  return `${CATEGORIES[catOf(category)].folder}/${kindOf(kind)}`;
}

async function uploadOne(session, { file, kind, category, title, track, note, duration }) {
  const uid = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const folder = folderOf(category, kind);
  const path = cloud.storage.sharedPath(session.user.id, `${folder}/${uid}${extOf(file, kind)}`);
  const up = await cloud.storage.upload(path, file, {
    contentType: file.type || KINDS[kind].fallbackType,
    upsert: false,
    metadata: { purpose: 'media-asset', kind, category },
  });
  if (up.error) throw new Error(errMsg(up.error, '文件上传失败'));

  // owner_id 由数据库 DEFAULT auth.uid() 填充，客户端不传。
  const ins = await cloud.database.from(TABLE).insert({
    title, track,
    file_name: String(file.name || 'media').slice(0, 180),
    storage_path: path,
    file_size: file.size,
    duration,
    mime_type: file.type || '',
    note: note || null,
    owner_name: session.user?.name ?? null,
    media_type: kind,
    category,
    folder,
  }).select();
  if (ins.error) {
    // 元数据写失败时清理孤儿文件，避免存储里留下看不见的对象。
    try { await cloud.storage.remove([path]); } catch (_) { /* noop */ }
    throw new Error(errMsg(ins.error, '元数据写入失败'));
  }
  return ins.data?.[0];
}

function openUploadDialog(session, refresh, preset = {}) {
  let file = null, kind = null, busy = false;
  let category = catOf(preset.category || 'original');

  const syncPath = (mroot) => {
    const k = kind || kindOf(preset.kind || 'video');
    $('#cmFolder', mroot).textContent = `shared/<你的账号>/${folderOf(category, k)}/`;
    $('#cmCatTip', mroot).textContent = category === 'generated'
      ? '智能成片 / 在线剪辑台产出的是工程包：请先把成片导出为本地视频文件（如 MP4）再上传，文件会进入「生产成片」文件夹。'
      : '原始拍摄的视频、音频、图片进入「原素材」文件夹，后续剪辑时可从这里取用。';
  };
  const syncKind = (mroot) => {
    const box = $('#cmKind', mroot);
    box.innerHTML = KIND_ORDER.map(k =>
      `<span class="chip ${kind === k ? 'active' : ''}" data-cmkind="${k}">${icon(KINDS[k].ico, 13)} ${KINDS[k].label}</span>`).join('');
    $$('[data-cmkind]', mroot).forEach(b => b.onclick = () => {
      kind = b.dataset.cmkind;
      syncKind(mroot); syncPath(mroot);
    });
  };

  modal({
    title: '上传云端素材',
    desc: '视频 / 音频 / 图片存入应用云存储，按来源分文件夹归类',
    body: `
      <div class="field"><label class="field-label">本地文件</label>
        <div class="row row-wrap" style="gap:8px">
          <button class="btn" id="cmPick" type="button">${icon('upload', 13)} 选择文件</button>
          <span class="small muted" id="cmFileName">未选择文件</span>
        </div>
        <div class="field-hint">视频 ≤ 200 MB · 音频 ≤ 50 MB · 图片 ≤ 20 MB；类型自动识别，也可手动指定。</div>
      </div>
      <div class="field"><label class="field-label">素材类型</label>
        <div class="row row-wrap" style="gap:6px" id="cmKind"></div></div>
      <div class="field"><label class="field-label" for="cmCategory">存入文件夹</label>
        <select class="select" id="cmCategory">
          ${CAT_ORDER.map(c => `<option value="${c}" ${c === category ? 'selected' : ''}>${CATEGORIES[c].label} · ${CATEGORIES[c].desc}</option>`).join('')}
        </select>
        <div class="field-hint" id="cmFolder"></div>
        <div class="field-hint" id="cmCatTip"></div></div>
      <div class="field"><label class="field-label" for="cmTitle">素材标题</label>
        <input class="input" id="cmTitle" placeholder="例如：宠物磨牙实拍 30 秒" value="${esc(preset.title || '')}" /></div>
      <div class="field"><label class="field-label" for="cmTrack">所属赛道</label>
        <select class="select" id="cmTrack">${TRACKS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="field-label" for="cmNote">备注（可选）</label>
        <textarea class="textarea" id="cmNote" placeholder="拍摄场景、可用镜头、授权说明…"></textarea></div>
      <div class="field-hint" id="cmProgress">就绪 · 上传前请确认你对文件拥有使用权。</div>
      <div class="notice-box" style="margin-top:8px">版权提示：只上传自有或已获授权的文件。达人内容请保留原平台链接，不要下载后转存再分发。</div>`,
    actions: [
      { label: '取消' },
      { label: '开始上传', primary: true, onClick: async () => {
        if (busy) return false;
        const title = ($('#cmTitle')?.value || '').trim();
        if (!file) { toast('请先选择文件', '支持视频 / 音频 / 图片', 'warn'); return false; }
        if (!kind) { toast('无法识别素材类型', '请手动选择视频、音频或图片', 'warn'); return false; }
        if (!title) { toast('请填写素材标题', '', 'warn'); return false; }
        if (file.size > KINDS[kind].max) { toast('文件超过上限', `${KINDS[kind].label}最大 ${KINDS[kind].maxLabel}，当前 ${sizeText(file.size)}`, 'error'); return false; }
        category = $('#cmCategory')?.value || category;
        busy = true;
        $('#cmProgress').textContent = '正在读取文件元数据…';
        try {
          const duration = await probeDuration(file, kind);
          $('#cmProgress').textContent = `正在上传 ${sizeText(file.size)} 到 ${folderOf(category, kind)}/，请勿关闭页面…`;
          await uploadOne(session, {
            file, kind, category, title,
            track: $('#cmTrack')?.value || 'knowledge',
            note: ($('#cmNote')?.value || '').trim(), duration,
          });
          toast('上传完成', `${title} 已存入「${CATEGORIES[category].label}」文件夹`, 'success');
          refresh();
        } catch (e) {
          $('#cmProgress').textContent = `上传失败：${errMsg(e, '未知错误')}`;
          toast('上传失败', errMsg(e, '请稍后重试'), 'error');
          busy = false;
          return false; // 保留弹窗，方便重试
        }
        busy = false;
      }},
    ],
    onMount: (mroot) => {
      syncKind(mroot); syncPath(mroot);
      $('#cmCategory', mroot).onchange = () => { category = $('#cmCategory', mroot).value; syncPath(mroot); };
      $('#cmPick', mroot).onclick = async () => {
        const f = await pickFile('video/*,audio/*,image/*');
        if (!f) return;
        const detected = detectKind(f);
        if (!detected) { toast('不支持的文件类型', '请选择视频、音频或图片文件', 'error'); return; }
        if (f.size > KINDS[detected].max) { toast('文件超过上限', `${KINDS[detected].label}最大 ${KINDS[detected].maxLabel}`, 'error'); return; }
        file = f; kind = detected;
        $('#cmFileName', mroot).textContent = `${f.name} · ${sizeText(f.size)}`;
        $('#cmFileName', mroot).classList.remove('muted');
        if (!$('#cmTitle', mroot).value.trim()) $('#cmTitle', mroot).value = f.name.replace(/\.[^.]+$/, '');
        syncKind(mroot); syncPath(mroot);
      };
    },
  });
}

async function openPreview(row) {
  let r;
  try { r = await cloud.storage.createSignedUrl(row.storage_path, 3600); }
  catch (e) { toast('无法预览', errMsg(e, '签名地址获取失败'), 'error'); return; }
  if (r?.error) { toast('无法预览', errMsg(r.error, '签名地址获取失败'), 'error'); return; }
  const url = signedUrlOf(r?.data);
  if (!url) { toast('无法预览', '未返回签名地址', 'error'); return; }

  const kind = kindOf(row.media_type), category = catOf(row.category);
  const t = trackOf(row.track);
  const media = kind === 'image'
    ? `<img class="cloud-vplayer cloud-vimage" src="${esc(url)}" alt="${esc(row.title)}" />`
    : kind === 'audio'
      ? `<div class="cloud-vaudio">${icon('music', 34)}<audio controls preload="metadata" src="${esc(url)}"></audio></div>`
      : `<video class="cloud-vplayer" controls playsinline preload="metadata" src="${esc(url)}"></video>`;
  modal({
    title: row.title,
    desc: `${KINDS[kind].label} · ${CATEGORIES[category].label} · ${t.name} · ${sizeText(row.file_size || 0)}${row.duration ? ` · ${row.duration}s` : ''}`,
    wide: true,
    body: `${media}
      <div class="small muted" style="margin-top:9px">播放地址为 1 小时有效的签名链接，仅当前登录会话可获取；不会写入仓库或长期保存。</div>
      <div class="block" style="margin-top:10px"><div class="block-head"><b>所在文件夹</b><span class="badge">${esc(CATEGORIES[category].label)}</span></div>
        <p class="small">${esc(row.folder || folderOf(category, kind))}/ · ${esc(row.file_name || '素材文件')}</p></div>
      ${row.note ? `<div class="block" style="margin-top:10px"><div class="block-head"><b>备注</b></div><p class="small">${esc(row.note)}</p></div>` : ''}`,
    actions: [{ label: '关闭', primary: true }],
  });
}

function moveAsset(row, session, refresh) {
  if (row.owner_id !== session.user?.id) { toast('无权移动', '只有上传者本人可以更改分类', 'warn'); return; }
  const from = catOf(row.category), to = from === 'original' ? 'generated' : 'original';
  confirmDlg(`移动到「${CATEGORIES[to].label}」文件夹？`,
    `「${row.title}」的文件会从 ${folderOf(from, row.media_type)}/ 移动到 ${folderOf(to, row.media_type)}/，分类与路径同步更新。`,
    async () => {
      const kind = kindOf(row.media_type);
      const folder = folderOf(to, kind);
      const base = String(row.storage_path || '').split('/').pop() || `${Date.now()}${extOf({ name: row.file_name }, kind)}`;
      const newPath = cloud.storage.sharedPath(session.user.id, `${folder}/${base}`);
      try {
        const mv = await cloud.storage.move(row.storage_path, newPath);
        if (mv?.error) { toast('移动失败', errMsg(mv.error, '文件移动被拒绝'), 'error'); return; }
      } catch (e) { toast('移动失败', errMsg(e, '请重试'), 'error'); return; }
      const up = await cloud.database.from(TABLE)
        .update({ category: to, folder, storage_path: newPath }).eq('id', row.id).select();
      if (up.error || !up.data?.length) {
        try { await cloud.storage.move(newPath, row.storage_path); } catch (_) { /* 回滚失败如实提示 */ }
        toast('分类更新失败', '文件已放回原文件夹，请重试', 'error');
        return;
      }
      toast('已移动', `${row.title} → ${CATEGORIES[to].label}`);
      refresh();
    }, '移动');
}

function deleteAsset(row, session, refresh) {
  if (row.owner_id !== session.user?.id) { toast('无权删除', '只有上传者本人可以删除这条云端素材', 'warn'); return; }
  confirmDlg('删除云端素材？', `「${row.title}」的文件与元数据都会被删除，此操作不可撤销。`, async () => {
    try {
      const rm = await cloud.storage.remove([row.storage_path]);
      if (rm?.error) { toast('文件删除失败', errMsg(rm.error, '请先重试'), 'error'); return; }
    } catch (e) { toast('文件删除失败', errMsg(e, '请重试'), 'error'); return; }
    const d = await cloud.database.from(TABLE).delete().eq('id', row.id).select();
    if (d.error) { toast('记录删除失败', errMsg(d.error, '请重试'), 'error'); return; }
    if (!d.data?.length) { toast('删除被拒绝', '仅上传者可删除，或记录已不存在', 'warn'); return; }
    toast('已删除云端素材', row.title);
    refresh();
  }, '删除');
}

function cardHTML(row, session) {
  const t = trackOf(row.track);
  const kind = kindOf(row.media_type), category = catOf(row.category);
  const mine = row.owner_id === session.user?.id;
  const at = String(row.created_at || '').slice(0, 10);
  return `<div class="cloud-vcard" data-cm="${row.id}">
    <div class="cloud-vthumb" style="background:${t.grad}">
      <span>${icon(KINDS[kind].ico, 34)}</span>
      <span class="cv-play">${icon('play', 14)}</span>
      ${row.duration ? `<span class="cv-dur">${row.duration}s</span>` : ''}
      <span class="cv-tag">${icon('cloud', 11)} 云端</span>
    </div>
    <div class="row" style="justify-content:space-between;gap:8px;margin-top:10px">
      <b class="small">${esc(row.title)}</b>
      <span class="badge ${category === 'generated' ? 'purple' : 'blue'}">${CATEGORIES[category].label}</span>
    </div>
    <div class="small muted" style="margin-top:5px">${esc(row.file_name || '素材文件')} · ${at}</div>
    <div class="clip-metrics">
      <span>${KINDS[kind].label}</span><span>${sizeText(row.file_size || 0)}</span><span>${esc(row.owner_name || '云端账号')}</span>
    </div>
    <div class="lib-foot">
      <button class="btn btn-sm btn-soft" data-cm-view="${row.id}">${icon('play', 12)} 预览</button>
      <button class="btn btn-sm btn-ghost" data-cm-move="${row.id}" title="移动到另一个文件夹" ${mine ? '' : 'disabled'}>${icon('folder', 12)}</button>
      <button class="btn btn-sm btn-ghost" data-cm-del="${row.id}" title="${mine ? '删除' : '仅上传者可删除'}" ${mine ? '' : 'disabled'}>${icon('trash', 12)}</button>
    </div>
  </div>`;
}

function groupHTML(category, list, session) {
  const c = CATEGORIES[category];
  return `<div class="media-group">
    <div class="media-folder-head">
      <span class="media-folder-ico">${icon(c.ico, 16)}</span>
      <div style="flex:1;min-width:0">
        <b>${c.label}<span class="media-folder-count">${list.length} 个文件</span></b>
        <div class="media-folder-path">shared/&lt;uid&gt;/${c.folder}/&lt;video | audio | image&gt;/ · ${esc(c.desc)}</div>
      </div>
    </div>
    ${list.length
      ? `<div class="cloud-vgrid">${list.map(r => cardHTML(r, session)).join('')}</div>`
      : `<div class="empty" style="min-height:88px">这个文件夹暂时没有素材</div>`}
  </div>`;
}

export async function initCloudMedia(root) {
  let rows = [], session = null, cat = 'all', kind = 'all', ready = false;

  const drawList = () => {
    const list = $('#mediaList', root);
    if (!ready || !list) return;
    const shown = rows.filter(r => (cat === 'all' || catOf(r.category) === cat) && (kind === 'all' || kindOf(r.media_type) === kind));
    $('#mediaCount', root).textContent = `${shown.length} / ${rows.length} 个文件`;
    $('#mediaHint', root).textContent = '文件按来源分文件夹存放：原素材 / 生产成片，各自再按视频、音频、图片分目录。所有登录用户可预览，仅上传者可移动或删除。';
    const groups = CAT_ORDER.filter(c => cat === 'all' || cat === c);
    const banner = !rows.length
      ? `<div class="cloud-vempty" style="margin-bottom:12px">${icon('cloud', 28)}<div><b>云端素材库还是空的</b>
          <div class="small muted" style="margin-top:5px">点「上传原素材」或「成片入库」，文件会按来源进入下面两个文件夹</div></div></div>`
      : (!shown.length ? '<div class="notice-box" style="margin-bottom:12px">当前筛选下没有素材，切换来源或类型试试。</div>' : '');
    list.innerHTML = banner + groups.map(c => groupHTML(c, shown.filter(r => catOf(r.category) === c), session)).join('');
    $$('[data-cm-view]', root).forEach(b => b.onclick = () => {
      const row = rows.find(r => String(r.id) === b.dataset.cmView);
      if (row) openPreview(row);
    });
    $$('[data-cm-move]', root).forEach(b => b.onclick = () => {
      const row = rows.find(r => String(r.id) === b.dataset.cmMove);
      if (row) moveAsset(row, session, paint);
    });
    $$('[data-cm-del]', root).forEach(b => b.onclick = () => {
      const row = rows.find(r => String(r.id) === b.dataset.cmDel);
      if (row) deleteAsset(row, session, paint);
    });
  };

  const paint = async () => {
    ready = false;
    const status = $('#mediaStatus', root), list = $('#mediaList', root);
    const hint = $('#mediaHint', root), count = $('#mediaCount', root);
    const btnUp = $('#btnUploadMedia', root), btnGen = $('#btnUploadGenerated', root), btnLogin = $('#btnCloudLogin', root);
    if (!status || !list) return;

    const disable = () => { btnUp.disabled = true; btnGen.disabled = true; btnLogin.disabled = true; };
    if (staticFallback) {
      status.textContent = '静态备份站 · 云端能力不可用';
      count.textContent = '—';
      list.innerHTML = `<div class="notice-box">${esc(cloudNotice)}<br/>文案、拆解与剪辑工程仍保存在本机，刷新不丢失；请在 WorkBuddy 发布链接中登录后上传云端素材。</div>`;
      hint.textContent = 'GitHub Pages 与本地预览没有云服务 Origin，服务端会拒绝请求。';
      disable();
      return;
    }
    if (!cloudEnabled) {
      status.textContent = '云服务 SDK 未加载';
      count.textContent = '—';
      list.innerHTML = '<div class="notice-box">云端组件未能初始化，请检查网络后刷新页面。其他功能不受影响。</div>';
      hint.textContent = 'SDK 通过 CDN 加载，若公司网络屏蔽 CDN 会走此提示。';
      disable();
      return;
    }

    session = await getCloudSession();
    btnUp.disabled = false; btnGen.disabled = false; btnLogin.disabled = false;
    if (!session) {
      status.textContent = '未登录 · 上传需 WorkBuddy 账号';
      count.textContent = '—';
      list.innerHTML = `<div class="cloud-vempty">${icon('cloud', 28)}
        <div><b>登录后查看与上传云端素材</b><div class="small muted" style="margin-top:5px">视频、音频、图片会按「原素材 / 生产成片」分文件夹存入应用云存储。</div></div>
        <button class="btn btn-primary btn-sm" id="cmLoginInline">使用 WorkBuddy 登录</button></div>`;
      hint.textContent = '按需登录：不登录时，文案、拆解、剪辑工程等本地功能全部照常可用。';
      btnLogin.innerHTML = `${icon('shield', 14)} 使用 WorkBuddy 登录`;
      $('#cmLoginInline', root).onclick = () => btnLogin.click();
      return;
    }

    status.textContent = `已登录 · ${session.user?.name || 'WorkBuddy 账号'}`;
    btnLogin.innerHTML = `${icon('logout', 14)} 退出云端账号`;
    const res = await cloud.database.from(TABLE).select('*').order('created_at', { ascending: false }).limit(100);
    if (res.error) {
      rows = [];
      list.innerHTML = `<div class="notice-box">云端列表读取失败：${esc(errMsg(res.error, '未知错误'))}</div>`;
      hint.textContent = res.error.code === '42P01' ? '云端素材表尚未创建。' : '可稍后重试。';
      count.textContent = '—';
      return;
    }
    rows = Array.isArray(res.data) ? res.data : [];
    ready = true;
    drawList();
  };

  const requireLogin = () => modal({
    title: '需要登录 WorkBuddy 账号',
    desc: '上传与预览云端素材需要真实登录会话',
    body: '<div class="notice-box">云存储按登录会话校验权限，不接受匿名上传。邮箱 + 密码登录仍是本站的访问门槛；这里的 WorkBuddy 账号登录只用于云端素材，不影响其他本地功能。</div>',
    actions: [
      { label: '暂不登录' },
      { label: '使用 WorkBuddy 登录', primary: true, onClick: async () => {
        const r = await startCloudLogin();
        if (r.error) toast('登录未启动', errMsg(r.error, '请稍后重试'), 'error');
      }},
    ],
  });

  const openWith = async (preset) => {
    if (staticFallback || !cloudEnabled) { toast('云端能力不可用', cloudNotice || '请刷新页面重试', 'warn'); return; }
    const s = await getCloudSession();
    if (!s) { requireLogin(); return; }
    openUploadDialog(s, paint, preset);
  };

  $('#btnUploadMedia', root).onclick = () => openWith({ category: 'original' });
  $('#btnUploadGenerated', root).onclick = () => openWith({ category: 'generated', kind: 'video' });
  $('#btnCloudLogin', root).onclick = async () => {
    const s = await getCloudSession();
    if (s) {
      confirmDlg('退出云端账号？', '退出后仍可使用全部本地功能，重新登录即可继续上传与预览云端素材。', async () => {
        await signOutCloud(); location.reload();
      }, '退出');
    } else {
      const r = await startCloudLogin();
      if (r.error) toast('登录未启动', errMsg(r.error, '请稍后重试'), 'error');
    }
  };
  $('#btnGoCloud', root).onclick = () => {
    const card = $('#cloudMediaCard', root);
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card?.classList.add('pulse-focus');
    setTimeout(() => card?.classList.remove('pulse-focus'), 1400);
  };
  $$('[data-mcat]', root).forEach(b => b.onclick = () => {
    cat = b.dataset.mcat;
    $$('[data-mcat]', root).forEach(x => x.classList.toggle('active', x === b));
    drawList();
  });
  $$('[data-mkind]', root).forEach(b => b.onclick = () => {
    kind = b.dataset.mkind;
    $$('[data-mkind]', root).forEach(x => x.classList.toggle('active', x === b));
    drawList();
  });

  await paint();

  // 从「智能成片」跳过来时，直接打开「生产成片」上传弹窗（一次性消费）。
  if (bus.pending?.uploadGenerated) {
    const title = bus.pending.title || '';
    bus.pending = { ...bus.pending, uploadGenerated: false };
    setTimeout(() => {
      if (!session) { toast('请先登录 WorkBuddy 账号', '成片入库需要云端会话', 'warn'); return; }
      openUploadDialog(session, paint, { category: 'generated', kind: 'video', title });
    }, 260);
  }
  return paint;
}
