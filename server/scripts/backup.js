'use strict';
/* CLI 入口：npm run backup -- /path/to/backups
   crontab：0 3 * * * cd /srv/shortvideo-studio && npm run backup -- /srv/backups >> /var/log/sv-backup.log 2>&1
   容器内：docker compose exec -T studio node server/scripts/backup.js /srv/backups */
const path = require('node:path');
const { createBackup } = require('../lib/backup');

createBackup({ outDir: process.argv[2] ? path.resolve(process.argv[2]) : undefined })
  .then(({ file, size, keep }) => {
    console.log(`[backup] ${file} (${(size / 1024 / 1024).toFixed(2)} MB)，保留最近 ${keep} 份`);
  })
  .catch(e => { console.error('[backup] 失败：', e.message); process.exitCode = 1; });
