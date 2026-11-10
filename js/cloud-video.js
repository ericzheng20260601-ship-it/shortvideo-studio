import { icon } from './icons.js';
import { TRACKS, trackOf } from './data.js';
import { $, $$, esc, toast, modal, confirmDlg, pickFile, fmtNum } from './ui.js';
import { cloud, cloudEnabled, staticFallback, cloudNotice, getCloudSession, startCloudLogin, signOutCloud } from './cloud.js';

// 云端原视频：文件进 Storage（shared/<uid>/videos/...），元数据进 video_assets 表。
// Storage 只对已登录会话开放；静态备份站（GitHub Pages / 本地预览）没有云服务 Origin，明确禁用，
// 不伪造会话、不把本地文件冒充为已上传。
const TABLE = 'video_assets';
const MAX_VIDEO = 200 * 1024 * 1024;
const mb = b => (b / 1024 / 1024).toFixed(1) + ' MB';
const signedUrlOf = d => typeof d === 'string' ? d : (d?.url || d?.signedUrl || d?.data?.url || '');
const errMsg = (e, fallback) => e?.message || e?.error?.message || fallback;

function videoExt(file) {
  const name = String(file.name || '').toLowerCase();
  const hit = name.match(/\.(mp4|mov|webm|m4v|mkv)$/);
  if (hit) return '.' + hit[1];
  const type = String(file.type || '').toLowerCase();
  if (type.includes('webm')) return '.webm';
  if (type.includes('quicktime')) return '.mov';
  return '.mp4';
}

function probeDuration(file) {
  return new Promise(resolve => {
    let done = false;
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const finish = value => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    v.preload = 'metadata';
    v.onloadedmetadata = () => finish(isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null);
    v.onerror = () => finish(null);
    v.src = url;
    setTimeout(() => finish(null), 5000);
  });
}

