# 短视频工作台 · 云服务器部署说明

2.0 版把工作台从「浏览器端静态站」升级为「自带后端的云服务器应用」：前端仍是一套原生 ES modules 静态页面，由同一个 Node 服务托管；`/api/*` 提供鉴权、每日发现、拆解分析、批量混剪、多人协作能力。数据落在 `node:sqlite` 单文件 + 本地媒体目录，不需要外部数据库、缓存或消息队列。

## 1. 运行要求

| 项 | 要求 |
|---|---|
| Node.js | ≥ 22.5（用到内置 `node:sqlite`、原生 `fetch`） |
| ffmpeg | 系统安装，或 `npm install` 安装 `ffmpeg-static` 二进制；缺失时渲染任务会明确报 blocked |
| 中文字体 | 字幕烧录需要，Docker 镜像已装 `fonts-noto-cjk` |
| 端口 | 监听 `PORT`（默认 3000），绑定 `0.0.0.0`，只暴露一个 HTTP 端口 |
| 磁盘 | `SV_DATA_DIR` 需要持久化卷：SQLite、上传素材、成片、会话密钥都在里面 |

后端只用 Node 内置模块，Docker 镜像里不需要 `npm install`（系统 ffmpeg 已装）。根目录 `package.json` 里声明 `ffmpeg-static` 是为了兼容「只有 Node、会自动 npm install」的托管沙箱。

## 2. 三种启动方式

### A. 裸机 / 云主机

```bash
git clone <仓库地址> && cd shortvideo-studio
cp .env.example .env          # 按需填写，全部留空也能跑（自动降级）
sudo apt-get install -y ffmpeg fonts-noto-cjk   # Debian/Ubuntu
npm start                     # 等价于 node server.js
# 打开 http://<服务器IP>:3000
```

生产建议用 systemd / pm2 托管，并用 Nginx 或 Caddy 反代 + HTTPS，不要把 3000 直接暴露公网。

### B. Docker（推荐）

```bash
cd shortvideo-studio
cp .env.example .env
docker compose up -d --build
docker compose logs -f
# 打开 http://<服务器IP>:3000
```

`docker-compose.yml` 的构建上下文是工程根，`studio-data` 卷挂载到 `/app/data`。升级：`git pull && docker compose up -d --build`；卷内数据不会丢。健康检查已配置（`/api/health`）。

### C. 本地开发验证

```bash
SV_PORT=3310 SV_DATA_DIR=/tmp/sv-studio-test node --no-warnings server/index.js
SV_BASE=http://127.0.0.1:3310 SV_DATA_DIR=/tmp/sv-studio-test npm run smoke
```

`npm run smoke` 是 56 项全流程冒烟测试，会真实调用 ffmpeg 渲染出 MP4，覆盖登录/权限、榜单与快照、拆解报告、变体矩阵队列、QC、审批与审计日志。

## 3. 首次登录与账号

- 首次启动会从仓库根目录 `data/accounts.json` 导入账号名单（只有 PBKDF2-SHA256 加盐摘要，无明文密码），并写入 `SV_DATA_DIR/initial-admin.txt` 说明（该文件不入库）。
- 若名单无法导入，则按 `SV_ADMIN_EMAIL` 创建独立管理员，`SV_ADMIN_PASSWORD` 留空时随机生成并写入数据目录。
- 登录后请立刻在「账户 → 修改密码」改密；后续成员、角色、禁用、重置密码都在「管理后台 → 云服务器管理」操作，服务端是唯一身份源。
- 会话用签名 token（HttpOnly Cookie / Bearer 双通道），密钥落在数据目录 `secret.key`，请随卷一起备份。

## 4. 环境变量

完整清单与注释见 `.env.example`。命名规则：`SV_` + 配置键大写并去掉点，例如 `discover.syncHour` → `SV_DISCOVER_SYNCHOUR`。也可以在「管理后台 → 云服务器管理」里可视化配置，配置存库、重启不丢；敏感值在读取接口里会被打码。

| 变量 | 作用 |
|---|---|
| `PORT` / `SV_HOST` | 监听端口与绑定地址 |
| `SV_DATA_DIR` | 数据根目录，必须挂持久卷 |
| `SV_TZ` | 时区，默认 `Asia/Shanghai`（榜单按日、日报按小时都基于它） |
| `SV_ADMIN_EMAIL` / `SV_ADMIN_PASSWORD` | 首次初始化的管理员 |
| `SV_DATA_APIURL` / `SV_DATA_APIKEY` | 第三方合规爆款数据 API |
| `SV_LLM_BASEURL` / `SV_LLM_APIKEY` / `SV_LLM_MODEL` | OpenAI 兼容 `/chat/completions` |
| `SV_ASR_APIURL` / `SV_TTS_APIURL` | 语音转写 / 配音 |
| `SV_PUSH_WEBHOOKURL` | 日报推送到企微/飞书/Slack 兼容 Webhook |

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
├── secret.key           # 会话签名密钥
├── initial-admin.txt    # 首次初始化说明
├── uploads/<用户ID>/     # 上传的视频 / 音频 / 图片
├── outputs/<任务ID>/     # 成片 MP4、SRT、多画幅导出、物料包
└── tmp/                 # 渲染中间文件
```

备份整个目录即可。SQLite 为 WAL 模式，冷备时先停服务或用 `VACUUM INTO`。容器化时卷不要删；`docker compose down`（不带 `-v`）不会丢数据。

## 8. 与静态备份站的关系

仓库 `gh-pages` 分支仍是 1.x 静态备份站，用于 GitHub Pages。2.0 前端在未连接后端时会显示「云服务器离线」提示并回退到浏览器端名单登录、原九页功能可用，但新四大模块不可用。

**因此升级后请通过云服务器地址访问，不要把 2.0 前端再发布成纯静态站。** 本仓库 `main` 存放 2.0 源码，`gh-pages` 保留旧静态版不动。

## 9. 上线检查清单

- [ ] `curl http://127.0.0.1:3000/api/health` 返回 `status: ok`
- [ ] `/api/status` 里 `render` 不是 `missing`（ffmpeg 可用）
- [ ] 首次登录成功并已修改初始密码
- [ ] `npm run smoke` 56 项全通过（会生成测试成片，验证后清理测试数据）
- [ ] 反代已配 HTTPS、上传大小限制（服务端上限 60MB）、访问日志
- [ ] `SV_DATA_DIR` 挂了持久卷并做了定期备份
- [ ] 真实数据源 / 模型密钥通过环境变量或后台配置注入，未写进仓库
