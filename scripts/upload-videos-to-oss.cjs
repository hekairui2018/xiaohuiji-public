/*
 * 把 LED 操作视频上传到阿里云 OSS（桶 he-mo，公共读），前缀 video/，按软件分类分子目录。
 * 与规格书/固件同一桶、同一套 V1 签名与凭证 scripts/.oss-config.json；零第三方依赖。
 *
 * 关键约定：
 *   - 视频要能在网页/企微“在线播放”，故 Content-Type=video/mp4，不设 Content-Disposition=attachment。
 *   - 小/中视频(<100MB)直接取微盘原片；大视频(>=100MB)只传 720p 压缩成品（tmp/video-720p/<同名>），
 *     压缩成品尚不存在则记为 pending 跳过（绝不传未压缩的大视频），可反复跑续传。
 *   - A6/D15 复位片用已制作的中英双语成品替换英文原片（对象名用中文新名）。
 *   - 云端已存在且等长自动 HEAD 跳过；--force 强制重传；--dry-run 只列不传。
 *
 * 用法：
 *   node scripts/upload-videos-to-oss.cjs --dry-run
 *   node scripts/upload-videos-to-oss.cjs --limit 3      只传前 3 个就绪文件（测速/试传）
 *   node scripts/upload-videos-to-oss.cjs               传全部就绪文件
 *   node scripts/upload-videos-to-oss.cjs --big-only    只传已压好的大视频
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const BASE = 'E:\\WXWork\\1688857708791124\\WeDrive\\灰度科技\\公司资料\\技术资料';
const CSV = path.join(ROOT, 'tmp', 'wedrive-led-operation-videos-final.csv');
const BIG_DIR = path.join(ROOT, 'tmp', 'video-720p');
const BILINGUAL_DIR = path.join(ROOT, 'output', 'reset-bilingual');
const PREFIX = 'video';

const SUB = {
  '0-软件下载教程': 'software',
  '1-HDSet': 'hdset',
  '2-HDPlayer异步全彩': 'hdplayer',
  '4-HDShow同步处理器': 'hdshow',
  '5-HDSign单双色': 'hdsign',
  '6-屏掌控APP': 'app',
  '7-云平台小灰云': 'cloud',
  '8-操作短视频合集': 'misc'
};
// 英文复位原片 -> 中英双语成品（上云用双语版，对象名用中文）
const BILINGUAL = {
  'A6 reset.mp4': 'A6复位操作（中英字幕）.mp4',
  'D15reset.mp4': 'D15复位操作（中英字幕）.mp4'
};

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(r => r.length >= 4 && r[0] !== 'Cat');
}

function loadConfig() {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, '.oss-config.json'), 'utf8').replace(/^﻿/, ''));
  return {
    AccessKeyId: process.env.OSS_AK || f.AccessKeyId,
    AccessKeySecret: process.env.OSS_SK || f.AccessKeySecret,
    Region: process.env.OSS_REGION || f.Region,
    Bucket: process.env.OSS_BUCKET || f.Bucket
  };
}
function ossAuthorization(cfg, method, ossKey, date, contentType = '', canonHeaders = '') {
  const resource = '/' + cfg.Bucket + '/' + ossKey;
  const stringToSign = [method.toUpperCase(), '', contentType, date, canonHeaders + resource].join('\n');
  const sig = crypto.createHmac('sha1', cfg.AccessKeySecret).update(Buffer.from(stringToSign, 'utf8')).digest('base64');
  return 'OSS ' + cfg.AccessKeyId + ':' + sig;
}
const encodedPath = k => '/' + k.split('/').map(encodeURIComponent).join('/');
function ossRequest(cfg, method, ossKey, body, headers = {}, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const contentType = headers['Content-Type'] || '';
    const head = {
      Host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`,
      Date: date,
      Authorization: ossAuthorization(cfg, method, ossKey, date, contentType, headers['x-oss-canon'] || ''),
      ...headers
    };
    delete head['x-oss-canon'];
    if (body) head['Content-Length'] = body.length;
    const req = https.request(
      { host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`, path: encodedPath(ossKey), method, headers: head },
      (res) => { const c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    if (body) req.end(body); else req.end();
  });
}
async function withRetry(fn, times = 3) {
  let last;
  for (let i = 1; i <= times; i++) { try { return await fn(); } catch (e) { last = e; console.log('  重试', i, e.message); await new Promise(r => setTimeout(r, 1500 * i)); } }
  throw last;
}

function buildItems() {
  const rows = parseCsv(fs.readFileSync(CSV, 'utf8').replace(/^﻿/, ''));
  const items = [];
  for (const [cat, mbS, name, rel] of rows) {
    const mb = Number(mbS);
    const sub = SUB[cat] || 'misc';
    if (BILINGUAL[name]) {
      const cnName = BILINGUAL[name];
      const local = path.join(BILINGUAL_DIR, cnName);
      items.push({ cat, name: cnName, origName: name, local, ossKey: `${PREFIX}/${sub}/${cnName}`, kind: 'bilingual' });
      continue;
    }
    if (mb >= 100) {
      const compressed = path.join(BIG_DIR, name);
      if (fs.existsSync(compressed)) {
        items.push({ cat, name, local: compressed, ossKey: `${PREFIX}/${sub}/${name}`, kind: '720p' });
      } else {
        items.push({ cat, name, local: null, ossKey: `${PREFIX}/${sub}/${name}`, kind: 'pending-big', mb });
      }
      continue;
    }
    items.push({ cat, name, local: BASE + rel, ossKey: `${PREFIX}/${sub}/${name}`, kind: 'original' });
  }
  for (const it of items) if (it.local && fs.existsSync(it.local)) it.size = fs.statSync(it.local).size;
  return items;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const bigOnly = args.includes('--big-only');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const cfg = loadConfig();
  for (const k of ['AccessKeyId', 'AccessKeySecret', 'Region', 'Bucket']) if (!cfg[k]) throw new Error('缺少 OSS 配置 ' + k);

  let items = buildItems();
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const ready = items.filter(x => x.local && x.size > 0 && (!bigOnly || x.kind === '720p')
    && (!only || x.name.includes(only) || x.ossKey.includes(only)));
  const pending = items.filter(x => x.kind === 'pending-big');
  const fmtMB = n => (n / 1048576).toFixed(1);
  const grp = {};
  for (const x of ready) (grp[x.kind] = grp[x.kind] || { c: 0, mb: 0 }), (grp[x.kind].c++, grp[x.kind].mb += x.size);
  console.log(`就绪 ${ready.length} 个 / ${fmtMB(ready.reduce((s, x) => s + x.size, 0))}MB` +
    `（原片 ${grp.original ? grp.original.c : 0}、双语 ${grp.bilingual ? grp.bilingual.c : 0}、720p ${grp['720p'] ? grp['720p'].c : 0}）；待压缩大视频 ${pending.length} 个。`);
  if (dryRun) {
    ready.forEach(x => console.log(`  [${x.kind}] ${fmtMB(x.size)}MB  ${x.ossKey}`));
    pending.forEach(x => console.log(`  [pending-big] ${x.mb}MB  ${x.name}`));
    console.log('[dry-run] 不上传。');
    return;
  }

  let uploaded = 0, skipped = 0, failed = 0, done = 0;
  const failures = [], manifest = [];
  for (const x of ready) {
    if (done >= limit) { console.log('达到 --limit', limit, '，停止。'); break; }
    done++;
    try {
      if (!force) {
        const head = await withRetry(() => ossRequest(cfg, 'HEAD', x.ossKey, null, {}, 30000));
        if (head.status === 200 && Number(head.headers['content-length']) === x.size) {
          skipped++; console.log(`跳过(已存在) ${x.name}`);
          manifest.push({ name: x.name, ossKey: x.ossKey, sizeBytes: x.size, kind: x.kind, status: 'skipped', publicUrl: `https://${cfg.Bucket}.${cfg.Region}.aliyuncs.com/${x.ossKey.split('/').map(encodeURIComponent).join('/')}` });
          continue;
        }
      }
      const buf = fs.readFileSync(x.local);
      const t0 = Date.now();
      const put = await withRetry(() => ossRequest(cfg, 'PUT', x.ossKey, buf, {
        'Content-Type': 'video/mp4',
        // 2022-10 后新桶走默认域名访问视频会被 OSS 默认强制下载(attachment)；显式 inline 覆盖为在线播放
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=86400'
      }));
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (put.status === 200) {
        uploaded++;
        const publicUrl = `https://${cfg.Bucket}.${cfg.Region}.aliyuncs.com/${x.ossKey.split('/').map(encodeURIComponent).join('/')}`;
        const speed = (buf.length / 1048576 / Math.max(0.1, secs) * 8).toFixed(1); // Mbps
        console.log(`已上传 ${fmtMB(buf.length)}MB ${secs}s ~${speed}Mbps  ${x.name}`);
        manifest.push({ name: x.name, ossKey: x.ossKey, sizeBytes: x.size, kind: x.kind, status: 'uploaded', publicUrl });
      } else {
        failed++; failures.push({ f: x.ossKey, status: put.status, msg: put.body.toString('utf8').slice(0, 200) });
      }
    } catch (e) { failed++; failures.push({ f: x.ossKey, status: 'ERR', msg: e.message }); }
  }
  // manifest 合并已有（续传保留历史记录）
  const maniPath = path.join(ROOT, 'data', 'video-manifest.json');
  let old = { items: [] };
  try { old = JSON.parse(fs.readFileSync(maniPath, 'utf8')); } catch {}
  const byKey = new Map();
  for (const it of old.items || []) byKey.set(it.ossKey, it);
  for (const it of manifest) byKey.set(it.ossKey, it);
  const out = {
    bucket: cfg.Bucket, region: cfg.Region, prefix: PREFIX,
    updatedAt: new Date().toISOString(),
    counts: { uploaded, skipped, failed, pendingBig: pending.length },
    items: [...byKey.values()].sort((a, b) => a.ossKey.localeCompare(b.ossKey, 'zh'))
  };
  fs.writeFileSync(maniPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n本轮：上传 ${uploaded}，跳过 ${skipped}，失败 ${failed}；待压缩大视频 ${pending.length}。清单 data/video-manifest.json（累计 ${out.items.length}）`);
  if (failures.length) { console.error('失败明细：', JSON.stringify(failures, null, 2)); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