async function uploadOne(session, { file, title, track, note, duration }) {
  const uid = (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const path = cloud.storage.sharedPath(session.user.id, `videos/${uid}${videoExt(file)}`);
  const up = await cloud.storage.upload(path, file, {
    contentType: file.type || 'video/mp4',
    upsert: false,
    metadata: { purpose: 'source-video' },
  });
  if (up.error) throw new Error(errMsg(up.error, '视频文件上传失败'));

  // owner_id 由数据库 DEFAULT auth.uid() 填充，客户端不传。
  const ins = await cloud.database.from(TABLE).insert({
    title, track,
    file_name: String(file.name || 'video').slice(0, 180),
    storage_path: path,
    file_size: file.size,
    duration,
    mime_type: file.type || '',
    note: note || null,
    owner_name: session.user?.name ?? null,
  }).select();
  if (ins.error) {
    // 元数据写失败时清理孤儿文件，避免存储里留下看不见的对象。
    try { await cloud.storage.remove([path]); } catch (_) { /* noop */ }
    throw new Error(errMsg(ins.error, '元数据写入失败'));
  }
  return ins.data?.[0];
}

function openUploadDialog(session, refresh) {
  let file = null, busy = false;
  modal({
    title: '上传原视频',
    desc: '文件存入应用云存储，登录用户可播放，仅上传者可删除',
    body: `
      <div class="field"><label class="field-label">本地视频文件</label>
        <div class="row row-wrap" style="gap:8px">
          <button class="btn" id="cvPick" type="button">${icon('upload', 13)} 选择文件</button>
          <span class="small muted" id="cvFileName">未选择文件</span>
        </div>
        <div class="field-hint">支持 MP4 / MOV / WebM，单文件 ≤ 200 MB。时长会自动从文件元数据读取。</div>
      </div>
      <div class="field"><label class="field-label" for="cvTitle">素材标题</label>
        <input class="input" id="cvTitle" placeholder="例如：宠物磨牙实拍 30 秒" /></div>
      <div class="field"><label class="field-label" for="cvTrack">所属赛道</label>
        <select class="select" id="cvTrack">${TRACKS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="field-label" for="cvNote">备注（可选）</label>
        <textarea class="textarea" id="cvNote" placeholder="拍摄场景、可用镜头、授权说明…"></textarea></div>
      <div class="field-hint" id="cvProgress">就绪 · 上传前请确认你对文件拥有使用权。</div>
      <div class="notice-box" style="margin-top:8px">版权提示：只上传自有或已获授权的视频。达人内容请保留原平台链接，不要下载后转存再分发。</div>`,
    actions: [
      { label: '取消' },
      { label: '开始上传', primary: true, onClick: async () => {
        if (busy) return false;
        const title = ($('#cvTitle')?.value || '').trim();
        if (!file) { toast('请先选择视频文件', '支持 MP4 / MOV / WebM', 'warn'); return false; }
        if (!title) { toast('请填写素材标题', '', 'warn'); return false; }
        if (file.size > MAX_VIDEO) { toast('文件超过 200 MB', `当前 ${mb(file.size)}`, 'error'); return false; }
        busy = true;
        $('#cvProgress').textContent = '正在读取视频元数据…';
        try {
          const duration = await probeDuration(file);
          $('#cvProgress').textContent = `正在上传 ${mb(file.size)} 到云端，请勿关闭页面…`;
          await uploadOne(session, {
            file, title, track: $('#cvTrack')?.value || 'knowledge',
            note: ($('#cvNote')?.value || '').trim(), duration,
          });
          toast('上传完成', `${title} 已入库，可播放`, 'success');
          refresh();
        } catch (e) {
          $('#cvProgress').textContent = `上传失败：${errMsg(e, '未知错误')}`;
          toast('上传失败', errMsg(e, '请稍后重试'), 'error');
          busy = false;
          return false; // 保留弹窗，方便重试
        }
        busy = false;
      }},
    ],
    onMount: (mroot) => {
      $('#cvPick', mroot).onclick = async () => {
        const f = await pickFile('video/*');
        if (!f) return;
        if (f.size > MAX_VIDEO) { toast('文件超过 200 MB', `当前 ${mb(f.size)}`, 'error'); return; }
        file = f;
        $('#cvFileName', mroot).textContent = `${f.name} · ${mb(f.size)}`;
        $('#cvFileName', mroot).classList.remove('muted');
        if (!$('#cvTitle', mroot).value.trim()) $('#cvTitle', mroot).value = f.name.replace(/\.[^.]+$/, '');
      };
    },
  });
}

async function openPlayer(row) {
  let r;
  try { r = await cloud.storage.createSignedUrl(row.storage_path, 3600); }
  catch (e) { toast('无法播放', errMsg(e, '签名地址获取失败'), 'error'); return; }
  if (r?.error) { toast('无法播放', errMsg(r.error, '签名地址获取失败'), 'error'); return; }
  const url = signedUrlOf(r?.data);
  if (!url) { toast('无法播放', '未返回签名地址', 'error'); return; }
  const t = trackOf(row.track);
  modal({
    title: row.title, desc: `${t.name} · ${mb(row.file_size || 0)}${row.duration ? ` · ${row.duration}s` : ''} · ${row.owner_name || '云端账号'}`,
    wide: true,
    body: `<video class="cloud-vplayer" controls playsinline preload="metadata" src="${esc(url)}"></video>
      <div class="small muted" style="margin-top:9px">播放地址为 1 小时有效的签名链接，仅当前登录会话可获取；不会写入仓库或长期保存。</div>
      ${row.note ? `<div class="block" style="margin-top:10px"><div class="block-head"><b>备注</b></div><p class="small">${esc(row.note)}</p></div>` : ''}`,
    actions: [{ label: '关闭', primary: true }],
  });
}

function deleteVideo(row, session, refresh) {
  if (row.owner_id !== session.user?.id) {
    toast('无权删除', '只有上传者本人可以删除这条云端视频', 'warn');
    return;
  }
  confirmDlg('删除云端原视频？', `「${row.title}」的文件与元数据都会被删除，此操作不可撤销。`, async () => {
    try {
      const rm = await cloud.storage.remove([row.storage_path]);
      if (rm?.error) { toast('文件删除失败', errMsg(rm.error, '请先重试'), 'error'); return; }
    } catch (e) { toast('文件删除失败', errMsg(e, '请重试'), 'error'); return; }
    const d = await cloud.database.from(TABLE).delete().eq('id', row.id).select();
    if (d.error) { toast('记录删除失败', errMsg(d.error, '请重试'), 'error'); return; }
    if (!d.data?.length) { toast('删除被拒绝', '仅上传者可删除，或记录已不存在', 'warn'); return; }
    toast('已删除云端视频', row.title);
    refresh();
  }, '删除');
}

function cardHTML(row, session) {
  const t = trackOf(row.track);
  const mine = row.owner_id === session.user?.id;
  const at = String(row.created_at || '').slice(0, 10);
  return `<div class="cloud-vcard" data-cv="${row.id}">
    <div class="cloud-vthumb" style="background:${t.grad}">
      <span>${t.emoji}</span>
      <span class="cv-play">${icon('play', 14)}</span>
      ${row.duration ? `<span class="cv-dur">${row.duration}s</span>` : ''}
      <span class="cv-tag">${icon('cloud', 11)} 云端</span>
    </div>
    <div class="row" style="justify-content:space-between;gap:8px;margin-top:10px">
      <b class="small">${esc(row.title)}</b><span class="badge blue">${esc(t.name)}</span>
    </div>
    <div class="small muted" style="margin-top:5px">${esc(row.file_name || '视频文件')} · ${at}</div>
    <div class="clip-metrics">
      <span>${mb(row.file_size || 0)}</span>
      <span>${esc(row.owner_name || '云端账号')}</span>
      <span>${mine ? '我上传的' : '他人上传'}</span>
    </div>
    <div class="lib-foot">
      <button class="btn btn-sm btn-soft" data-cv-play="${row.id}">${icon('play', 12)} 播放</button>
      <button class="btn btn-sm btn-ghost" data-cv-del="${row.id}" title="${mine ? '删除' : '仅上传者可删除'}" ${mine ? '' : 'disabled'}">${icon('trash', 12)}</button>
    </div>
  </div>`;
}

// 返回值供素材库 mount 调用；所有云端调用都在会话确认之后才发生。
export async function initCloudVideo(root) {
  let rows = [], session = null;

  const paint = async () => {
    const status = $('#cloudVideoStatus', root), list = $('#cloudVideoList', root);
    const hint = $('#cloudVideoHint', root), count = $('#cloudVideoCount', root);
    const btnUp = $('#btnUploadVideo', root), btnLogin = $('#btnCloudLogin', root);
    if (!status || !list) return;

    if (staticFallback) {
      status.textContent = '静态备份站 · 云端能力不可用';
      count.textContent = '—';
      list.innerHTML = `<div class="notice-box">${esc(cloudNotice)}<br/>工程与文案仍保存在本机，刷新不丢失；请使用 WorkBuddy 发布链接登录后上传原视频。</div>`;
      hint.textContent = 'GitHub Pages 与本地预览没有云服务 Origin，服务端会拒绝请求。';
      btnUp.disabled = true; btnLogin.disabled = true;
      return;
    }
    if (!cloudEnabled) {
      status.textContent = '云服务 SDK 未加载';
      count.textContent = '—';
      list.innerHTML = '<div class="notice-box">云端组件未能初始化，请检查网络后刷新页面。其他功能不受影响。</div>';
      hint.textContent = 'SDK 通过 CDN 加载，若公司网络屏蔽 CDN 会走此提示。';
      btnUp.disabled = true; btnLogin.disabled = true;
      return;
    }

    session = await getCloudSession();
    btnUp.disabled = false; btnLogin.disabled = false;
    if (!session) {
      status.textContent = '未登录 · 上传需 WorkBuddy 账号';
      count.textContent = '—';
      list.innerHTML = `<div class="cloud-vempty">${icon('cloud', 28)}
        <div><b>登录后查看与上传云端原视频</b><div class="small muted" style="margin-top:5px">文件会存入应用云存储，元数据进入云数据库；邮箱登录门不受影响。</div></div>
        <button class="btn btn-primary btn-sm" id="cvLoginInline">使用 WorkBuddy 登录</button></div>`;
      hint.textContent = '按需登录：不登录时，文案、素材、剪辑工程等本地功能全部照常可用。';
      btnLogin.innerHTML = `${icon('shield', 14)} 使用 WorkBuddy 登录`;
      $('#cvLoginInline', root).onclick = () => btnLogin.click();
      return;
    }

    status.textContent = `已登录 · ${session.user?.name || 'WorkBuddy 账号'}`;
    btnLogin.innerHTML = `${icon('logout', 14)} 退出云端账号`;
    const res = await cloud.database.from(TABLE).select('*').order('created_at', { ascending: false }).limit(40);
    if (res.error) {
      rows = [];
      list.innerHTML = `<div class="notice-box">云端列表读取失败：${esc(errMsg(res.error, '未知错误'))}</div>`;
      hint.textContent = res.error.code === '42P01' ? 'video_assets 表尚未创建。' : '可稍后重试。';
      return;
    }
    rows = Array.isArray(res.data) ? res.data : [];
    count.textContent = `${rows.length} 条`;
    hint.textContent = '视频文件存于 shared/ 前缀，所有登录用户可播放；仅上传者可删除。单个文件上限 200 MB。';
    list.innerHTML = rows.length
      ? `<div class="cloud-vgrid">${rows.map(r => cardHTML(r, session)).join('')}</div>`
      : `<div class="cloud-vempty">${icon('video', 28)}<div><b>还没有云端原视频</b><div class="small muted" style="margin-top:5px">点「上传原视频」把本地视频存入应用云存储。</div></div></div>`;

    $$('[data-cv-play]', root).forEach(b => b.onclick = () => {
      const row = rows.find(r => String(r.id) === b.dataset.cvPlay);
      if (row) openPlayer(row);
    });
    $$('[data-cv-del]', root).forEach(b => b.onclick = () => {
      const row = rows.find(r => String(r.id) === b.dataset.cvDel);
      if (row) deleteVideo(row, session, paint);
    });
  };

  const requireLogin = () => modal({
    title: '需要登录 WorkBuddy 账号',
    desc: '上传与播放云端原视频需要真实登录会话',
    body: '<div class="notice-box">云存储按登录会话校验权限，不接受匿名上传。邮箱 + 密码登录仍是本站的访问门槛；这里的 WorkBuddy 账号登录只用于云端视频，不影响其他本地功能。</div>',
    actions: [
      { label: '暂不登录' },
      { label: '使用 WorkBuddy 登录', primary: true, onClick: async () => {
        const r = await startCloudLogin();
        if (r.error) toast('登录未启动', errMsg(r.error, '请稍后重试'), 'error');
      }},
    ],
  });

  $('#btnUploadVideo', root).onclick = async () => {
    if (staticFallback || !cloudEnabled) { toast('云端能力不可用', cloudNotice || '请刷新页面重试', 'warn'); return; }
    const s = await getCloudSession();
    if (!s) { requireLogin(); return; }
    openUploadDialog(s, paint);
  };
  $('#btnCloudLogin', root).onclick = async () => {
    const s = await getCloudSession();
    if (s) {
      confirmDlg('退出云端账号？', '退出后仍可使用全部本地功能，重新登录即可继续上传与播放云端视频。', async () => {
        await signOutCloud(); location.reload();
      }, '退出');
    } else {
      const r = await startCloudLogin();
      if (r.error) toast('登录未启动', errMsg(r.error, '请稍后重试'), 'error');
    }
  };
  $('#btnGoCloud', root).onclick = () => {
    $('#cloudVideoCard', root)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#cloudVideoCard', root)?.classList.add('pulse-focus');
    setTimeout(() => $('#cloudVideoCard', root)?.classList.remove('pulse-focus'), 1400);
  };

  await paint();
  return paint;
}
