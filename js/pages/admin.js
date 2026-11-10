import { icon } from '../icons.js';
import { store } from '../store.js';
import {
  getAccounts, getInitialPassword, accountsIsOffline, usingInitial, normEmail,
  setInitialPassword, addAccount, toggleAccount, removeAccount, resetAccountPassword,
  setAccountRole, buildAccountsJSON, importAccountsJSON, logAccess, getSession, PASSWORD_RULE,
} from '../auth.js';
import { openChangePassword } from '../password-dialog.js';
import { $, $$, esc, toast, modal, pageHead, copyText, downloadFile, pickFile, confirmDlg } from '../ui.js';

const ROLE = { admin:'管理员', user:'创作者' };
const fmtExp = e => e ? (new Date(e).getTime() < Date.now() ? '已过期' : e) : '永久有效';

export default {
  render() {
    const accounts = getAccounts();
    const init = getInitialPassword();
    const admins = accounts.filter(a => a.role === 'admin' && a.enabled).length;
    const initials = accounts.filter(usingInitial).length;
    const s = store.get('settings', {});
    const dataCount = ['scripts','assets','projects','reviews','works','autoJobs'].reduce((n,k)=>n+store.get(k,[]).length,0);
    return `
    ${pageHead('管理后台','账号与密码、名单发布与工程数据快照',
      `<button class="btn" id="btnExportList">${icon('download',14)} 导出 accounts.json</button>
       <button class="btn btn-primary" id="btnAddAccount">${icon('plus',14)} 添加账号</button>`)}
    <div class="metric-tiles" style="grid-template-columns:repeat(3,1fr)">
      <div class="metric-tile"><span>名单中的邮箱账号</span><b id="mAccounts">${accounts.length}</b></div>
      <div class="metric-tile"><span>启用中的管理员</span><b id="mAdmins">${admins}</b></div>
      <div class="metric-tile"><span>仍用初始密码</span><b id="mInitials">${initials}</b></div>
    </div>

    <div class="section-title">${icon('users',15)} 账号与密码 <span class="tiny">名单只存 PBKDF2 加盐摘要，不存明文</span></div>
    <div class="card card-pad">
      <div class="card-title"><h3>初始登录密码</h3><span class="badge blue">全局配置</span></div>
      <div class="row row-wrap" style="align-items:center;gap:12px">
        <div style="flex:1;min-width:210px">
          <div class="small"><b>已配置</b> · 页面与仓库只保存摘要，不显示明文</div>
          <div class="small muted" style="margin-top:4px">摘要 <span class="mono" id="initHashPreview">${esc(String(init.hash || '').slice(0,12))}…</span> · 最近配置 <span id="initUpdatedAt">${esc(init.updatedAt || '—')}</span></div>
        </div>
        <button class="btn btn-sm btn-soft" id="btnSetInitial">${icon('lock',13)} 修改初始密码</button>
        <button class="btn btn-sm" id="btnMyPassword">${icon('key',13)} 修改我的密码</button>
      </div>
      <div class="notice-box" style="margin-top:13px">新添加的账号默认使用此密码登录。修改初始密码后，所有「仍使用初始密码」的账号要改用新密码；已自行改过密码的账号不受影响。</div>
    </div>

    <div class="card card-pad" style="margin-top:14px">
      <div class="card-title"><h3>账号名单</h3><span class="sub">${accountsIsOffline()?'仓库名单未加载，当前使用内置名单':'仓库名单已加载'}</span></div>
      <div style="overflow-x:auto"><table class="table"><thead><tr>
        <th>登录邮箱</th><th>使用者</th><th>角色</th><th>密码</th><th>有效期</th><th>状态</th><th>操作</th>
      </tr></thead><tbody id="acctRows"></tbody></table></div>
      <div class="row row-wrap" style="margin-top:13px">
        <button class="btn btn-sm" id="btnImportList">${icon('upload',13)} 导入名单</button>
        <button class="btn btn-sm" id="btnCopyList">${icon('copy',13)} 复制名单 JSON</button>
        <span class="spacer"></span><span class="small muted">改动在本机立即生效；导出并提交仓库后对所有访客生效。</span>
      </div>
      <div class="notice-box" style="margin-top:13px">
        部署边界：站点为静态托管，登录在浏览器端校验账号名单（规则码 A-02），可挡住未开通邮箱与错误密码，但不等于服务端强制鉴权。名单文件公开可读，但只有 PBKDF2 加盐摘要；需要严格隔离时应把校验移到服务端。
      </div>
    </div>

    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card card-pad">
        <div class="card-title"><h3>工程数据快照</h3><span class="badge blue">规则码 G-02</span></div>
        <div class="small muted" style="line-height:1.8">文案、拆解、剪辑工程、评估结果、素材与账号名单草稿会打包成一个 JSON（含密码摘要，请妥善保管）。把快照提交到仓库，工程即随代码版本化；在另一台设备导入即可恢复。</div>
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
    const drawAccounts = () => {
      const rows = getAccounts();
      const cfg = getInitialPassword();
      const setTxt = (id, v) => { const el = $('#' + id, root); if (el) el.textContent = String(v); };
      setTxt('mAccounts', rows.length);
      setTxt('mAdmins', rows.filter(a => a.role === 'admin' && a.enabled).length);
      setTxt('mInitials', rows.filter(usingInitial).length);
      setTxt('initHashPreview', String(cfg.hash || '').slice(0, 12) + '…');
      setTxt('initUpdatedAt', cfg.updatedAt || '—');
      $('#acctRows', root).innerHTML = rows.map(a => {
        const initial = usingInitial(a);
        return `<tr>
        <td class="mono small">${esc(a.email)}</td>
        <td>${esc(a.name || '—')}</td>
        <td><span class="badge ${a.role==='admin'?'':'blue'}">${ROLE[a.role] || '创作者'}</span></td>
        <td><span class="badge ${initial?'amber':'gray'}">${initial?'初始密码':'已自定义'}</span></td>
        <td class="small">${esc(fmtExp(a.expiresAt))}</td>
        <td><span class="badge ${a.enabled?'':'gray'}">${a.enabled?'启用':'停用'}</span></td>
        <td><div class="row" style="gap:4px;flex-wrap:nowrap">
          <button class="btn btn-sm" data-role="${esc(a.email)}">${a.role==='admin'?'降为创作者':'设为管理员'}</button>
          <button class="btn btn-sm" data-reset="${esc(a.email)}" ${initial?'disabled':''}>重置密码</button>
          <button class="btn btn-sm ${a.enabled?'':'btn-soft'}" data-toggle="${esc(a.email)}">${a.enabled?'停用':'启用'}</button>
          <button class="btn btn-sm btn-ghost" data-del="${esc(a.email)}">删除</button>
        </div></td>
      </tr>`; }).join('') || '<tr><td colspan="7" class="empty">名单为空，请先添加账号</td></tr>';

      $$('[data-toggle]', root).forEach(b => b.onclick = () => {
        const a = getAccounts().find(x => normEmail(x.email) === normEmail(b.dataset.toggle));
        if (!a) return;
        toggleAccount(a.email);
        logAccess(`${a.enabled?'停用':'启用'}账号 ${a.email}`);
        drawAccounts(); drawLogs(); toast(a.enabled?'已停用':'已启用','导出名单并提交仓库后对所有访客生效');
      });

      $$('[data-role]', root).forEach(b => b.onclick = () => {
        const a = getAccounts().find(x => normEmail(x.email) === normEmail(b.dataset.role));
        if (!a) return;
        const next = a.role === 'admin' ? 'user' : 'admin';
        if (a.role === 'admin' && getAccounts().filter(x => x.role === 'admin' && x.enabled).length <= 1) {
          toast('至少保留一名管理员','请先把另一个账号设为管理员','warn'); return;
        }
        setAccountRole(a.email, next);
        logAccess(`调整角色：${a.email} → ${ROLE[next]}`);
        drawAccounts(); drawLogs(); toast('角色已更新', `${a.email} 现为${ROLE[next]}`);
      });

      $$('[data-reset]', root).forEach(b => b.onclick = () => {
        const email = b.dataset.reset;
        confirmDlg('重置为初始登录密码？',
          `${email} 的自定义密码会被清除，之后使用管理后台配置的全局初始登录密码登录；该账号在其他设备上的旧密码将失效。`,
          () => { resetAccountPassword(email); logAccess(`重置密码：${email}`); drawAccounts(); drawLogs(); toast('已重置','请导出名单并提交仓库同步到其他设备','warn'); },
          '确认重置');
      });

      $$('[data-del]', root).forEach(b => b.onclick = () => {
        const email = b.dataset.del;
        if (normEmail(email) === normEmail(getSession()?.email)) { toast('不能删除当前登录账号','请先切换到其他管理员账号','warn'); return; }
        confirmDlg('从名单中删除该账号？', `${email} 将无法再登录。本机立即生效；导出名单并提交仓库后对所有访客生效。`,
          () => { removeAccount(email); logAccess(`删除账号：${email}`); drawAccounts(); drawLogs(); toast('已删除账号', email); },
          '确认删除');
      });
    };

    const drawLogs = () => {
      const logs = store.get('logs', []);
      $('#logBox', root).innerHTML = logs.length
        ? logs.slice(0,12).map(l=>`<div class="log-line"><time>${esc(l.at)}</time><span>${esc(l.text)}</span></div>`).join('')
        : '<div class="empty">暂无记录</div>';
    };

    const exportList = () => {
      downloadFile('accounts.json', buildAccountsJSON(), 'application/json;charset=utf-8');
      logAccess('导出 accounts.json');
      drawLogs();
      setTimeout(()=>toast('记得提交仓库','覆盖 data/accounts.json 后名单才对所有访客生效','warn'), 900);
    };

    $('#btnAddAccount', root).onclick = () => modal({
      title:'添加账号', desc:'按邮箱开通，使用者凭初始登录密码进入',
      body:`<div class="field"><label class="field-label" for="acEmail">登录邮箱</label>
          <input class="input" id="acEmail" type="email" placeholder="name@company.com" /></div>
        <div class="field"><label class="field-label" for="acName">使用者名称</label>
          <input class="input" id="acName" placeholder="例如：内容组 · 小林" /></div>
        <div class="grid g2"><div class="field"><label class="field-label" for="acRole">角色</label>
          <select class="select" id="acRole"><option value="user">创作者（九个菜单，仅查看）</option><option value="admin">管理员（可进管理后台）</option></select></div>
          <div class="field"><label class="field-label" for="acDays">有效期</label>
          <select class="select" id="acDays"><option value="7">7 天</option><option value="30" selected>30 天</option><option value="90">90 天</option><option value="0">永久有效</option></select></div></div>
        <div class="field"><label class="field-label" for="acPwdMode">登录密码</label>
          <select class="select" id="acPwdMode"><option value="initial">使用全局初始登录密码</option><option value="custom">为此账号单独设置</option></select>
          <div class="field-hint" id="acPwdHint">由上方「初始登录密码」统一配置；开通后请把该密码告知使用者。</div></div>
        <div class="field" id="acPwdField" hidden><label class="field-label" for="acPwd">账号密码</label>
          <input class="input" id="acPwd" type="password" placeholder="${esc(PASSWORD_RULE)}" />
          <div class="field-hint">${esc(PASSWORD_RULE)}</div></div>
        <div class="field"><label class="field-label" for="acNote">备注（可选）</label>
          <input class="input" id="acNote" placeholder="用途 / 归属团队" /></div>
        <div class="notice-box">开通后：① 本机立即生效；② 导出 accounts.json 覆盖仓库同名文件并提交，其他访客才能登录；③ 名单只含摘要，明文密码请自行告知使用者。</div>`,
      onMount: (mroot) => {
        $('#acPwdMode', mroot).onchange = e => {
          const custom = e.target.value === 'custom';
          $('#acPwdField', mroot).hidden = !custom;
          $('#acPwdHint', mroot).textContent = custom
            ? '该账号会有独立密码，不受全局初始密码变更影响。'
            : '由上方「初始登录密码」统一配置；开通后请把该密码告知使用者。';
        };
      },
      actions:[{ label:'取消' },{ label:'开通账号', primary:true, close:false, onClick:async (close) => {
        const email = $('#acEmail').value.trim();
        const name = $('#acName').value.trim();
        const role = $('#acRole').value, days = Number($('#acDays').value);
        const note = $('#acNote').value.trim();
        const custom = $('#acPwdMode').value === 'custom';
        const pwd = custom ? $('#acPwd').value : '';
        const r = await addAccount({ email, name, role, days, note, password:pwd });
        if (!r.ok) { toast('开通失败', r.reason, 'error'); return false; }
        logAccess(`开通账号：${email}（${ROLE[role]}，${days ? days+' 天' : '永久'}）`);
        drawAccounts(); drawLogs();
        close();
        modal({
          title:'账号已开通', desc:'请把登录信息告知使用者',
          body:`<div class="block"><div class="block-head"><b>登录邮箱</b></div><div class="small mono">${esc(r.account.email)}</div></div>
            <div class="block"><div class="block-head"><b>登录密码</b></div><div class="small">${custom
              ? `${esc(pwd)} <span class="muted">（单独设置，仅显示这一次）</span>`
              : '使用你在「初始登录密码」中配置的全局初始登录密码'}</div></div>
            <div class="notice-box">名单文件里只有 PBKDF2 加盐摘要，不会保存这里的明文密码。</div>`,
          actions:[
            { label:'复制登录信息', primary:true, close:false, onClick:()=>copyText(`工作台登录邮箱：${r.account.email}\n登录密码：${custom?pwd:'（管理员配置的全局初始登录密码）'}`, '登录信息') },
            { label:'导出名单', close:false, onClick:()=>exportList() },
            { label:'完成' },
          ],
        });
        return false;
      }}],
    });

    $('#btnSetInitial', root).onclick = () => modal({
      title:'配置初始登录密码', desc:'用于新开通的账号与重置后的账号',
      body:`<div class="field"><label class="field-label" for="initP1">新的初始密码</label>
          <input class="input" id="initP1" type="password" autocomplete="new-password" placeholder="${esc(PASSWORD_RULE)}" />
          <div class="field-hint">${esc(PASSWORD_RULE)}</div></div>
        <div class="field"><label class="field-label" for="initP2">确认初始密码</label>
          <input class="input" id="initP2" type="password" autocomplete="new-password" placeholder="再输入一次" /></div>
        <div id="initErr" class="gate-error" hidden></div>
        <div class="notice-box" style="margin-top:12px">修改后，所有「仍使用初始密码」的账号要改用新密码；已自定义密码的账号不受影响。名单只保存摘要，页面不会存明文。</div>`,
      actions:[{ label:'取消' },{ label:'保存并生效', primary:true, onClick:async () => {
        const err = $('#initErr'); err.hidden = true;
        const p1 = $('#initP1').value, p2 = $('#initP2').value;
        if (p1 !== p2) { err.textContent = '两次输入的密码不一致'; err.hidden = false; return false; }
        const r = await setInitialPassword(p1);
        if (!r.ok) { err.textContent = '密码不符合规则：' + r.reason; err.hidden = false; return false; }
        logAccess('修改全局初始登录密码');
        drawAccounts(); drawLogs();
        toast('初始密码已更新','记得导出名单并提交仓库','warn');
        return true;
      }}],
    });

    $('#btnMyPassword', root).onclick = () => openChangePassword({ onChanged: () => { drawAccounts(); drawLogs(); } });

    $('#btnExportList', root).onclick = exportList;
    $('#btnCopyList', root).onclick = () => copyText(buildAccountsJSON(), '名单 JSON');
    $('#btnImportList', root).onclick = async () => {
      const f = await pickFile('application/json,.json');
      if (!f) return;
      try {
        const n = importAccountsJSON(JSON.parse(await f.text()));
        drawAccounts(); toast('名单已导入', `${n} 个账号，本机会按此校验`);
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
      try { const n = store.restore(JSON.parse(await f.text())); toast('快照已恢复', `${n} 类数据已写回本机`); drawAccounts(); drawLogs(); }
      catch (e) { toast('恢复失败', e.message, 'error'); }
    };
    $('#btnReset', root).onclick = () => confirmDlg('清空本机全部数据？',
      '文案、拆解、剪辑工程、评估、素材、本机账号名单草稿与日志都会被删除，且不可恢复；建议先导出快照。清空后会回到仓库名单。',
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

    drawAccounts(); drawLogs();
  },
};
