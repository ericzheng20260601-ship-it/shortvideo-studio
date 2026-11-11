# 短视频工作台 · 云服务器部署说明

2.0 版把工作台从「浏览器端静态站」升级为「自带后端的云服务器应用」：前端仍是一套原生 ES modules 静态页面，由同一个 Node 服务托管；`/api/*` 提供鉴权、每日发现、拆解分析、批量混剪、多人协作能力。数据落在 `node:sqlite` 单文件 + 本地媒体目录，不需要外部数据库、缓存或消息队列。

## 0. 部署形态怎么选（多人生产场景）

目标是：**有权限的成员拿到一条固定链接，用浏览器打开就能上传素材、按提示词批量混剪、预览并下载成片；长期稳定、重启不丢数据。**

| 形态 | 成员拿链接即用 | 真实 ffmpeg 渲染 | 数据持久 | 稳定性 / 风险 | 适用 |
|---|---|---|---|---|---|
| **A. 自有云服务器 + Docker + HTTPS 域名（推荐）** | ✅ 固定域名，无平台账号、无分享码 | ✅ 系统 ffmpeg + Noto CJK | ✅ 命名卷 + 定时备份 | ✅ 自动重启、健康检查、资源限额、日志轮转；可控可监控 | 正式多人生产 |
| B. PaaS（Render / Railway / Fly.io 等） | ✅ 自带 HTTPS 域名 | ⚠ 取决于镜像与实例规格 | ⚠ 需付费持久盘 | ⚠ 冷启动、磁盘与内存限制、渲染易超时；国内访问不稳定 | 小团队试用 |
| C. WorkBuddy 托管域（当前线上） | ⚠ 链接必须带 `?sharecode=...`，网关 Cookie 30 天过期，清缓存/换设备要重点原链接 | ✅ 实测可用 | ⚠ 沙箱卷不保证跨重建 | ⚠ 网关会改写 `Authorization`、单进程沙箱可能被回收、无法绑自有域名 | 演示与验收 |
| D. 纯静态 / GitHub Pages | ❌ 只能浏览器名单登录 | ❌ 无后端 | ❌ 数据在各人浏览器 | — | 降级备份，不能生产 |

**结论：走 A。** 链接形如 `https://studio.example.com`，管理员在后台加成员邮箱 → 系统生成一次性初始密码和邀请文本 → 私发给成员 → 成员打开链接登录即可生产。域名、证书、卷、备份都在自己手里，不依赖任何第三方分享码。

C 形态目前仍保留作验收站；它需要在网关 Cookie `__wb_rsc` 有效期内访问，且链接不能丢掉 `sharecode` 参数，不适合作为长期给团队发的正式入口。

## 1. 运行要求

| 项 | 要求 |
|---|---|
| 云主机 | 2 核 4GB 起（推荐 4 核 8GB）；ffmpeg 渲染是 CPU 密集，并发数 `remix.maxConcurrent` 默认 2 |
| 系统 | Debian/Ubuntu（Docker 镜像基于 `node:22-bookworm-slim`） |
| Node.js | ≥ 22.5（用到内置 `node:sqlite`、原生 `fetch`），镜像内已自带 |
| ffmpeg / 字体 | 镜像内已装 `ffmpeg` + `fonts-noto-cjk`；裸机部署需自行安装 |
| 域名与端口 | 一个已解析到本机的域名；公网只开 80 / 443，3000 仅监听 127.0.0.1 |
| 磁盘 | `SV_DATA_DIR` 必须挂持久卷：SQLite、上传素材、成片、会话密钥都在里面。按每人 2–5GB 素材预估 |
| 备份 | 宿主机定时执行 `npm run backup`，或把数据卷纳入云盘快照 |

后端只用 Node 内置模块，Docker 镜像里不需要 `npm install`。根 `package.json` 里声明 `ffmpeg-static` 只为兼容「只有 Node、会自动 npm install」的托管沙箱。

## 2. 四种启动方式

### A. 裸机 / 云主机（HTTP，验证用）

```bash
git clone <仓库地址> && cd shortvideo-studio
cp .env.example .env
sudo apt-get install -y ffmpeg fonts-noto-cjk
npm start                     # 等价于 node server.js
# 打开 http://<服务器IP>:3000
```

