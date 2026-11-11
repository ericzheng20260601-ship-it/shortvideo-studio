#!/usr/bin/env bash
# 短视频工作台 · 生产环境一键引导（通用，不绑定具体机器）
# 用法：在云主机上 clone 仓库后执行  bash deploy/bootstrap.sh
# 第一次运行会生成 .env 并自动写入随机 SV_SECRET，然后提示你填真实域名；
# 填好 SV_DOMAIN 后再跑一次，就会构建镜像、起 Caddy(HTTPS) 并做健康检查。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml)

echo "==> 工程目录：$ROOT"

command -v docker >/dev/null 2>&1 || { echo "✗ 未安装 Docker。先安装 Docker Engine + Compose 插件（官方脚本：https://get.docker.com）"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✗ Docker Compose 插件不可用，请安装 docker-compose-plugin"; exit 1; }

if [[ ! -f .env ]]; then
  cp deploy/.env.production.example .env
  SECRET="$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' "s|^SV_SECRET=.*|SV_SECRET=${SECRET}|" .env
  else
    sed -i "s|^SV_SECRET=.*|SV_SECRET=${SECRET}|" .env
  fi
  chmod 600 .env
  cat <<'TIP'
==> 已生成 .env，并写入随机 SV_SECRET（请长期保留，不要修改）。
    现在请编辑 .env，把 SV_DOMAIN=studio.example.com 改成你的真实域名，
    确认域名 A 记录已指向本机、80/443 已放行（大陆云主机需先备案）。
    编辑完成后重跑：bash deploy/bootstrap.sh
TIP
  exit 0
fi

get_var() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'" || true; }
DOMAIN="$(get_var SV_DOMAIN || true)"
SECRET="$(get_var SV_SECRET || true)"
BIND="$(get_var SV_BIND_ADDR || true)"

if [[ -z "$DOMAIN" || "$DOMAIN" == "studio.example.com" ]]; then
  echo "✗ .env 里的 SV_DOMAIN 还是占位值，请填真实域名后重跑"; exit 1
fi
if [[ -z "$SECRET" ]]; then
  echo "✗ .env 缺少 SV_SECRET。可运行：openssl rand -hex 32 生成后填入"; exit 1
fi
if [[ "$BIND" != "127.0.0.1" ]]; then
  echo "⚠ 建议把 SV_BIND_ADDR 设为 127.0.0.1，让 3000 不直接暴露公网（当前：$BIND）"
fi

echo "==> 域名：$DOMAIN  构建并启动容器（首次约 1–3 分钟）"
"${COMPOSE[@]}" up -d --build

echo "==> 等待服务健康"
OK=0
for i in $(seq 1 30); do
  if curl -fsS --noproxy '*' http://127.0.0.1:3000/api/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [[ "$OK" != "1" ]]; then
  echo "✗ 健康检查未通过，查看日志："; "${COMPOSE[@]}" logs --tail=80 studio; exit 1
fi

STATUS="$(curl -fsS --noproxy '*' http://127.0.0.1:3000/api/status)"
echo "==> 内网健康检查通过：${STATUS:0:240}"
BACKUP_DIR="$(get_var SV_BACKUP_DIR)"; [[ -n "$BACKUP_DIR" ]] || BACKUP_DIR=/srv/backups
mkdir -p "$BACKUP_DIR" 2>/dev/null || echo "⚠ 备份目录未创建，请手动创建：$BACKUP_DIR"
cat <<TIP

==> 部署完成。接下来：
  1) 浏览器打开 https://${DOMAIN}   （Caddy 会自动申请 / 续期证书，首次可能需要几十秒）
     若证书一直签不下来：检查域名解析、80/443 放行、备案状态。
  2) 管理员登录 → 头像 → 修改密码 → 管理后台 → 成员与角色 → 添加成员 → 复制邀请信息私发。
  3) 配每日备份（宿主机 crontab）：
     0 3 * * * cd ${ROOT} && npm run backup -- \$(grep '^SV_BACKUP_DIR=' .env | cut -d= -f2-) >> /var/log/sv-backup.log 2>&1
  4) 常用运维：
     "${COMPOSE[*]}" logs -f studio      # 看日志
     "${COMPOSE[*]}" up -d --build       # 更新代码后重建
     "${COMPOSE[*]}" down                # 停服务（不带 -v，数据卷保留）
TIP
