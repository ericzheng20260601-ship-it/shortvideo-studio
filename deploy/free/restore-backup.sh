#!/usr/bin/env bash
# 短视频工作台 · ① → ② 迁移：把 pull-backup.sh 拉下来的备份还原到自有容器
# 用法：bash deploy/free/restore-backup.sh /srv/backups/sv-backup-XXXX.tar.gz[.enc]
# 加密包需 export SV_BACKUP_PASSPHRASE='<当时用的口令>'
# 会先停服务、把当前数据另存一份回滚包，再覆盖还原；不带 -v，数据卷本身不删除。
set -euo pipefail

FILE="${1:-}"
[[ -n "$FILE" ]] || { echo "用法：bash deploy/free/restore-backup.sh <备份文件.tar.gz|.enc>"; exit 1; }
[[ -f "$FILE" ]] || { echo "✗ 找不到备份文件：$FILE"; exit 1; }
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml)
command -v docker >/dev/null 2>&1 || { echo "✗ 需要 Docker"; exit 1; }

WORK="$(mktemp -d)"; STAGE="$(mktemp -d)"
cleanup() { rm -rf "$WORK" "$STAGE"; }
trap cleanup EXIT

SRC="$FILE"
case "$FILE" in
  *.enc)
    : "${SV_BACKUP_PASSPHRASE:?加密包需要 SV_BACKUP_PASSPHRASE}"
    export SV_BACKUP_PASSPHRASE
    openssl enc -d -aes-256-cbc -pbkdf2 -in "$FILE" -out "$WORK/backup.tar.gz" \
      -pass env:SV_BACKUP_PASSPHRASE || { echo "✗ 解密失败，检查口令"; exit 1; }
    SRC="$WORK/backup.tar.gz"
    ;;
esac

tar -tzf "$SRC" > "$WORK/list.txt"
grep -q 'studio.sqlite' "$WORK/list.txt" || { echo "✗ 备份包里没有 studio.sqlite，拒绝还原"; exit 1; }
echo "==> 备份校验通过（含 $(wc -l < "$WORK/list.txt" | tr -d ' ') 个条目）"

# 找到 compose 创建的数据卷（不同项目名会带不同前缀）
mapfile -t VOLS < <(docker volume ls -q --filter name=studio-data)
[[ ${#VOLS[@]} -gt 0 ]] || { echo "✗ 未找到 studio-data 数据卷，请先跑一次 oci-init.sh"; exit 1; }
VOL="${VOLS[0]}"
echo "==> 数据卷：${VOL}"

echo "==> 停止服务（数据卷保留）"
"${COMPOSE[@]}" down

cp "$SRC" "$STAGE/restore.tar.gz"; chmod 600 "$STAGE/restore.tar.gz"
echo "==> 另存当前数据做回滚保险，然后解压还原"
docker run --rm -v "$VOL:/data" -v "$STAGE:/stage" busybox:1.36 sh -c '
  set -e
  tar -czf /stage/before-restore-db.tar.gz    -C /data studio.sqlite 2>/dev/null || true
  tar -czf /stage/before-restore-media.tar.gz -C /data uploads outputs 2>/dev/null || true
  rm -f /data/studio.sqlite /data/studio.sqlite-wal /data/studio.sqlite-shm
  rm -rf /data/uploads /data/outputs
  tar -xzf /stage/restore.tar.gz -C /data
'
if [[ -f "$STAGE/before-restore-db.tar.gz" || -f "$STAGE/before-restore-media.tar.gz" ]]; then
  mkdir -p /srv/backups/pre-restore
  cp "$STAGE"/before-restore-*.tar.gz /srv/backups/pre-restore/ 2>/dev/null || true
  echo "==> 回滚包已存到 /srv/backups/pre-restore/"
fi
# STAGE 会在 trap 里删除，回滚包已另存

# 会话密钥必须与备份一起还原，否则 ① 阶段所有成员会被强制重新登录
tar -xzf "$SRC" -C "$WORK" ./secret.key 2>/dev/null || true
if [[ -f "$WORK/secret.key" ]]; then
  SECRET="$(tr -d '\r\n' < "$WORK/secret.key")"
  if [[ -n "$SECRET" && -f .env ]]; then
    if grep -qE '^SV_SECRET=' .env; then sed -i "s|^SV_SECRET=.*|SV_SECRET=${SECRET}|" .env
    else printf 'SV_SECRET=%s\n' "$SECRET" >> .env; fi
    chmod 600 .env
    echo "==> 已沿用备份里的会话密钥，成员无需重新登录"
  fi
else
  echo "⚠ 备份里没有 secret.key；若服务端原本用显式 SV_SECRET，请确认 .env 里的值与 ① 阶段一致" >&2
fi

echo "==> 启动并检查健康"
"${COMPOSE[@]}" up -d
OK=0
for i in $(seq 1 30); do
  if curl -fsS --noproxy '*' --max-time 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [[ "$OK" != "1" ]]; then
  echo "✗ 启动后健康检查未通过，看日志："; "${COMPOSE[@]}" logs --tail=80 studio; exit 1
fi

cat <<'TIP'

==> 还原完成。请逐项确认：
    1) 用 ① 阶段的管理员账号登录，确认成员、素材、成片、审计日志都在。
    2) 管理后台把 remix.maxConcurrent 保持在 1（2 核免费实例不要并行渲染）。
    3) 上传一小段视频 → 发起批量混剪 → Range 206 预览 → 下载成片，全链路跑一遍。
    4) 门户短链只改 SV_PORTAL_TARGET，按 deploy/PORTAL.md 重新发布，成员链接不变。
    5) 若结果不对，用 /srv/backups/pre-restore/ 里的回滚包按同样步骤还原回去。
TIP
