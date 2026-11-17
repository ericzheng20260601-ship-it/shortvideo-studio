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
| **E. 资料库短链门户 + Node 后端（过渡）** | ✅ 固定短链免登录可达，跳转时自动重带分享码 | ✅ 后端承担 | ⚠ 同后端形态 | ✅ 不用买服务器/域名/备案；门户只读快照，生产仍受后端形态限制 | 暂不采购时的团队统一入口 |

**结论：正式走 A。** 链接形如 `https://studio.example.com`，管理员在后台加成员邮箱 → 系统生成一次性初始密码和邀请文本 → 私发给成员 → 成员打开链接登录即可生产。域名、证书、卷、备份都在自己手里，不依赖任何第三方分享码。

C 形态目前仍保留作验收站；它需要在网关 Cookie `__wb_rsc` 有效期内访问，且链接不能丢掉 `sharecode` 参数，不适合作为长期给团队发的正式入口。

**E 是 C 的入口层加固，不替代 A。** 用资料库发布态页面（与 chewtrue 工作台同一形态）产出免登录固定短链作团队统一入口，成员点击后跳到 Node 服务登录生产。好处有三：成员只记一条短链；每次跳转重新携带 `sharecode`，清缓存/换设备不再导致入口失效；以后换成 A 的正式域名只需改门户里的跳转目标，成员收藏的短链不变。代价是门户只提供只读快照、公开页不可写，且生产数据的持久性仍取决于后端形态。完整 SOP 见 `deploy/PORTAL.md`，模板与快照脚本在 `deploy/library-portal.html`、`deploy/build-portal-snapshot.py`。

**E 已上线（2026-11-11 13:41）**：门户节点落在「跨境电商项目 / 短视频工作台」文件夹，编辑态 `https://www.workbuddy.cn/space/d/vhHoZy3ibiOededcskT5PS`，发布态团队短链 `https://workbuddy.link/p/vhHoZy3ibiOededcskT5PS`，跳转目标为托管域 `?sharecode=5PAHXG5GGV`。发布态是**冻结快照**，数据变化需按 PORTAL.md 第 3 节走「重建快照 → 重导 → republish → 复核」四步。

> 注意：**不能把整个工作台改成资料库发布页或 Cloudflare Workers**。发布态是静态快照、匿名写操作被平台拦截；Workers 是 V8 隔离，无法运行 ffmpeg 原生二进制。只要「批量混剪出真 MP4」是硬需求，就必须保留一台能跑 ffmpeg、有持久磁盘的 Node 进程。详见工作区《短视频工作台_复用Chewtrue部署方式评估_2026-11-11.md》。

### 0.1 不买服务器 / 不买域名的可行形态

「不买服务器」不等于「不需要一台能跑 ffmpeg 的机器」，只是这台机器可以不由你付费。按可行性排序：

| 形态 | 月费用 | 代码改动 | 持久盘 | 说明 |
|---|---|---|---|---|
| **C + E + 自动备份**（当前线上 + 门户短链） | 0 | 无 | ⚠ 沙箱卷 | 立即可用；必须把 `npm run backup` 产物外送到对象存储，防实例重建丢数据 |
| **F. Oracle Cloud Always Free VM** | 0 | 无 | ✅ 200GB 块盘 | 永久免费 2 OCPU / 12GB ARM + 10TB 出站，本仓 compose/Caddy 原样可用；把 `remix.maxConcurrent` 降到 1、限制 ffmpeg 线程；注意 2026-06 起 A1 额度减半、Home Region 不可改、闲置可能回收 |
| **G. 自有常开电脑 + Cloudflare Tunnel** | 0 | 少量 | ✅ 本机硬盘 | 出站隧道免公网 IP / 免端口映射 / 自动 HTTPS；**免费档请求体上限 100MB**，需把 `SV_MAX_UPLOAD_MB` 调到 ≤90 或改造分片上传；Quick Tunnel 域名会变，长期用命名隧道 |
| H. 免费 PaaS（Render / Cloud Run / Koyeb） | 0 | 大改 | ❌ | 休眠 + 临时盘 + 低配，需把 SQLite / 素材 / 队列全部外置，改造量接近重写，不建议 |
| I. 浏览器端渲染 + 纯静态托管 | 0 | 重写 | ❌ | 唯一真正无后端；但大素材、50 条批量、RBAC / 共享素材库 / 审计全部失效 |

