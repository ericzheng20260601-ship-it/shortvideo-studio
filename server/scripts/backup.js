'use strict';
/* 在线备份：SQLite 用 VACUUM INTO 取一致性快照（WAL 模式下也安全），
   再把上传素材、成片、会话密钥一起打成 tar.gz。可在服务运行时执行，无需停机。
   用法：npm run backup -- /path/to/backups   或  SV_BACKUP_DIR=/path node server/scripts/backup.js
   crontab 示例：0 3 * * * cd /srv/shortvideo-studio && npm run backup -- /srv/backups >> /var/log/sv-backup.log 2>&1
*/
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const U = require('../lib/util');

const outDir = path.resolve(process.argv[2] || process.env.SV_BACKUP_DIR || path.join(U.ROOT, 'backups'));
const keep = Math.max(1, U.int(process.env.SV_BACKUP_KEEP, 14));
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const work = path.join(U.TMP_DIR, `backup-${stamp}`);
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(path.join(U.DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(U.OUTPUT_DIR, { recursive: true });

const src = path.join(U.DATA_DIR, 'studio.sqlite');
if (!fs.existsSync(src)) throw new Error(`未找到数据库：${src}（请确认 SV_DATA_DIR 指向正确的数据卷）`);
const snap = path.join(work, 'studio.sqlite');
const db = new DatabaseSync(src);
try {
  // VACUUM INTO 会得到一份已提交事务的完整副本，不会把 WAL 里的半截事务带出来
  db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
} finally { db.close(); }

const key = path.join(U.DATA_DIR, 'secret.key');
if (fs.existsSync(key)) fs.copyFileSync(key, path.join(work, 'secret.key'));
fs.writeFileSync(path.join(work, 'README.txt'),
  `短视频工作台备份 ${new Date().toISOString()}\n` +
  `studio.sqlite：用 VACUUM INTO 生成的一致性快照\n` +
  `secret.key：会话签名密钥（必须与数据库一起恢复，否则所有人需重新登录）\n` +
  `uploads/：用户上传素材\noutputs/：成片、SRT、多画幅导出\n`);

const tar = path.join(outDir, `sv-backup-${stamp}.tar.gz`);
execFileSync('tar', ['-czf', tar, '-C', work, '.', '-C', U.DATA_DIR, 'uploads', 'outputs'], { stdio: 'pipe' });
fs.chmodSync(tar, 0o600);
fs.rmSync(work, { recursive: true, force: true });

const files = fs.readdirSync(outDir).filter(f => /^sv-backup-.*\.tar\.gz$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(outDir, f), { force: true });

console.log(`[backup] ${tar} (${(fs.statSync(tar).size / 1024 / 1024).toFixed(2)} MB)，保留最近 ${keep} 份`);
