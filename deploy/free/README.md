# 零成本两阶段部署 SOP（路径 ① + ②）

**结论：这两条可行，但不是并列二选一，是「先 ① 后 ②」的迁移链。**

① 让团队今天就能用、零成本、零改造；② 把后端搬到永久免费的虚拟机上，拿回持久卷与可控运维。成员从头到尾只记一条门户短链，后端换掉对他们无感。

```
阶段①  成员 → workbuddy.link/p/<节点>  免登录固定短链
                    └→ 现有托管域 ?sharecode=... → 服务端账号登录 → 生产
              同时：外部机器定时 /api/admin/backup → 加密 → 外送对象存储

阶段②  OCI Always Free VM（2核/12GB + 200GB 块盘 + 10TB 出站）
              还原 ① 的备份 → 同样的 compose + Caddy（免费 HTTPS 域名）
              门户只改 SV_PORTAL_TARGET 并 republish，短链不变
```

---

## 0. 三个必须对齐的衔接点

| 衔接点 | 做法 | 不做会怎样 |
|---|---|---|
| **备份能远程取到** | 托管沙箱里没有 shell / crontab，本轮新增管理员接口 `GET /api/admin/backup`（含 `studio.sqlite` 一致性快照、`secret.key`、`uploads/`、`outputs/`），外部机器用 `pull-backup.sh` 拉取 | 实例一旦重建，账号 / 素材 / 成片全丢 |
| **会话密钥一起迁移** | `restore-backup.sh` 会把备份里的 `secret.key` 写回 `.env` 的 `SV_SECRET` | 全员被强制重新登录，成员以为系统坏了 |
| **入口链接不换** | 门户是发布态快照，改 `SV_PORTAL_TARGET` 后必须走「重建快照 → 重导 → republish → 复核」，短链本身不变 | 改了模板但线上没变 / 成员收藏的旧链接失效 |

---

## 1. 阶段 ①：沿用托管域 + 门户短链 + 备份外送

### 1.1 门户短链（团队统一入口）

按 `deploy/PORTAL.md` 执行。**前置**：目标资料库团队空间需你确认；发布需要管理员权限；发布态匿名访客可看不可写，所以门户只放跳转按钮与只读快照。

生成快照时把 `SV_PORTAL_TARGET` 设为**完整带分享码的托管域链接**；每次从门户跳转都会重新携带分享码，成员清缓存 / 换设备不再掉线。门户页绝不写账号、密码、密钥或经营数据。

**当前已落地（2026-11-11 13:41）**：目标位置为「跨境电商项目 / 短视频工作台」文件夹（空间 `KKPPDkLN3nsP6u2zgXHhAm`，文件夹 `yapuz0jQXRJXmK2tyzgbuH`），节点 `vhHoZy3ibiOededcskT5PS`。团队短链 `https://workbuddy.link/p/vhHoZy3ibiOededcskT5PS`，编辑态 `https://www.workbuddy.cn/space/d/vhHoZy3ibiOededcskT5PS`。发布态制品已核对：跳转目标带 `sharecode=5PAHXG5GGV`、快照 8 条且来源标注 `demo`、四张能力卡片与页脚口径齐全、无任何账号/密钥/视频直链。

### 1.2 备份外送（本轮补齐的能力）

新增/改动：

| 文件 | 作用 |
|---|---|
| `server/lib/backup.js` | 可复用的异步备份生成（`VACUUM INTO` 一致性快照 + tar.gz，按份数保留） |
| `server/scripts/backup.js` | CLI 薄封装，`npm run backup` 行为不变 |
| `server/index.js` | `GET /api/admin/backup`，仅 admin 以上，流式返回 tar.gz，写审计日志 |
| `js/cloud-console.js` | 管理面板新增「下载完整备份」入口 |
| `deploy/free/pull-backup.sh` | 外部机器定时拉取 → 校验 → AES-256 加密 → 可选 rclone 转存 → 轮转 |

管理员本机或任意一台能联网的机器（含 CI 定时任务）执行：

```bash
export SV_BASE='https://<托管域>'
export SV_GATE_QUERY='sharecode=<分享码>'       # 自建域名无网关时留空
export SV_ADMIN_EMAIL='<管理员邮箱>'
export SV_ADMIN_PASSWORD='<管理员密码>'
export SV_BACKUP_PASSPHRASE='<自定义长口令>'   # 强烈建议设置
export SV_RCLONE_REMOTE='r2:shortvideo-backups' # 可选，需本机装 rclone
bash deploy/free/pull-backup.sh
# crontab：0 3 * * * <同上环境变量> /path/to/pull-backup.sh >> ~/sv-backup.log 2>&1
```