**推荐组合**：先用 C+E 让团队零成本用起来并外送备份，再迁到 F（或 G）；迁移时门户短链只改跳转目标，成员收藏链接不变。完整调研与 2026 年各平台免费额度变化见工作区《短视频工作台_零服务器部署方案_2026-11-11.md》。

**两阶段可执行 SOP**：`deploy/free/README.md`。① 阶段新增 `GET /api/admin/backup`（仅管理员，流式返回含 SQLite 快照 / 会话密钥 / 素材 / 成片的 tar.gz）与 `deploy/free/pull-backup.sh`（外部定时拉取、校验、AES-256 加密、可选 rclone 转存）；② 阶段提供 `deploy/free/oci-init.sh`（ARM 初始化、免费 HTTPS 域名、并发调优、每日备份与探活）、`restore-backup.sh`（含回滚包与会话密钥对齐）、`.env.free.example`。**备份接口已于 2026-11-11 13:40 随线上重新发布生效**；当前仅剩「定时外送」未启用（`deploy/free/github-actions-backup.yml` 是模板，未复制到 `.github/workflows/`）。

**2026-11-11 13:40 重新发布后的线上实测**（`https://shortvideo-studio-03074.app.workbuddy.host/?sharecode=5PAHXG5GGV`，链接与 sharecode 保持不变）：health 200 / v2.0.0、`providers.render=ffmpeg`、静态首页 200、`Range: bytes=0-1023` → **206**（`content-range: bytes 0-1023/48690`）、未登录 `/api/config` 401、`/media/outputs/` 401、`/data/` 403；管理员邮箱登录成功（owner）；**`GET /api/admin/backup` 未登录 401、管理员 200**（22.8KB tar.gz，含 `studio.sqlite` / `secret.key` / `README.txt` / `uploads/` / `outputs/`，带 `content-disposition` 下载头）。`/api/remix/batches`、`/api/remix/assets` 仍为 0，重新发布未丢数据。

即：**视频生产、播放与「把数据导出成备份」三条链路都已可用**；但托管域沙箱卷仍不保证跨实例重建，备份文件目前只存在请求方本地，**必须有定时外送 + 常驻机还原，才能做到「视频长期不丢」**。发布态门户只解决入口链接，见 `deploy/PORTAL.md` 第 6 节。

#### 0.1.1 用腾讯系网盘承接「备份外送」

可以，但**腾讯网盘（新，资料库底层）与腾讯微云是两个产品，都没有 rclone 原生 backend**，接进来要换通道：

| 目标 | 通道 | 容量 / 费用（2026-11-11） | 评价 |
|---|---|---|---|
| 腾讯网盘（新） | WorkBuddy 资料库上传（单文件 ≤100 MiB）/ CLI·MCP（个人版仍标「申请体验」） | 内测免费 5GB；1TB 必须开 Buddy One VIP **¥700/月**（连续包年 ¥6720），且与资料库/文档/ima 共用 | 单纯存备份性价比最低 |
| 腾讯微云 | 官方 MCP / WorkBuddy「微云」连接器（两阶段 FTN 分片上传） | 免费约 5–10GB；超会 **6TB ¥30/月**；空间券 1TB ¥600/年；上传流量券另购 | 便宜量大，但授权与限速要盯 |
| 腾讯云 COS | **rclone 原生支持**，只填 `SV_RCLONE_REMOTE` | 新用户标准存储 50GB 免费 6 个月，之后约 ¥0.099–0.118/GB/月；入流量免费 | 改动最小，推荐 |
| Cloudflare R2 / OCI 对象存储 | rclone 原生支持 | 免费 10GB / 20GB | 零成本首选 |

