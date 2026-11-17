#!/usr/bin/env bash
# 短视频工作台 · ② 阶段：Oracle Cloud Always Free（ARM / Ubuntu）零成本初始化
# 在 OCI 的 Ampere A1 / Ubuntu 22.04 或 24.04 实例上以 root 运行一次。
#
#   export SV_REPO_URL='<Git 仓库地址>'
#   export SV_SECRET='<可选：① 阶段备份 secret.key 的内容，填了成员无需重新登录>'
#   export SV_DOMAIN='<可选：自有域名 / 免费 DDNS；不填自动用 <公网IP>.sslip.io>'
#   sudo -E bash deploy/free/oci-init.sh
#
# 不要套 Cloudflare 免费代理或 Tunnel：免费档请求体上限 100MB，会卡住 200MB 素材上传。
set -euo pipefail

: "${SV_REPO_URL:?请设置 SV_REPO_URL（Git 仓库地址；私有仓库请先配好凭据）}"
[[ "$(id -u)" -eq 0 ]] || { echo "✗ 请用 root / sudo -E 运行"; exit 1; }
ROOT="${SV_INSTALL_DIR:-/srv/shortvideo-studio}"
DOMAIN_INPUT="${SV_DOMAIN:-}"
SECRET_INPUT="${SV_SECRET:-}"

ARCH="$(uname -m)"
[[ "$ARCH" == "aarch64" ]] || echo "⚠ 当前架构 ${ARCH}；OCI Always Free 的 A1 额度只适用于 ARM64 实例" >&2

echo "==> 安装 / 校验 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "✗ 缺少 docker-compose-plugin，请安装 docker-compose-plugin"; exit 1; }
systemctl enable --now docker >/dev/null 2>&1 || true

IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
[[ -n "$IP" ]] || IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "$IP" ]] || { echo "✗ 无法获取公网 IP，请显式设置 SV_DOMAIN"; exit 1; }
if [[ -z "$DOMAIN_INPUT" ]]; then
  DOMAIN="${IP//./-}.sslip.io"
  echo "==> 未指定域名，使用免费通配符 DNS：${DOMAIN}（第三方服务，正式使用建议换自有域名）"
else
  DOMAIN="$DOMAIN_INPUT"
fi

echo "==> 防火墙（实例侧）"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi
cat <<FW

⚠ 还必须在 OCI 控制台放行两层，否则 Caddy 签不下证书：
   1) VCN → Security List / NSG：入站放行 TCP 80、443（来源 0.0.0.0/0）
   2) 实例内 iptables：OCI Ubuntu 镜像的 INPUT 链末尾常有 REJECT 规则，
      若 80/443 仍不通，检查 iptables -L INPUT --line-numbers，
      把 ACCEPT 规则插到那条 REJECT 之前。本脚本不擅自改动现有 iptables。
FW

echo "==> 准备代码：${ROOT}"
if [[ -d "$ROOT/.git" ]]; then
  git -C "$ROOT" pull --ff-only
else
  git clone "$SV_REPO_URL" "$ROOT"
fi
cd "$ROOT"

if [[ ! -f .env ]]; then cp deploy/.env.production.example .env; fi
set_env() {
  local k="$1" v="$2"
  if grep -qE "^${k}=" .env; then sed -i "s|^${k}=.*|${k}=${v}|" .env
  else printf '%s=%s\n' "$k" "$v" >> .env; fi
}
SECRET="$SECRET_INPUT"
[[ -n "$SECRET" ]] || SECRET="$(openssl rand -hex 32)"
set_env SV_DOMAIN "$DOMAIN"
set_env SV_SECRET "$SECRET"
set_env SV_BIND_ADDR 127.0.0.1
set_env SV_COOKIE_SECURE 1
set_env SV_MAX_UPLOAD_MB 200
set_env SV_MEM_LIMIT 6g
set_env SV_CPUS 2
set_env SV_BACKUP_DIR /srv/backups
set_env SV_BACKUP_KEEP 14
chmod 600 .env

mkdir -p /srv/backups; chmod 700 /srv/backups
# 备份落宿主机而不是数据卷，避免把 200GB 额度吃满；该文件已被 .gitignore 忽略
cat > docker-compose.override.yml <<'YML'
services:
  studio:
    volumes:
      - /srv/backups:/srv/backups
YML

echo "==> 构建并启动（首次约 1–3 分钟），域名：${DOMAIN}"
bash deploy/bootstrap.sh

echo "==> 2 核实例调优：混剪并发降为 1"
docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml exec -T studio \
  node -e "const DB=require('./server/lib/db');DB.setConfig('remix.maxConcurrent',1);console.log('[init] remix.maxConcurrent =',DB.getConfig('remix.maxConcurrent'));" \
  || echo "⚠ 未自动生效，请登录管理后台把 remix.maxConcurrent 改成 1" >&2

echo "==> 配置每日备份与保活定时任务"
CRON_FILE="$(mktemp)"
{ crontab -l 2>/dev/null | grep -v 'sv-backup\|sv-keepalive' || true; } > "$CRON_FILE"
cat >> "$CRON_FILE" <<CRON
0 3 * * * cd ${ROOT} && docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml exec -T studio node server/scripts/backup.js /srv/backups >> /var/log/sv-backup.log 2>&1
*/10 * * * * curl -fsS --max-time 10 http://127.0.0.1:3000/api/health >/dev/null 2>&1 || true
CRON
crontab "$CRON_FILE"; rm -f "$CRON_FILE"

cat <<TIP

==> 部署完成：https://${DOMAIN}
    1) Caddy 首次申请证书可能需要几十秒；签不下来先查上面两层防火墙与域名解析。
    2) 从 ① 阶段迁移：把 pull-backup.sh 拉下来的备份传上来，执行
       bash deploy/free/restore-backup.sh /srv/backups/<备份文件>
       还原后账号、素材、成片、会话全部延续；管理员登录后建议立即改密。
    3) 门户短链切换：把 SV_PORTAL_TARGET 改成 https://${DOMAIN}，
       按 deploy/PORTAL.md 走「重建快照 → 重导 → republish → 复核」，成员收藏的短链不变。
    4) 验收：curl -fsS https://${DOMAIN}/api/health ；上传视频 → 批量混剪 → 预览 206 → 下载成片。
    5) OCI 免费层注意：2026-06 起 A1 额度为 2 OCPU / 12GB（以控制台 Limits 页为准）；
       200GB 块盘含启动卷、10TB/月出站；7 天低利用率实例可能被回收，纯免费账户无 SLA。
       保持每日同步/使用与上面的保活探活，别长期完全闲置。
TIP
