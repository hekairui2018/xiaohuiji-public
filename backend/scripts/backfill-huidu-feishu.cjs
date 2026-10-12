'use strict';
// 历史日志补录 / outbox 重放到飞书多维表。
// 用法：
//   node scripts/backfill-huidu-feishu.cjs            # 补录 data/huidulogs 下所有日期
//   node scripts/backfill-huidu-feishu.cjs --date=2026-09-28
//   node scripts/backfill-huidu-feishu.cjs --outbox   # 只重放 feishu_outbox.jsonl
// 主列名由字段 API 读取；按既有设备/日期等规则 upsert。补录使用服务器最新日文件，勿把重复失败尝试当独立记录。
const fs = require('fs');
const path = require('path');
const fb = require('../feishu-bitable.cjs');

const LOG_DIR = path.join(__dirname, '..', '..', 'data', 'huidulogs');

function parseArgs() {
  const o = { date: '', outboxOnly: false };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--date=')) o.date = a.slice('--date='.length);
    if (a === '--outbox') o.outboxOnly = true;
  }
  return o;
}

function readJsonl(fp) {
  if (!fs.existsSync(fp)) return [];
  const out = [];
  for (const line of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { console.error('  跳过坏行:', e.message); }
  }
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  if (!fb.isConfigured()) {
    console.error('飞书未配置：请先在 backend/.env 填好 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_APP_TOKEN / FEISHU_TABLE_ID');
    process.exit(2);
  }
  const args = parseArgs();
  const jobs = [];

  if (args.outboxOnly) {
    for (const rec of readJsonl(path.join(LOG_DIR, 'feishu_outbox.jsonl'))) jobs.push(rec);
  } else {
    let files = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR) : [];
    files = files.filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
    if (args.date) files = files.filter((f) => f === args.date + '.jsonl');
    files.sort();
    for (const f of files) {
      for (const rec of readJsonl(path.join(LOG_DIR, f))) jobs.push(rec);
    }
  }

  console.log('待同步记录数：', jobs.length);
  let created = 0, updated = 0, failed = 0;
  for (const rec of jobs) {
    const key = (rec.machine_id || '?') + '@' + (rec.log_date || '?');
    try {
      const r = await fb.syncHuiduRecord(rec);
      if (r.action === 'created') created++; else if (r.action === 'updated') updated++;
      console.log('  [' + r.action + '] ' + key + ' reason=' + (rec.reason || '') + ' size=' + (rec.size || ''));
    } catch (e) {
      failed++;
      console.error('  [FAIL] ' + key + ' : ' + e.message);
    }
    await sleep(150); // 温和限速，避免 tenant token 频控
  }
  console.log('完成：created=' + created + ' updated=' + updated + ' failed=' + failed);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