三条硬注意：① 全量备份包含所有素材与成片，**每日一份、保留 14 份时 20GB 稳态数据约需 280GB**，免费 5GB 一天就满；② 当前 `pull-backup.sh` **只轮转本地**，`rclone copyto` 到远端是纯追加，接入前必须补远端旧包清理；③ 网盘只保证「备份有地方放」，**不提供实例重建后的自动恢复**，仍需 ② 阶段的常驻机器执行 `restore-backup.sh`。不推荐用 alist/OpenList 的逆向 WebDAV 驱动接微云（不维护、QQ Cookie 仅 48h）。完整核价与接入路径见工作区《短视频工作台_腾讯网盘备份与ClipForge部署调研_2026-11-11.md》。

#### 0.1.2 零成本 / 低成本的其他两阶段组合

| 档 | ① 备份外送 | ② 常驻机器 | 年成本 | 备注 |
|---|---|---|---|---|
| 0 | **GitHub Actions cron → artifact**（500MB 免费档、7 天保留） | 自有常开电脑 + Tunnel，或长期留 ① | ¥0 | 零信用卡、零新账号；管理员电脑不必常开。模板 `deploy/free/github-actions-backup.yml`（**复制到 `.github/workflows/` 才生效**），单包 >50MB 会闸门失败 |
| 1 | GitHub Actions / crontab → R2 10GB | OCI Always Free | ¥0 | 需绑支付方式；R2 免费档开通也要绑卡，额度内不扣费 |
| **2（推荐）** | **¥99/年国内 ECS 上跑 crontab** | 同一台 ECS 随时 `docker compose up -d` 转正 | **¥99 → ¥109–154** | 锚点机只做出站拉备份 + SSH，**不绑域名、不开 80/443，因此转名前不需要 ICP 备案**；转正再买域名备案 |
| 3 | ECS 本机备份 / COS | 直接形态 A 正式域名 | ¥109–154 | 备案 7–20 工作日，等待期用 ① 托管域顶着 |
| 4 | R2 10GB | 海外低价 VPS（Hetzner CX23 €5.49/月） | ¥540 起 | 免备案但国内访问慢；2026 两轮涨价 |

**2026 年判断**：能长期零成本跑 ffmpeg + 持久盘的常驻 VM 仍只有 Oracle A1。GCP e2-micro（1GB 内存、**出站仅 1GB/月**）、AWS 新免费层（6 个月 credits 后关账户）、Azure B1s（12 个月）都跑不动本项目。完整核价、决策树与落地步骤见工作区《短视频工作台_零成本与低成本两阶段方案_2026-11-11.md》。

明确排除：Cloudflare Workers / Vercel / Pages / 资料库发布页承载生产写操作（无原生二进制、无持久 FS、CPU 时长受限）。

#### 0.1.3 J. 桌面安装包（不买服务器，用户装到自己的设备）

可以做成 `.dmg` / `.exe` / `.AppImage`：安装包自带 **Node 22 便携运行时 + ffmpeg + 全部服务端源码 + 静态前端**，用户双击启动即在本机起 `127.0.0.1:17800`，**登录仍是邮箱 + 密码（走本机 `/api/auth/login`）**，首次启动弹窗给出随机管理员初始密码。与 ClipForge 桌面版同构。工程在 `desktop/`，SOP 见 `desktop/README.md`，完整评估见工作区《短视频工作台_桌面安装包方案_2026-11-11.md》。

| 用法 | 做法 | 结果 |
|---|---|---|
| **J-A 单机版** | 每人各装一份，默认 `SV_APP_HOST=127.0.0.1` | 账号/素材/成片各管各的，**多人协作失效** |
| **J-B 便携服务器（推荐）** | 团队一台常开电脑装，设 `SV_APP_HOST=0.0.0.0` | 同事浏览器访问 `http://<内网IP>:17800/`，仍用同一套邮箱账号，数据只有一份；无域名、无备案、无公网 IP |

