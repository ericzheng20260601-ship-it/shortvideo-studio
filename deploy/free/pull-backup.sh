#!/usr/bin/env bash
# 短视频工作台 · ① 阶段「备份外送」
# 从托管域的管理员备份接口拉取完整备份 → 校验 → 可选加密 → 可选转存对象存储。
# 可跑在管理员本机 / 任意一台能联网的机器 / CI 定时任务，不需要服务器常开。
#
# 用法（凭据只走环境变量，绝不写进脚本或仓库）：
#   export SV_BASE='https://shortvideo-studio-03074.app.workbuddy.host'
#   export SV_GATE_QUERY='sharecode=<分享码>'        # 无平台网关时留空
#   export SV_ADMIN_EMAIL='<管理员邮箱>'
#   export SV_ADMIN_PASSWORD='<管理员密码>'
#   export SV_BACKUP_PASSPHRASE='<自定义长口令>'    # 可选；设了就 AES-256 加密落盘
#   export SV_RCLONE_REMOTE='r2:shortvideo-backups' # 可选；需本机装好 rclone
#   bash deploy/free/pull-backup.sh
# crontab：0 3 * * * SV_BASE=... SV_ADMIN_EMAIL=... SV_ADMIN_PASSWORD=... /path/to/pull-backup.sh
set -euo pipefail

: "${SV_BASE:?请设置 SV_BASE（Node 服务根地址，不带末尾斜杠）}"
: "${SV_ADMIN_EMAIL:?请设置 SV_ADMIN_EMAIL}"
: "${SV_ADMIN_PASSWORD:?请设置 SV_ADMIN_PASSWORD}"
export SV_ADMIN_EMAIL SV_ADMIN_PASSWORD

SV_GATE_QUERY="${SV_GATE_QUERY:-}"
OUT_DIR="${SV_BACKUP_LOCAL_DIR:-$HOME/shortvideo-backups}"
KEEP="${SV_BACKUP_KEEP:-14}"
PASSPHRASE="${SV_BACKUP_PASSPHRASE:-}"
REMOTE="${SV_RCLONE_REMOTE:-}"

command -v curl >/dev/null 2>&1 || { echo "✗ 需要 curl"; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "✗ 需要 tar"; exit 1; }
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
JAR="$(mktemp)"; TMP="$(mktemp "$OUT_DIR/.pull-XXXXXX")"; LIST="$(mktemp)"
cleanup() { rm -f "$JAR" "$TMP" "$LIST"; }
trap cleanup EXIT

json_login() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os,json;print(json.dumps({"email":os.environ["SV_ADMIN_EMAIL"],"password":os.environ["SV_ADMIN_PASSWORD"]}))'
  elif command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(JSON.stringify({email:process.env.SV_ADMIN_EMAIL,password:process.env.SV_ADMIN_PASSWORD}))'
  else
    echo "✗ 需要 python3 或 node 来安全构造登录 JSON" >&2; return 1
  fi
}
parse_token() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])'
  else
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))'
  fi
}

# 平台网关靠 __wb_rsc Cookie 放行，先取一次入口页把 Cookie 落到 jar 里
GATE_URL="$SV_BASE/"
[[ -n "$SV_GATE_QUERY" ]] && GATE_URL="${GATE_URL}?${SV_GATE_QUERY}"
curl -fsS --max-time 30 -c "$JAR" -o /dev/null "$GATE_URL" >/dev/null 2>&1 \
  || echo "⚠ 入口页探测失败（自建域名无网关时可忽略）" >&2

LOGIN_RESP="$(curl -fsS --max-time 60 -b "$JAR" -c "$JAR" -X POST "$SV_BASE/api/auth/login" \
  -H 'Content-Type: application/json' --data-binary "$(json_login)")"
TOKEN="$(printf '%s' "$LOGIN_RESP" | parse_token)"
[[ -n "$TOKEN" ]] || { echo "✗ 登录未返回 token，检查管理员邮箱与密码"; exit 1; }

echo "==> 正在生成并下载备份（素材多时可能需要数十秒）"
# 托管网关可能改写 Authorization，用 X-SV-Token + 同源 Cookie 双通道
curl -fsS --max-time 1800 -b "$JAR" -H "X-SV-Token: $TOKEN" \
  "$SV_BASE/api/admin/backup" -o "$TMP"

tar -tzf "$TMP" > "$LIST"
grep -q 'studio.sqlite' "$LIST" || { echo "✗ 备份包缺少 studio.sqlite，已丢弃"; exit 1; }
grep -q 'secret.key' "$LIST" || echo "⚠ 备份包未含 secret.key（服务端用显式 SV_SECRET 时属正常）" >&2
grep -q 'uploads/' "$LIST" || echo "⚠ 备份包未含 uploads/（可能尚无素材）" >&2

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -n "$PASSPHRASE" ]]; then
  export SV_BACKUP_PASSPHRASE="$PASSPHRASE"
  FINAL="$OUT_DIR/sv-backup-${STAMP}.tar.gz.enc"
  if ! openssl enc -aes-256-cbc -pbkdf2 -salt -in "$TMP" -out "$FINAL" \
       -pass env:SV_BACKUP_PASSPHRASE 2>/dev/null; then
    echo "✗ openssl 不支持 -pbkdf2，请升级 openssl（或改用 age/gpg 自行加密）"; exit 1
  fi
  rm -f "$TMP"
else
  FINAL="$OUT_DIR/sv-backup-${STAMP}.tar.gz"
  mv "$TMP" "$FINAL"
fi
chmod 600 "$FINAL"

if [[ -n "$REMOTE" ]]; then
  command -v rclone >/dev/null 2>&1 || { echo "✗ 设置了 SV_RCLONE_REMOTE 但未安装 rclone"; exit 1; }
  rclone copyto "$FINAL" "$REMOTE/$(basename "$FINAL")"
  echo "==> 已外送：$REMOTE/$(basename "$FINAL")"
fi

COUNT="$(find "$OUT_DIR" -maxdepth 1 -type f -name 'sv-backup-*' -print | wc -l | tr -d ' ')"
if [[ "$COUNT" -gt "$KEEP" ]]; then
  DEL=$((COUNT - KEEP))
  find "$OUT_DIR" -maxdepth 1 -type f -name 'sv-backup-*' -print | sort \
    | awk -v n="$DEL" 'NR<=n' | while IFS= read -r f; do rm -f "$f"; done
fi

echo "==> 备份完成：$FINAL"
echo "    保留最近 ${KEEP} 份于 ${OUT_DIR}；未配置 rclone 时请自行把该目录同步到云盘 / 对象存储。"
echo "    加密包解密：openssl enc -d -aes-256-cbc -pbkdf2 -in <文件> -out backup.tar.gz -pass env:SV_BACKUP_PASSPHRASE"
