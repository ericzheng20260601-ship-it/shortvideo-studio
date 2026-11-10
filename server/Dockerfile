# 短视频工作台云服务器镜像
# 构建上下文必须是工程根目录：docker compose up -d --build
# 端口由 PORT 环境变量决定（默认 3000），服务绑定 0.0.0.0
# 数据（SQLite、上传素材、成片、密钥）全部落在 SV_DATA_DIR，请用卷持久化
FROM node:22-bookworm-slim

# ffmpeg 用于真实渲染与成片 QC；中文字体用于字幕烧录
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

ENV PORT=3000 \
    SV_HOST=0.0.0.0 \
    SV_DATA_DIR=/app/data \
    SV_TZ=Asia/Shanghai \
    NODE_ENV=production

# 不需要 npm install：后端只用 Node 22 内置模块（http / node:sqlite / crypto / fetch）
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "--no-warnings", "server/index.js"]