**两个硬边界**：① `node:sqlite` 要求 Node ≥22.5，安装包必须随包带运行时，启动器会逐个候选做能力自检；② **J-A 下 SQLite 就在安装者手里，改库即可提权/绕配额/抹审计**，邮箱登录只防误用不防有意绕过——要权限真正不可绕过，中心端（J-B 的那台机器 / 形态 A / 线上托管域）必须存在。

成本：构建与运行 ¥0；不签名可分发，但每人首次打开要手动放行 Gatekeeper / SmartScreen；去掉拦截需 Apple Developer ¥688/年或 Windows OV 证书约 ¥1000–2000/年。异地访问仍需内网穿透或回到 F/档 2。**升级只需替换 `resources/app/`，用户数据目录（含 `secret.key`）不动**。本机已跑通启动器登录链路、二次启动幂等、LAN 绑定与 `npm run smoke` 56/56；**未产出真安装包、未签名、未提交 git**。

### 0.2 常见故障：导入视频后没有生成视频

先看 `/api/status` 新增的 `render: { source, encoder, hasX264, encoders }`，再看 `/api/remix/batches` 里 job 的 `error`。2026-11-11 线上实测到的三类原因：

1. **`Unknown encoder 'libx264'`** —— 系统 ffmpeg 被裁剪，只有音频编码器。修复：`ffmpegBin()` 改为优先随依赖安装的 `ffmpeg-static`，`videoEncoder()` 按 `libx264 → libopenh264 → mpeg4` 自适应，`SV_FORCE_VIDEO_ENCODER` 可强制指定。注意 `providers.render=ffmpeg` 只说明二进制存在，**不代表编码器齐全**。
2. **界面链路混淆** —— `#/auto` 页上方是云面板「提示词批量混剪」（才有真 MP4），下方静态「智能成片」按设计只产出工程包 JSON。在下方选的视频只留在本机内存，不上传服务端。
3. **上传的视频没进渲染输入** —— 静态「素材库」走 WorkBuddy 云存储，与服务端 `media_assets` 不互通；必须走云面板「素材四维分级与上传」（`/api/remix/upload`）。修复后 `renderOne()` 会以本地视频素材为画面主体，按 `job.idx` 轮换，无素材才用纯色占位并给出确认提示。

已失败的批次不必重建：`POST /api/remix/batches/:id/resume`（面板「断点续跑」）会把 `failed` 任务重新置为 `queued`；也可只重试单个任务 `POST /api/remix/jobs/:id/retry`。**先上传素材再续跑**，否则成片仍是占位画面。完整证据、修复清单与验证结果见工作区《短视频工作台_智能成片无视频故障排查_2026-11-11.md》。

**2026-11-11 15:15 已按用户明确授权重新发布线上（链接与 sharecode 不变）**：`/api/status.render` 实测 `{ source: "ffmpeg-static", encoder: "libx264", hasX264: true, encoders: ["libx264","mpeg4"] }`，说明发布沙箱 `npm install` 装上了带 H.264 的完整 ffmpeg，**无需降级 mpeg4**。线上端到端验证：上传 17KB 测试视频 → 重试旧批次的 1 个失败任务 → **done 1/1**，事件日志「本条使用 sv-publish-verify.mp4」，成片 `output_9x16.mp4` 共 633,474 字节、`Range` 返回 **206** `video/mp4`、文件头 `ftypisom`，备份包能导出 3 个画幅成片。批次计数由 `done=0/failed=27` 变为 `done=1/failed=26`，其余 26 个任务保留待上传真实素材后续跑。发布前已把 `server/data/`、`backups/`、`desktop/runtime/ffmpeg` 临时移出发布目录并还原，避免本地运行时数据与会话密钥随包上传。

### 0.3 智能成片页：一步式流程（2026-11-11 15:55）

