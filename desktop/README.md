# 短视频工作台 · 桌面安装包

把现有的 Node 服务端、静态前端、SQLite、ffmpeg 一起打进一个安装程序：用户装到自己的电脑，双击启动就是完整工作台，**仍然用邮箱 + 密码登录**（走本机 `POST /api/auth/login`，不是浏览器里的静态名单）。

---

## 1. 先想清楚：「每人装一份」意味着什么

| 形态 | 装在哪 | 邮箱登录作用于 | 数据 | 多人协作 | 服务器 |
|---|---|---|---|---|---|
| **A 单机版** | 每个使用者各自装 | 各自电脑上的本地账号库 | 各人一份，互不相通 | ❌ 退化为孤岛 | 不需要 |
| **B 便携服务器**（推荐） | 团队里一台常开电脑装 | 这一台上的统一账号库 | 全团队一份 | ✅ 保留组织/角色/审计/共享素材 | 不需要，这台电脑就是服务器 |
| **C 瘦客户端** | 每人装 | 远端中心服务端 | 中心一份 | ✅ | **仍需要中心机**，安装包只是浏览器壳 |

用户说「拿到安装包在目标设备安装」，最容易落成 A；但 A 会把前面做的多人协作全部拆散——每位成员要单独被邀请、改密互不生效、素材与成片无法共享、审计日志也各看各的。

**本工程的默认做法兼顾 A / B**：默认只监听 `127.0.0.1`（A，纯本机、最安全）；管理员设置 `SV_APP_HOST=0.0.0.0` 后即变 B，同事在局域网用浏览器打开 `http://<这台机器的IP>:17800/`，仍用同一个邮箱账号登录，数据只有一份。异地访问再加内网穿透或回到云主机方案。

> ⚠️ **权限边界必须说清**：A 形态下 SQLite 文件就在安装者手里，懂行的人可以直接改库把自己提成 owner、绕过配额、抹掉审计。所以「邮箱登录」在单机版里只防误用，不防有意绕过；把安装包发给不可信的人，等于把服务端代码和账号 PBKDF2 摘要一起交出去。**要真正的权限边界，登录校验与数据必须放在中心端（B 的中心机 / 线上托管域 / OCI）。**

---

## 2. 构建（在开发机上做一次）

```bash
cd shortvideo-studio
npm install                      # 根依赖
(cd server && npm install)        # 取 ffmpeg-static 二进制（stage-app.js 会读 server/node_modules 或根 node_modules）

cd desktop
npm install                      # electron + electron-builder，约 200MB
npm run stage                     # 生成 staging/app/（静态前端 + 服务端源码 + 名单）
npm run runtime                   # 下载 Node >=22.5 便携运行时（node:sqlite 自检）
npm run dist:mac                  # → desktop/dist/*.dmg / *.zip
# Windows 构建机：npm run dist:win   → *.exe (NSIS)
# Linux 构建机：  npm run dist:linux → *.AppImage
```

`stage-app.js` 只复制运行必需文件，**排除运行时数据、node_modules、.git、deploy/、Dockerfile、测试脚本**，并把当前平台的 ffmpeg 放进 `desktop/runtime/`。`prepare-runtime.js` 的产物：

```
desktop/runtime/
├── bin/node        (win: node.exe)   ← Node 22，官方便携二进制
└── ffmpeg          (win: ffmpeg.exe) ← 真实渲染用
```

electron-builder 把两者放进 `resources/runtime/`，把 `staging/app/` 放进 `resources/app/`。因为 `server/lib/util.js` 的 `ROOT` 是 `server/lib/../..`，打包后正好指向 `resources/app`，**服务端代码一行都不用改**；`SV_DATA_DIR` 由启动器指到用户数据目录，与只读的安装目录分离。

交叉构建：`node prepare-runtime.js --platform win32 --arch x64 --ffmpeg-from /path/to/ffmpeg.exe --skip-ffmpeg` 这类组合不能跨机复现二进制，**每个目标平台各自构建一次最稳**；`--dry-run` 可只打印计划不联网。

---

## 3. 分发与首次登录

1. 把 `.dmg` / `.exe` / `.AppImage` 发给使用者（体积约 90–160MB，含 Electron + Node + ffmpeg）。
2. 未签名包首次打开需要手动放行：macOS「系统设置 → 隐私与安全性 → 仍要打开」，Windows SmartScreen「更多信息 → 仍要运行」。
3. 首次启动弹窗给出**管理员邮箱 + 随机初始密码**（同时写入数据目录的 `初始管理员.txt`，权限 600）。服务端只存 PBKDF2 摘要，关掉弹窗后无法找回，只能重装数据目录重置。
4. 用邮箱 + 初始密码登录 → 「头像 → 账户信息 → 修改密码」→ 在「管理后台 → 云服务器管理 → 成员与角色」邀请其他成员，一次性初始密码私发给对方。
5. B 形态下把 `SV_APP_HOST=0.0.0.0` 告知管理员，启动器会打印局域网访问地址；放行系统防火墙即可，无需域名、无需备案。