凭据只走环境变量，不落盘；下载后用 `tar -tzf` 校验含 `studio.sqlite` 才落盘；加密包解密命令在脚本输出里。若不装 rclone，请手动把 `$HOME/shortvideo-backups` 同步到你自己的云盘 / 对象存储。

> **状态（2026-11-11 13:40 更新）**：线上已重新发布，分享链接与 sharecode 不变；`GET /api/admin/backup` 未登录 401、管理员 200（22.8KB tar.gz，含 `studio.sqlite` / `secret.key` / `uploads/` / `outputs/`），viewer 403。接口已可直接被上面的脚本调用，**当前唯一缺口是「谁定时来拉」**：`deploy/free/github-actions-backup.yml` 仍是模板，尚未复制到 `.github/workflows/`，也未配置 crontab。

---

## 2. 阶段 ②：Oracle Cloud Always Free

### 2.1 你自己要做的三件事

1. 注册 OCI Always Free（需手机 + 真实信用卡仅作身份校验，不扣费）。**Home Region 注册后不可改**；A1 在热门区域常报 `Out of host capacity`，换可用域 / 区域重试；按 **2 OCPU / 12GB** 建实例，别照抄旧教程的 4 核 24GB（2026-06 已减半，2026-08-18 起强制）。
2. 在 VCN Security List / NSG **入站放行 TCP 80、443**；OCI Ubuntu 镜像的 iptables INPUT 链末尾常有 REJECT 规则，不通时把 ACCEPT 插到它前面。
3. 提供 Git 仓库地址（`SV_REPO_URL`）。私有仓库先在机器上配好凭据。

### 2.2 一键初始化

```bash
export SV_REPO_URL='<Git 仓库地址>'
export SV_SECRET='<可选：① 备份里 secret.key 的内容>'   # 填了可省掉后面还原时的密钥对齐
export SV_DOMAIN=''                                    # 留空自动用 <公网IP>.sslip.io 免费 HTTPS 域名
sudo -E bash deploy/free/oci-init.sh
```

脚本会：装 Docker → 生成 `.env`（随机密钥、绑定 127.0.0.1、6GB 内存 / 2 核、200MB 上传）→ 写 `docker-compose.override.yml` 把 `/srv/backups` 挂进容器 → 调 `deploy/bootstrap.sh` 构建 + Caddy 自动证书 → 把 `remix.maxConcurrent` 写成 1 → 配每日备份与 10 分钟探活 cron。

**不要套 Cloudflare 免费代理 / Tunnel**：免费档请求体上限 100MB，会截断 200MB 素材上传；直连 + Caddy 自动证书反而更省事。`*.sslip.io` 是第三方免费 DNS，只作过渡，正式用建议换自有域名（几十元/年，与服务器采购是两回事）。

### 2.3 迁移 ① 的数据

把 ① 阶段拉下来的备份传到机器，然后：

```bash
# 加密包先 export SV_BACKUP_PASSPHRASE='<当时口令>'
bash deploy/free/restore-backup.sh /srv/backups/sv-backup-XXXX.tar.gz
```

脚本会停服务（**不带 -v，卷不删**）→ 把当前数据另存 `/srv/backups/pre-restore/` 作回滚保险 → 清空并解压还原 → 把备份里的 `secret.key` 写回 `.env` 的 `SV_SECRET` → 启动并健康检查。

### 2.4 切换入口（成员无感）

只改门户的 `SV_PORTAL_TARGET` 为 `https://<② 的域名>`，按 `deploy/PORTAL.md` 第 3 节走完四步并复核发布态版本号递增。**成员收藏的 `workbuddy.link/p/<节点>` 短链不变**。切换前建议两套后端并行跑一天，确认 ② 全链路通过再改。

---

## 3. 落地清单与风险