生产请用 systemd / pm2 托管并配 HTTPS 反代，不要把 3000 直接暴露公网。

### B. Docker（HTTP，内网 / IP 验证用）

```bash
cd shortvideo-studio
cp .env.example .env
docker compose up -d --build
docker compose logs -f
# 打开 http://<服务器IP>:3000
```

`studio-data` 卷挂到 `/app/data`；`restart: always`、健康检查、日志轮转、内存/CPU 限额已配好。升级：`git pull && docker compose up -d --build`，卷内数据不丢。

### C. Docker + Caddy + HTTPS 域名（**正式推荐**）

```bash
cd shortvideo-studio
cp .env.example .env
# 编辑 .env，至少设置：
#   SV_DOMAIN=studio.example.com
#   SV_SECRET=<openssl rand -hex 32 的输出>      ← 首次部署就固定，之后不要改
#   SV_BIND_ADDR=127.0.0.1                       ← 3000 只监听本机
#   SV_MAX_UPLOAD_MB=200
openssl rand -hex 32         # 生成上面那串密钥

docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml up -d --build
docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml logs -f
# 打开 https://studio.example.com
```

Caddy 会自动申请并续期 Let's Encrypt 证书；`deploy/Caddyfile` 已把上传上限放宽到 250MB、关闭分块缓冲以透传视频 Range。证书与配置在 `caddy-data` / `caddy-config` 卷里。
大陆云主机需完成备案并放行 80/443；否则证书签发会失败。

已有 Nginx + certbot 时改用 `deploy/nginx.conf.example`（关键：`client_max_body_size 256m`、`proxy_request_buffering off`、`proxy_buffering off`、`X-Forwarded-Proto $scheme`），并在 `.env` 里设 `SV_COOKIE_SECURE=1`。

### D. 本地开发验证

```bash
SV_PORT=3310 SV_DATA_DIR=/tmp/sv-studio-test node --no-warnings server/index.js
SV_BASE=http://127.0.0.1:3310 SV_DATA_DIR=/tmp/sv-studio-test npm run smoke
```

`npm run smoke` 是全流程冒烟测试，会真实调用 ffmpeg 渲染出 MP4，覆盖登录/权限、榜单与快照、拆解报告、变体矩阵队列、QC、审批与审计日志。

## 3. 成员开通：一条链接 + 一组凭据

1. 管理员用初始账号登录 → 「管理后台 → 云服务器管理 → 成员与角色」。
2. 填成员邮箱、姓名、角色（**创作者 `editor` 及以上才能上传素材与发起混剪**），初始密码可留空自动生成。
3. 点「添加成员」后会弹出**仅显示一次**的邀请信息，含：访问链接、登录邮箱、初始密码、角色。点「复制邀请信息」私发给成员。
4. 成员在任何设备用浏览器打开该链接 → 输入邮箱 + 初始密码 → 右上角头像 → 账户信息 → 修改密码（服务端生效，所有设备同步）。
5. 忘记密码：管理员在成员列表点「重置密码」，会立刻注销该成员全部会话并生成新的邀请信息；停用 / 启用、改角色也在同一处。

初始密码只在创建 / 重置的响应里返回一次，服务端只保存 PBKDF2-SHA256 加盐摘要，审计日志不记明文。首次启动的管理员账号来自 `data/accounts.json`，登录后同样应立即改密。

## 4. 环境变量

完整清单与注释见 `.env.example`。命名规则：`SV_` + 配置键大写并去掉点，例如 `discover.syncHour` → `SV_DISCOVER_SYNCHOUR`。也可在「管理后台 → 云服务器管理」可视化配置，配置存库、重启不丢；敏感值读取时会打码。