数据目录（**升级/卸载时不会被删**）：

| 系统 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/短视频工作台/data/` |
| Windows | `%APPDATA%\短视频工作台\data\` |
| Linux | `~/.config/短视频工作台/data/` |
| 绿色版 | `~/.shortvideo-studio/data/` |

**升级**：重装新版或替换 `resources/app/` 即可，数据目录不动；`secret.key` 留在数据目录，已登录会话不会集体失效。**备份**：管理后台「下载完整备份」，或 `npm run backup`（绿色版）；A 形态建议把整个数据目录同步到网盘/对象存储，B 形态沿用 `deploy/free/` 的外送脚本。**卸载**：先备份数据目录，再卸载。

---

## 4. 成本

| 项目 | 费用 |
|---|---|
| 构建工具（Electron / electron-builder，开源） | ¥0 |
| 运行时（Node / ffmpeg / SQLite，随包） | ¥0 |
| 分发（直接发文件 / 内网共享） | ¥0 |
| 目标设备 CPU 与硬盘（混剪、成片） | 已有设备，¥0 新增 |
| **macOS 签名 + 公证**（去掉 Gatekeeper 拦截） | Apple Developer **¥688/年**（99 USD） |
| **Windows 代码签名**（去掉 SmartScreen 警告） | OV 证书约 **¥1000–2000/年** |
| 异地公网访问（可选） | 域名 + 备案，或内网穿透；否则 ¥0 |

**不签名可以做到真 0 元**，代价是每个用户首次打开要手动放行一次。这与之前调研的 ClipForge 桌面版一致：Electron + 内置 ffmpeg + 本地 SQLite，只是它开源分发、同样面临签名问题。

---

## 5. 与现有部署方案的关系

- 安装包**替代的是「买一台云主机」**：用团队自有电脑当常驻机，无信用卡、无 Always Free 容量限制、无 7 天闲置回收、无备案。
- 代价：这台机器要常开、会占 CPU/磁盘，且没有公网 IP 时只能局域网；异地协作仍需①阶段的托管域或②阶段的 OCI/ECS。
- ① 阶段的「备份外送」在这里同样适用，且更简单：数据目录就在本机，可直接跑定时任务。
- 线上托管域与桌面包可以并存：线上做团队统一入口，桌面包做离线/内网生产，账号体系各自独立（不能互通）。

---

## 6. 本机验证状态

- ✅ `launcher.js` 已在 macOS / Node 22.22.2 实跑：指定端口起服、`/api/health` 200、静态首页 200、管理员邮箱 + 初始密码登录成功、`/api/auth/me` 返回 owner、ffmpeg 随包命中、未登录 401、备份接口 200、SIGTERM 优雅停服无孤儿进程。
- ✅ 二次启动幂等（不重发初始密码、旧密码仍可登录）与 LAN 模式本机实测（`0.0.0.0` 绑定 + 内网 IP 列出）；`npm run smoke` 56/56 无回归。
- ✅ `stage-app.js` 已生成 staging/app 并核对目录结构与体积。
- ⚠️ **未在本机执行 `npm install electron` / `electron-builder`，因此未产出 dmg/exe 真安装包**；`main.js` 与 `package.json` 只做了语法与配置校验。
- ⚠️ `prepare-runtime.js` 未联网下载（本机已有 Node 22 与 ffmpeg-static），只做 `--dry-run` 计划校验；交叉构建 ffmpeg 需目标平台自行提供。
- ⚠️ 局域网模式（B）未做多机实测；签名/公证未做。

---

## 7. 环境变量速查

| 变量 | 默认 | 说明 |
|---|---|---|
| `SV_APP_HOST` | `127.0.0.1` | 设 `0.0.0.0` 开启局域网共享 |
| `SV_APP_PORT` | `17800` | 被占用会自动向后找 20 个端口 |
| `SV_APP_DATA_DIR` | 用户数据目录 | 绿色版可显式指定 |
| `SV_APP_ROOT` | `resources/app` | 应用资源根（打包时自动） |
| `SV_NODE_BIN` | 随包 → Electron → PATH | 强制指定 Node 运行时 |
| `SV_FFMPEG_PATH` | 随包 → ffmpeg-static | 强制指定 ffmpeg |
| `SV_ADMIN_EMAIL` | 名单内管理员邮箱 | 首次启动的管理员邮箱 |
| `SV_ADMIN_PASSWORD` | 随机生成 | 指定则不再生成随机初始密码 |
| `SV_APP_NO_OPEN` | 未设 | 设 1 后启动器不自动开浏览器（自动化用） |