`#/auto` 页整体重写为单表单流程：**导入视频（选中即自动上传服务端）→ 提示词 → 一句话校准 → 赛道 → 风格 → 变体矩阵（钩子/字幕/时长 chips）→ 生产数量（1–50）→ 唯一「开始生成」按钮**。点击后自动串「上传确认 → `/api/remix/plan` → `/api/remix/batches` → 3 秒轮询渲染」，右侧展示进度条、任务明细与成片预览/下载（3 画幅 + SRT + 配音），失败任务可单条重试，运行中可取消。旧「提示词批量混剪」云面板不再挂载到本页（`PANELS` 已移除 `auto` 项，`remixPanel` 保留未引用）；拆解报告的「送到混剪」仍通过 `sv.pendingReport` 接入。离线/未登录时不再产出模拟工程包，而是明确提示需登录云服务。

配套服务端改动：`POST /api/remix/batches` 新增 `count` 参数——变体矩阵组合多于 `count` 时截断、少于时轮换复制补足（上限仍 50），让「生产数量」成为权威参数。已验证：矩阵 1 组合×count=3 → 3 任务全 done；9 组合×count=4 → 截为 4 条；count=51 → 400。`npm run smoke` 56/56 无回归。**该改动属服务端+前端代码，需重新发布线上才生效。**

后续增强（2026-11-11 17:15）：① 进度轮询修复为 3 秒循环 + 失败退避重试，批次 ID 存 `sessionStorage`，页面刷新自动恢复进行中/已结束批次；② 表单新增「⑧ 配音语言（普通话/粤语/英语/日语）」与「⑨ 画幅（9:16 / 1:1 / 16:9 多选）」，随变体写入 `voice`/`ratios`，服务端只渲染所选画幅；③ 「生成进度」「成片结果」卡片移至「开始生成」按钮下方单列排布；④ 新增 `GET /api/remix/batches/:id/export`（创建者或 admin），把批次内全部已完成成片（多画幅 MP4 + SRT + 配音）打成 tar.gz 供「成片结果」页一键批量导出。smoke 59/59。

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
| 批量混剪 | 提示词 → 分镜 JSON、变体矩阵、真实 ffmpeg 渲染、**Edge TTS 真实配音**（9 语言 Neural 音色）、SRT、QC、物料包 |
| 素材兜底 | 无本地素材时自动从 Wikimedia Commons（CC 源）抓 b-roll；国内网络不可达时回退占位画面 |
| 爆款雷达 | 演示数据；接入真实数据自动生效，双通道：① 配 `radar.youtubeKey` 走 YouTube Data API v3（免费但 Google Cloud 需绑卡开 Key）；② 不配 Key 走开源 Invidious 公共实例（免 Key 免账号）。6h 服务端缓存 + 30min 前端缓存 + 失败 10min 冷却期（刷新可击穿）。**注意：两条通道都要求运行环境能访问 Google/YouTube 站点**（国内网络不可达，海外服务器如 OCI 生效）；不可达时自动回退演示数据并标注原因 |
| 日报推送 | 站内收件箱 |
| 多人协作 | 完整的服务端鉴权、组织/项目、角色、批注、版本、审批、审计、配额 |

所有降级结果都会标注 `source=local` / `source=demo`，不会伪装成真实平台数据。

### 6.1 CLI 流水线（借鉴 ClipForge）

```bash
# 环境变量：SV_CLI_URL / SV_CLI_EMAIL / SV_CLI_PASSWORD / SV_CLI_LANG(en-US) / SV_CLI_COUNT(1)
node server/cli.mjs status                          # 服务健康与队列
node server/cli.mjs trends --limit=5                # 每日发现条目
node server/cli.mjs script --prompt="..."           # 生成分镜脚本
node server/cli.mjs create --plan=<id> --count=3    # 创建批次并等待完成
node server/cli.mjs qc --batch=<id>                 # 成片质检汇总
node server/cli.mjs gate --batch=<id> --min-score=60  # 发布闸门（exit 0/1）
node server/cli.mjs credits --batch=<id>            # CC 素材署名清单
node server/cli.mjs daily                           # 一条命令跑完 trends→script→create→qc→gate
```

cron 日更示例：`0 9 * * * cd /app && SV_CLI_EMAIL=... SV_CLI_PASSWORD=... node server/cli.mjs daily >> /var/log/sv-daily.log 2>&1`

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
