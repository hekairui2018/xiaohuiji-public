'use strict';
// 构建包携带版本清单；加载一次，健康接口返回的是进程已加载的版本。
const fs = require('fs');
const path = require('path');
let release = null;
try {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'release-info.json'), 'utf8'));
  if (typeof data.version === 'string' && /^[a-f0-9]{40}$/.test(data.commit || '') &&
      typeof data.build_time === 'string') {
    release = Object.freeze({ version: data.version, commit: data.commit, build_time: data.build_time });
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.error('[release] invalid release-info.json');
}
module.exports = release;