| 变量 | 作用 |
|---|---|
| `PORT` / `SV_HOST` | 监听端口与绑定地址 |
| `SV_BIND_ADDR` | compose 宿主侧绑定；HTTPS 场景设 `127.0.0.1` |
| `SV_DOMAIN` | Caddy 自动证书所用域名 |
| `SV_DATA_DIR` | 数据根目录，必须挂持久卷 |
| `SV_SECRET` | 固定会话签名密钥；不设则在数据目录生成 `secret.key`，卷重建会让所有人重新登录 |
| `SV_COOKIE_SECURE` | HTTPS 站点设为 1，给会话 Cookie 加 `Secure` |
| `SV_MAX_UPLOAD_MB` | 单文件上限（默认 200），须与反代上限一致 |
| `SV_REQUEST_TIMEOUT_MS` | 大视频上传窗口（默认 600000）；渲染在后台队列不受限 |
| `SV_TZ` | 时区，默认 `Asia/Shanghai` |
| `SV_ADMIN_EMAIL` / `SV_ADMIN_PASSWORD` | 首次初始化的管理员 |
| `SV_DATA_APIURL` / `SV_DATA_APIKEY` | 第三方合规爆款数据 API |
| `SV_LLM_BASEURL` / `SV_LLM_APIKEY` / `SV_LLM_MODEL` | OpenAI 兼容 `/chat/completions` |
| `SV_ASR_APIURL` / `SV_TTS_APIURL` | 语音转写 / 配音 |
| `SV_PUSH_WEBHOOKURL` | 日报推送到企微/飞书/Slack 兼容 Webhook |
| `SV_BACKUP_DIR` / `SV_BACKUP_KEEP` | 备份输出目录与保留份数 |

## 5. 真实爆款数据：数据源契约

**无 TikTok 官方权限，项目不内置任何公共页抓取器。** 默认使用内置演示数据（`demo`），榜单、快照、日报、订阅链路都能真实跑通，但指标不是真实平台数据。接入合规的第三方数据 API 后，状态会变为 `external`：

```
POST {SV_DATA_APIURL}
Headers: Authorization: Bearer {SV_DATA_APIKEY}  （或约定的 key 头）
Body:    { "day": "YYYY-MM-DD", "limit": 40, "categories": [...], "countries": [...] }
返回:    { "items": [ { video_id, title, author, url, cover, platform, category,
                        country, product, duration_sec, views, likes, comments,
                        saves, shares, gmv_estimate, posted_at } ] }
```

字段归一化逻辑见 `server/lib/providers.js` 的 `normalizeExternalItem`。适合的数据来源：有授权的第三方商业数据服务、TikTok Shop 合作方 API、自有/授权账号的官方 API。请勿用爬虫绕过登录墙、robots 或平台条款；上传的素材必须是自有或已获授权的内容。

## 6. 能力降级矩阵（不配任何密钥也能跑）

| 能力 | 未配置外部服务 |
|---|---|
| 每日发现 | 演示数据 + 真实定时同步、指标快照、榜单计算 |
| 拆解分析 | 本地规则引擎：ASR 时间轴样例、分镜切点、钩子/viral score、反推提示词、VOC、判官团 |
| 批量混剪 | 提示词 → 分镜 JSON、变体矩阵、真实 ffmpeg 渲染、TTS 占位静音轨、SRT、QC、物料包 |
| 日报推送 | 站内收件箱 |
| 多人协作 | 完整的服务端鉴权、组织/项目、角色、批注、版本、审批、审计、配额 |

所有降级结果都会标注 `source=local` / `source=demo`，不会伪装成真实平台数据。

## 7. 数据与备份

```
SV_DATA_DIR/
├── studio.sqlite        # 全部业务数据（WAL 模式）
├── secret.key           # 会话签名密钥（未设 SV_SECRET 时）
├── initial-admin.txt    # 首次初始化说明
├── uploads/<用户ID>/     # 上传的视频 / 音频 / 图片
├── outputs/<任务ID>/     # 成片 MP4、SRT、多画幅导出、物料包
└── tmp/                 # 上传 .part 与渲染中间文件
```

在线备份（服务不用停，SQLite 用 `VACUUM INTO` 取一致性快照）：

```bash
npm run backup -- /srv/backups               # 裸机
docker compose exec studio node --no-warnings server/scripts/backup.js /app/data/backups
# crontab：0 3 * * * cd /srv/shortvideo-studio && npm run backup -- /srv/backups
```

产物是 `sv-backup-<时间戳>.tar.gz`（权限 600），含数据库快照、`secret.key`、上传素材与成片，默认保留最近 14 份。**`secret.key` / `SV_SECRET` 必须与数据库一起备份**，否则恢复后所有成员会被强制重新登录。

