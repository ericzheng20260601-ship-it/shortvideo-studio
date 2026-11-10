import { changePassword, buildAccountsJSON, PASSWORD_RULE, getSession, logAccess } from './auth.js';
import { modal, toast, downloadFile, $, esc } from './ui.js';

// 登录后的自助改密码弹窗：顶部头像菜单与管理后台共用。
export function openChangePassword({ onChanged } = {}) {
  const s = getSession();
  if (!s?.email) { toast('请先登录', '需要有效会话才能修改密码', 'warn'); return; }
  modal({
    title: '修改登录密码',
    desc: `${s.name || '创作者'} · ${s.email}`,
    body: `
      <div class="notice-box" style="margin-bottom:14px">${s.usingInitial
        ? '当前使用的是管理员配置的<b>初始登录密码</b>，建议首次登录后立即修改。'
        : '当前使用的是你自定义密码。修改后本机立即生效，其他设备需同步名单。'}</div>
      <div class="field"><label class="field-label" for="pwdOld">当前密码</label>
        <input class="input" id="pwdOld" type="password" autocomplete="current-password" placeholder="请输入当前登录密码" /></div>
      <div class="field"><label class="field-label" for="pwdNew">新密码</label>
        <input class="input" id="pwdNew" type="password" autocomplete="new-password" placeholder="${esc(PASSWORD_RULE)}" />
        <div class="field-hint">${esc(PASSWORD_RULE)}，建议不要与其他站点重复。</div></div>
      <div class="field"><label class="field-label" for="pwdConfirm">确认新密码</label>
        <input class="input" id="pwdConfirm" type="password" autocomplete="new-password" placeholder="再输入一次新密码" /></div>
      <div id="pwdErr" class="gate-error" hidden></div>
      <div class="field-hint" style="margin-top:10px">站点是静态托管，密码摘要写入本机账号名单。要让其他设备也用新密码，请点「导出名单」并覆盖仓库 <span class="mono">data/accounts.json</span> 后提交。</div>`,
    actions: [
      { label: '取消' },
      { label: '导出名单', onClick: () => {
          downloadFile('accounts.json', buildAccountsJSON(), 'application/json;charset=utf-8');
          logAccess('导出 accounts.json（改密码后同步）');
          return false;
        } },
      { label: '确认修改', primary: true, onClick: async () => {
          const err = $('#pwdErr');
          err.hidden = true;
          const oldP = $('#pwdOld').value;
          const p1 = $('#pwdNew').value;
          const p2 = $('#pwdConfirm').value;
          if (p1 !== p2) { err.textContent = '两次输入的新密码不一致'; err.hidden = false; return false; }
          const r = await changePassword(s.email, oldP, p1);
          if (!r.ok) { err.textContent = r.reason; err.hidden = false; return false; }
          logAccess(`修改登录密码（${s.email}）`);
          toast('密码已修改', '本机立即生效；其他设备需同步名单');
          onChanged?.(r);
          return true;
        } },
    ],
  });
}
