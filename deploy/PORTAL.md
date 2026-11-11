# 资料库短链门户（团队统一入口）

用一个资料库**发布态页面节点**做团队统一入口，产出免登录可看的固定短链，形态与 chewtrue 工作台一致。门户只负责「导航 + 只读快照」，**生产动作仍由 Node 后端承担**。

```
成员 → https://workbuddy.link/p/<节点ID>   （免登录、固定短链、只读快照）
          │ 点击「进入工作台」
          ▼
       SV_PORTAL_TARGET                     （服务端账号登录 → 上传 / 拆解 / 混剪 / 协作）
```

## 0. 三条前置，先确认再动手

1. **团队空间**：目标空间 `category=team` 时，必须先把方案摆给用户、等明确同意再建节点或发布。个人空间可直接执行。
2. **发布需要管理员权限**：`publish_page.py` 无权限会失败；资料库操作令牌按 library skill 的取票链获取，**只经 stdin 传入，不落盘**。
3. **公开链接「可看不可写」**：非 WorkBuddy 用户没有登录会话，发布态页面保持可看，但写类交互会被平台拦截。因此本页**不放任何表单、上传、按钮写操作**；唯一的动作是跳转到 Node 服务，登录后在工作台内完成生产。

## 1. 文件

| 文件 | 作用 |
|---|---|
| `deploy/library-portal.html` | 自包含门户模板。无第三方外链、无 `<img>`、无外部 JS/CSS，天然通过图片托管自检 |
| `deploy/build-portal-snapshot.py` | 从 Node 服务端拉取当天榜单，生成内嵌快照产物 |
| `deploy/out/library-portal.html` | **实际导入的产物**（由脚本生成，不手改，建议加入 `.gitignore`） |

模板顶部两个常量由脚本注入，不要手工改产物：

- `STUDIO_URL`：成员点击「进入工作台」的完整 URL；占位值会让按钮自动禁用并提示管理员配置。
- `SNAPSHOT`：`{ updatedAt, source, items[] }`。`items` 为空时页面显示「未接入快照」，**绝不填充示例数字**；`source` 为 `demo` / `local` / `unknown` 时页面标注「演示数据」。

## 2. 首次上线

```bash
cd /path/to/shortvideo-studio

# ① 生成快照产物（凭据只走环境变量）
export SV_BASE='https://<Node 服务域名>'
export SV_PORTAL_TARGET='https://<Node 服务完整入口，含分享码>'
export SV_GATE_QUERY='sharecode=<分享码>'      # 无网关时留空
export SV_ADMIN_EMAIL='<管理员邮箱>'
export SV_ADMIN_PASSWORD='<管理员密码>'
python3 deploy/build-portal-snapshot.py

# ② 导入资料库页面节点（首次指定空间和父节点）
python3 "${CODEBUDDY_SKILL_DIR}/page/import_html.py" \
  deploy/out/library-portal.html \
  --file-name "短视频工作台·团队入口.html" \
  --space-id "<团队空间ID>" --parent-id "<父节点ID>"
# 成功回执里的 node_block_id 记为 PORTAL_NODE_ID

# ③ 发布，取得公开短链
python3 "${CODEBUDDY_SKILL_DIR}/page/publish_page.py" --node-id "<PORTAL_NODE_ID>"
```

发布成功后**必须同时给回两个链接**（各自单独成行，不要与标记或文字紧贴）：

- 编辑态链接：`workbuddy.cn/space/d/<node>`，来自 `space.workspace.node-info` 的 `data.node.url`，供管理员改版，不要自己拼。
- 发布态链接：来自 `KS_PAGE_PUBLISH` 回执，形如：

https://workbuddy.link/p/&lt;节点ID&gt;

这条才是发给团队的。

## 3. 日常刷新（数据变了必须走完四步）

发布态是**冻结快照**，重导不会自动同步发布态，漏掉 republish 是最常见的「改了但线上没变」。

```bash
# ① 重新生成产物（内嵌最新快照）
python3 deploy/build-portal-snapshot.py

# ② 重导同一节点
python3 "${CODEBUDDY_SKILL_DIR}/page/import_html.py" \
  deploy/out/library-portal.html \
  --node-block-id "<PORTAL_NODE_ID>"

# ③ 重新发布（短链本身不变）
python3 "${CODEBUDDY_SKILL_DIR}/page/publish_page.py" --node-id "<PORTAL_NODE_ID>"

# ④ 复核发布态版本号递增，并打开短链确认按钮可点、快照时点已更新
python3 "${CODEBUDDY_SKILL_DIR}/page/list_page_publish_artifacts.py" --node-id "<PORTAL_NODE_ID>"
```

需要每天自动刷新时，把 ①–③ 串成一个定时任务（定时刷新只在凭据有效时可用；令牌过期要重新取票）。判据是发布态版本号递增，不是「脚本 exit 0」。

## 4. 以后换后端域名

只改 `SV_PORTAL_TARGET` 重跑 ①–③，**团队收藏的短链不用改**。这也是先做门户层的额外好处：过渡期用托管域，正式上线换自有域名，对成员无感。

过渡期 `SV_PORTAL_TARGET` 会带平台分享码；每次从门户跳转都会重新携带分享码，所以成员清缓存、换设备、收藏错链接导致入口失效的问题不复现。真正的权限闸门是服务端账号，分享码只是第一道门，**门户页绝不写账号、密码、密钥或内部数据**。

## 5. 上线检查清单

- [ ] 短链免登录打开正常，四个能力卡片与权限说明齐全
- [ ] 「进入工作台」按钮可点，跳转到 Node 服务登录页
- [ ] 快照区显示真实时点与来源；演示数据明确标注，不冒充真实平台指标
- [ ] 页脚口径说明存在：公开页 = 发布快照，工作台内 = 实时数据
- [ ] 页面无任何账号、密钥、素材原文件、经营数据
- [ ] 无第三方外链图片/脚本（图片托管自检通过）
- [ ] 发布态版本号递增，编辑态与发布态两条链接都已回执

## 6. 不做什么

- 不把上传、混剪、批注、审批等写操作塞进门户页——平台会拦截匿名写。
- 不用 Page DB SDK 读表代替服务端 API；本页是纯静态，不关联数据表。
- 不用内嵌快照冒充实时队列进度或成片状态。
- 不在门户页放真实经营数据；也不把 Node 服务的数据库、密钥目录暴露到公网。