| 项 | 状态 / 要求 |
|---|---|
| 备份接口、外送脚本、OCI 初始化与还原脚本 | 接口与前端入口已随 2026-11-11 13:40 重新发布**线上生效**；脚本均为本地文件，**未提交 git** |
| 门户短链实际发布 | ✅ 已发布到「跨境电商项目 / 短视频工作台」，短链 `https://workbuddy.link/p/vhHoZy3ibiOededcskT5PS` |
| 线上重新发布（让备份接口生效） | ✅ 已完成，链接与 sharecode 不变，发布后实测 health / Range 206 / 登录 / 备份 200 全部通过 |
| 定时外送备份 | ⬜ **唯一未完成项**：模板 `deploy/free/github-actions-backup.yml` 未启用，crontab 未配置；境外 runner 能否穿过托管域网关尚未验证 |
| OCI 注册、VCN 放行、仓库地址 | 需你本人操作 / 提供 |
| 域名 | 不买也能跑（sslip.io）；想要干净正式链接再单独买 |
| 并发 | 2 核必须 `remix.maxConcurrent=1`，多人排队；不要 `--scale > 1` |
| OCI 免费层 | 200GB 块盘**含启动卷**、10TB/月出站；7 天低利用率实例可能被回收，纯免费账户无 SLA、无工单；以控制台 Limits 页为准 |
| 大陆访问 | OCI 海外区域无需备案，但延迟与可达性需按成员所在地实测 |
| 合规 | 无 TikTok 官方权限，真实爆款指标仍需第三方合规数据 API；未配置时来源标注 `demo/local` |

### 验收（两阶段各做一次）

- [x] 门户短链免登录可开，「进入工作台」跳到正确的后端登录页（2026-11-11 13:41 已核对发布态制品）
- [x] `curl -fsS <后端>/api/health` 返回 `status: ok`（v2.0.0）
- [ ] `pull-backup.sh` 产出的包能 `tar -tzf` 列出 `studio.sqlite` / `uploads/` / `outputs/`
- [ ] ② 上 `curl -I -H 'Range: bytes=0-99' <成片URL>` 返回 206
- [ ] 上传真实视频 → 提示词批量混剪 → 预览 → 下载成片全链路通过
- [ ] 用 ① 阶段账号能直接登录 ②，成员 / 素材 / 成片 / 审计日志齐全
- [ ] 恢复演练做过一次（含 `/srv/backups/pre-restore/` 回滚包可用性）

---

## 4. 备选：零成本 / 低成本的两阶段变体

如果暂时不注册 OCI 或不想让管理员电脑常开，还有两条替换路径（完整核价与决策树见工作区《短视频工作台_零成本与低成本两阶段方案_2026-11-11.md》）：

### 4.1 用 GitHub Actions 代替本机 crontab（¥0，零新账号）

`github-actions-backup.yml` 是**模板**，`pull-backup.sh` 不需要任何修改。用法：

1. 复制到仓库根 `.github/workflows/backup.yml` 并推送（**本轮未复制、未启用 CI**）。
2. 在仓库 Actions Secrets 配置 `SV_BASE` / `SV_GATE_QUERY` / `SV_ADMIN_EMAIL` / `SV_ADMIN_PASSWORD` / `SV_BACKUP_PASSPHRASE`。
3. **先手动 `workflow_dispatch` 跑一次**，确认境外 runner 能穿过托管域网关（`?sharecode=` + `__wb_rsc` Cookie）；不通就退回本机 crontab。
4. 免费档 artifact 总配额 **500MB**，`retention-days: 7`，模板设了单包 50MB 闸门。素材涨上来后改配置 `SV_RCLONE_REMOTE` 外送 R2/B2/COS（模板自带远端轮转），或做分层备份。

> 不要把备份包 `git commit` 进仓库：单文件 100MB 硬限、git 历史永久膨胀。artifact 有过期机制才是对的。

### 4.2 用 ¥99/年 ECS 做「备份锚点」（推荐低成本档）

一台阿里云 ECS 经济型 e（2核2G/3M/40G，¥99/年、续费同价）只开 22 端口，出站跑本目录的 `pull-backup.sh` + crontab，凭据放 `/etc/shortvideo/backup.env`（600）。**不绑域名、不开 80/443，因此不需要 ICP 备案**（国内云只拦截未备案域名的 Web 端口）。

需要转正式生产时再买域名 + 备案 → Caddy 自动证书 → 同一台机器 `docker compose -f deploy/docker-compose.https.yml up -d` → 用 `restore-backup.sh` 还原 → 门户只改 `SV_PORTAL_TARGET`，成员短链不变。备案等待期继续用 ① 托管域，团队无感。