恢复步骤：停服务 → 解压备份 → 用 `studio.sqlite` 覆盖数据目录同名文件、还原 `uploads/` 与 `outputs/`、还原 `secret.key` → 重新启动。若数据库文件已存在，先移走旧的并清理 `studio.sqlite-wal` / `-shm`。`docker compose down`（不带 `-v`）不会删除卷。

## 8. 稳定性设计（本轮加固）

| 场景 | 处理 |
|---|---|
| 容器 / 进程被重启，任务卡在 `running` | 启动时 + 每 5 分钟把超时（默认 30 分钟，`remix.staleMinutes`）的 running 放回 queued，清掉可能被 ffmpeg 写坏的半成品 MP4；SIGTERM 时主动归队并终止在途 ffmpeg 子进程 |
| 浏览器预览大成片 | 静态文件与 `/media/outputs/*` 支持 HTTP Range（206 / 416），可拖动进度、边下边播；成片按组织隔离，普通成员看不到其它组织的产出 |
| 多人同时上传大视频 | 上传改为流式落盘（不再整文件堆内存），超限 / 断连自动删 `.part`；上限 `SV_MAX_UPLOAD_MB` 可配 |
| 容器重建后全员掉线 | 显式 `SV_SECRET` 固定签名密钥；HTTPS 下 Cookie 自动带 `Secure` |
| 网关改写 `Authorization` | 服务端按 `X-SV-Token > sv_token Cookie > Bearer` 逐个验签；`<video>` 标签靠同源 Cookie 也能取成片 |
| 慢连接 / 大上传拖住进程 | `requestTimeout` 10 分钟、`headersTimeout` 65s；渲染在后台队列，不受影响 |
| 服务异常退出 | compose `restart: always` + `stop_grace_period: 20s` + 健康检查 `start_period`；日志按 20MB×5 轮转 |

**单实例约束**：定时同步、日报与混剪队列都在进程内，当前架构只能跑 1 个 `studio` 实例，**不要 `docker compose up --scale studio=2`**。要横向扩展，需先把队列和 cron 外置（Redis / 独立 worker）并给任务加租约；当前规模用「单机垂直扩容 + 限制 `remix.maxConcurrent`」更稳。

监控建议：外部探活 `/api/health`（30s）、`/api/status` 看 `providers.render` 与 `cron.queueWaiting`、磁盘剩余空间、`docker compose logs --tail=200`。队列持续堆积时先查 ffmpeg 是否可用、磁盘是否满。

## 9. 与静态备份站的关系

仓库 `gh-pages` 分支仍是 1.x 静态备份站，用于 GitHub Pages。2.0 前端在未连接后端时会显示「云服务器离线」提示并回退到浏览器端名单登录、原九页功能可用，但新四大模块不可用。

**因此升级后请通过云服务器地址访问，不要把 2.0 前端再发布成纯静态站。** 本仓库 `main` 存放 2.0 源码，`gh-pages` 保留旧静态版不动。

## 10. 上线检查清单

- [ ] 域名已解析、80/443 放行，`https://<域名>` 能打开登录页（不带任何分享码参数）
- [ ] `curl -k https://<域名>/api/health` 返回 `status: ok`；`/api/status` 里 `render` 不是 `missing`
- [ ] `curl -I -H 'Range: bytes=0-99' <成片URL>` 返回 `206` 与 `Content-Range`
- [ ] `.env` 已设 `SV_SECRET`、`SV_BIND_ADDR=127.0.0.1`，且 `.env` 未被提交进仓库
- [ ] 反代上传上限 ≥ `SV_MAX_UPLOAD_MB`，已关闭请求/响应缓冲
- [ ] 首次登录成功并已修改初始密码；用第二个浏览器验证新成员邀请流程
- [ ] 上传一段真实视频 → 生成分镜 → 发起批量混剪 → 预览并下载成片，全链路通过
- [ ] `npm run smoke` 全通过（会生成测试成片，验证后清理测试数据）
- [ ] 持久卷已挂载、`npm run backup` 定时生效、做过一次恢复演练
- [ ] 真实数据源 / 模型密钥通过环境变量或后台配置注入，未写进仓库
