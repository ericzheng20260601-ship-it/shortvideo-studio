import { icon } from '../icons.js';
import { store } from '../store.js';
import { getEntries, createEntry, buildAllowlistJSON, allowlistIsOffline, logAccess } from '../auth.js';
import { $, $$, esc, toast, modal, pageHead, copyText, downloadFile, pickFile, confirmDlg } from '../ui.js';

const ROLE = { admin:'管理员', user:'创作者' };
const fmtExp = e => e ? (new Date(e).getTime() < Date.now() ? '已过期' : e) : '永久有效';

export default {
  render() {
    const entries = getEntries();
    const admins = entries.filter(e => e.role === 'admin' && e.enabled).length;
    const s = store.get('settings', {});
    const dataCount = ['scripts','assets','projects','reviews','works','autoJobs'].reduce((n,k)=>n+store.get(k,[]).length,0);
    return `
    ${pageHead('管理后台','访问授权、名单发布与工程数据快照',
      `<button class="btn" id="btnExportList">${icon('download',14)} 导出 allowlist.json</button>
       <button class="btn btn-primary" id="btnIssue">${icon('key',14)} 签发授权码</button>`)}
    <div class="metric-tiles" style="grid-template-columns:repeat(3,1fr)">
      <div class="metric-tile"><span>名单中的授权码</span><b>${entries.length}</b></div>
      <div class="metric-tile"><span>启用中的管理员</span><b>${admins}</b></div>
      <div class="metric-tile"><span>本机数据条目</span><b>${dataCount}</b></div>
    </div>

    <div class="section-title">${icon('users',15)} 访问授权 <span class="tiny">名单只存 SHA-256 摘要，不存明文</span></div>
    <div class="card card-pad">
      <div class="card-title"><h3>授权名单</h3><span class="sub">${allowlistIsOffline()?'仓库名单未加载，当前使用内置名单':'仓库名单已加载'}</span></div>
      <div style="overflow-x:auto"><table class="table"><thead><tr>
        <th>摘要（前 12 位）</th><th>使用者</th><th>角色</th><th>有效期</th><th>状态</th><th>备注</th><th>操作</th>
      </tr></thead><tbody id="entRows"></tbody></table></div>
      <div class="row row-wrap" style="margin-top:13px">
        <button class="btn btn-sm" id="btnImportList">${icon('upload',13)} 导入名单</button>
        <button class="btn btn-sm" id="btnCopyList">${icon('copy',13)} 复制名单 JSON</button>
        <span class="spacer"></span><span class="small muted">签发 / 停用后在本机立即生效；要让所有访客生效，需导出并提交仓库。</span>
      </div>
      <div class="notice-box" style="margin-top:13px">
        部署边界：站点托管在静态页面服务上，授权在浏览器端校验名单（规则码 G-01），可挡住未持码的访问者，但不等于服务端强制鉴权。名单文件公开可读但只有哈希；需要严格隔离时，应把校验移到服务端。
      </div>
    </div>

    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card card-pad">
        <div class="card-title"><h3>工程数据快照</h3><span class="badge blue">规则码 G-02</span></div>
        <div class="small muted" style="line-height:1.8">文案、拆解、剪辑工程、评估结果、素材与名单草稿会打包成一个 JSON。把快照提交到仓库，工程即随代码版本化；在另一台设备导入即可恢复。</div>
        <div class="row row-wrap" style="margin-top:13px">
          <button class="btn btn-soft" id="btnExportSnap">${icon('download',13)} 导出全量快照</button>
          <button class="btn" id="btnImportSnap">${icon('upload',13)} 导入快照</button>
          <button class="btn btn-danger" id="btnReset">${icon('trash',13)} 清空本机数据</button>
        </div>
      </div>
      <div class="card card-pad">
        <div class="card-title"><h3>站点设置</h3><span class="sub">保存在本机</span></div>
        <div class="field"><label class="field-label" for="setName">站点显示名</label><input class="input" id="setName" value="${esc(s.siteName || '短视频创作台')}" /></div>
        <div class="field"><label class="field-label" for="setOffset">每日激励语句偏移</label><input class="input" id="setOffset" type="number" min="0" max="99" value="${Number(s.quoteOffset)||0}" />
          <div class="field-hint">默认按日期自动轮换；偏移值用于固定到某一条。</div></div>
        <button class="btn btn-primary" id="btnSaveSet">保存设置</button>
      </div>
    </div>

    <div class="section-title">${icon('activity',15)} 访问与操作日志 <span class="tiny">最近 12 条 · 仅本机</span></div>
    <div class="card card-pad" id="logBox"></div>`;
  },

  mount(root) {
    const drawEntries = () => {
      const rows = getEntries();
      $('#entRows', root).innerHTML = rows.map(e=>`<tr>
        <td class="mono small">${esc(e.hash.slice(0,12))}…</td>
        <td>${esc(e.name || '—')}</td>
        <td><span class="badge ${e.role==='admin'?'':'blue'}">${ROLE[e.role] || '创作者'}</span></td>
        <td class="small">${esc(fmtExp(e.expiresAt))}</td>
        <td><span class="badge ${e.enabled?'':'gray'}">${e.enabled?'启用':'停用'}</span></td>
        <td class="small muted">${esc(e.note || '—')}</td>
        <td><button class="btn btn-sm ${e.enabled?'':'btn-soft'}" data-toggle="${e.hash}">${e.enabled?'停用':'启用'}</button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">名单为空</td></tr>';
      $$('[data-toggle]', root).forEach(b=>b.onclick=()=>{
        const hash = b.dataset.toggle;
        const base = getEntries().find(e=>e.hash===hash);
        if (!base) return;
        const draft = store.get('codesDraft', []);
        const next = { ...base, enabled: !base.enabled };
        const idx = draft.findIndex(e=>e.hash===hash);
        if (idx>=0) draft[idx]=next; else draft.push(next);
        store.set('codesDraft', draft);
        logAccess(`${base.enabled?'停用':'启用'}授权码 ${hash.slice(0,8)}…（${base.name}）`);
        drawEntries(); toast(base.enabled?'已停用':'已启用','导出名单并提交仓库后对所有访客生效');
      });
    };
    const drawLogs = () => {
      const logs = store.get('logs', []);
      $('#logBox', root).innerHTML = logs.length
        ? logs.slice(0,12).map(l=>`<div class="log-line"><time>${esc(l.at)}</time><span>${esc(l.text)}</span></div>`).join('')
        : '<div class="empty">暂无记录</div>';
    };

    $('#btnIssue', root).onclick = () => modal({
      title:'签发授权码', desc:'明文码只显示一次，请当场复制给使用者',
      body:`<div class="field"><label class="field-label" for="icName">使用者名称</label><input class="input" id="icName" placeholder="例如：内容组 · 小林" /></div>
        <div class="grid g2"><div class="field"><label class="field-label" for="icRole">角色</label><select class="select" id="icRole"><option value="user">创作者（9 个菜单，仅查看）</option><option value="admin">管理员（可进管理后台）</option></select></div>
        <div class="field"><label class="field-label" for="icDays">有效期</label><select class="select" id="icDays"><option value="7">7 天</option><option value="30" selected>30 天</option><option value="90">90 天</option><option value="0">永久有效</option></select></div></div>
        <div class="field"><label class="field-label" for="icNote">备注（可选）</label><input class="input" id="icNote" placeholder="用途 / 归属团队" /></div>
        <div class="notice-box">签发后：① 本机立即生效；② 导出 allowlist.json 覆盖仓库同名文件并提交，其他访客才能使用；③ 名单里只有哈希，明文码请自行保管。</div>`,
      actions:[{ label:'取消' },{ label:'生成授权码', primary:true, onClick:async (close)=>{
        const name = $('#icName').value.trim();
        if (!name) { toast('请填写使用者名称','便于后续审计','warn'); return false; }
        const role = $('#icRole').value, days = Number($('#icDays').value), note = $('#icNote').value.trim();
        const { code } = await createEntry({ name, role, days, note });
        logAccess(`签发授权码：${name}（${ROLE[role]}，${days ? days+' 天' : '永久'}）`);
        drawEntries(); drawLogs();
        setTimeout(() => modal({
          title:'授权码已生成', desc:'此明文只出现这一次',
          body:`<div class="notice-box" style="font-size:15px;font-weight:700;letter-spacing:1px;text-align:center;padding:16px" id="codeText">${esc(code)}</div>
            <div class="divider"></div><div class="small muted">使用者：${esc(name)} · ${ROLE[role]} · ${days ? days+' 天有效' : '永久有效'}</div>`,
          actions:[{ label:'复制授权码', primary:true, onClick:()=>copyText(code,'授权码') },{ label:'导出名单', onClick:()=>exportList() },{ label:'完成' }],
        }), 80);
      }}],
    });

    const exportList = async () => {
      const json = await buildAllowlistJSON();
      downloadFile('allowlist.json', json, 'application/json;charset=utf-8');
      logAccess('导出 allowlist.json');
      drawLogs();
      setTimeout(()=>toast('记得提交仓库','覆盖 data/allowlist.json 后名单才对所有访客生效','warn'), 900);
    };
    $('#btnExportList', root).onclick = exportList;
    $('#btnCopyList', root).onclick = async () => copyText(await buildAllowlistJSON(), '名单 JSON');
    $('#btnImportList', root).onclick = async () => {
      const f = await pickFile('application/json,.json');
      if (!f) return;
      try {
        const json = JSON.parse(await f.text());
        if (!Array.isArray(json.entries)) throw new Error('缺少 entries 数组');
        store.set('codesDraft', json.entries);
        drawEntries(); toast('名单已导入', `${json.entries.length} 条，本机会按此校验`);
      } catch (e) { toast('导入失败', e.message, 'error'); }
    };

    $('#btnExportSnap', root).onclick = () => {
      const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      downloadFile(`workbench-snapshot-${stamp}.json`, JSON.stringify(store.snapshot(), null, 2), 'application/json;charset=utf-8');
      logAccess('导出全量工程快照'); drawLogs();
    };
    $('#btnImportSnap', root).onclick = async () => {
      const f = await pickFile('application/json,.json');
      if (!f) return;
      try { const n = store.restore(JSON.parse(await f.text())); toast('快照已恢复', `${n} 类数据已写回本机`); drawEntries(); drawLogs(); }
      catch (e) { toast('恢复失败', e.message, 'error'); }
    };
    $('#btnReset', root).onclick = () => confirmDlg('清空本机全部数据？',
      '文案、拆解、剪辑工程、评估、素材、名单草稿与日志都会被删除，且不可恢复；建议先导出快照。',
      () => { store.resetAll(); toast('已清空','页面将重新加载'); setTimeout(()=>location.reload(), 500); }, '确认清空');

    $('#btnSaveSet', root).onclick = () => {
      const s = store.get('settings', {});
      s.siteName = $('#setName', root).value.trim() || '短视频创作台';
      s.quoteOffset = Math.max(0, Math.min(99, Number($('#setOffset', root).value)||0));
      store.set('settings', s);
      $$('.brand-name, .gate-title').forEach(el=>el.textContent = s.siteName);
      document.title = s.siteName + ' · 一站式创作工作台';
      toast('设置已保存','站点名与激励语句偏移已更新');
    };

    drawEntries(); drawLogs();
  },
};
