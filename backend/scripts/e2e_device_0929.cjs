'use strict';
// 端到端自测：现场设备信息列（产品型号/驱动芯片/版本信息/现场环境/数据来源/置信度）
// 流程：新建(带设备) -> 同正文仅改芯片且省略其它设备字段(验 devChanged 触发更新 + 缺字段保留) -> 断言 -> 清理
const fs = require('fs');
const path = require('path');
const mod = require(path.join(__dirname, '..', 'feishu-bitable.cjs'));
const DOMAIN = 'https://open.feishu.cn';

function env() {
  const o = {};
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
}
const E = env();
const BASE = 'http://127.0.0.1:3789/api/huidu/log';
const MID = 'SELFTEST-DEVICE-0929';
const DATE = '2026-09-29';
const KEY = MID + '@' + DATE;
const CONTENT = 'SELFTEST-E2E-DEVICE 现场设备信息列联调日志正文。';

async function post(body) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Upload-Key': E.HUIDU_UPLOAD_KEY },
    body: JSON.stringify(body)
  });
  return { status: r.status, json: await r.json() };
}
async function api(token, method, p, body) {
  const opt = { method, headers: { Authorization: 'Bearer ' + token } };
  if (body) { opt.headers['Content-Type'] = 'application/json; charset=utf-8'; opt.body = JSON.stringify(body); }
  const r = await fetch(DOMAIN + p, opt);
  return r.json();
}
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map((x) => (x && x.text) || (x && x.name) || '').join('');
  if (v.text) return v.text;
  if (v.name) return v.name;
  return String(v);
}
async function findRecord(token) {
  const c = mod.CFG;
  const j = await api(token, 'POST',
    `/open-apis/bitable/v1/apps/${c.appToken}/tables/${c.tableId}/records/search?page_size=5`,
    { filter: { conjunction: 'and', conditions: [{ field_name: '机器-日期', operator: 'is', value: [KEY] }] } });
  const items = (j.data && j.data.items) || [];
  return items[0] || null;
}
(async () => {
  const token = await mod.getTenantToken();
  const fails = [];
  const assert = (name, cond, got) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  got=' + JSON.stringify(got))); if (!cond) fails.push(name); };

  // 第一次：完整设备字段
  const r1 = await post({
    machine_id: MID, app_version: 'V2.1.2-selftest', reason: 'done', log_date: DATE,
    client_ts: '2026-09-29 18:00:00', content: CONTENT,
    product_models: 'C16L;A6L', chips: '3364S;ICN2038',
    version_info: '主控 主7.4/OTA-/FPGA-/MCU-/TV-；接收卡 R712 v30→v65',
    site_env: '接收卡 R712×20；网口 2；SN SELFTEST-SN-001'
  });
  console.log('第一次上报:', r1.status, r1.json);
  await new Promise((s) => setTimeout(s, 2500));
  let rec = await findRecord(token);
  assert('首次已建行', !!rec, rec);
  if (rec) {
    const f = rec.fields;
    assert('产品型号', cellText(f['产品型号']) === 'C16L;A6L', cellText(f['产品型号']));
    assert('驱动芯片', cellText(f['驱动芯片']) === '3364S;ICN2038', cellText(f['驱动芯片']));
    assert('版本信息含R712', cellText(f['版本信息']).includes('R712 v30→v65'), cellText(f['版本信息']));
    assert('现场环境含卡数', cellText(f['现场环境']).includes('R712×20'), cellText(f['现场环境']));
    assert('数据来源', cellText(f['数据来源']) === '助手自动采集', cellText(f['数据来源']));
    assert('置信度', cellText(f['置信度']) === 'high', cellText(f['置信度']));
    assert('日期为毫秒时间戳', typeof f['日期'] === 'number' && f['日期'] > 0, f['日期']);
    assert('手动列留空(调试经过)', cellText(f['调试经过/故障现象及现场操作']) === '', cellText(f['调试经过/故障现象及现场操作']));
  }

  // 第二次：正文完全相同(sha1同)，仅改 chips=712，且省略其它设备字段
  const r2 = await post({
    machine_id: MID, app_version: 'V2.1.2-selftest', reason: 'done', log_date: DATE,
    client_ts: '2026-09-29 18:05:00', content: CONTENT, chips: '712'
  });
  console.log('第二次(仅改芯片)上报:', r2.status, r2.json);
  assert('设备变化触发更新(dedup=false)', r2.json.dedup === false, r2.json);
  await new Promise((s) => setTimeout(s, 2500));
  rec = await findRecord(token);
  if (rec) {
    const f = rec.fields;
    assert('芯片已更新为712', cellText(f['驱动芯片']) === '712', cellText(f['驱动芯片']));
    assert('省略的产品型号被保留', cellText(f['产品型号']) === 'C16L;A6L', cellText(f['产品型号']));
    assert('省略的版本信息被保留', cellText(f['版本信息']).includes('R712'), cellText(f['版本信息']));
    assert('省略的现场环境被保留', cellText(f['现场环境']).includes('R712×20'), cellText(f['现场环境']));
  }

  // 第三次：完全相同重发，应 dedup=true
  const r3 = await post({
    machine_id: MID, app_version: 'V2.1.2-selftest', reason: 'done', log_date: DATE,
    client_ts: '2026-09-29 18:05:00', content: CONTENT, chips: '712'
  });
  console.log('第三次(完全相同)上报:', r3.status, r3.json);
  assert('完全相同判重(dedup=true)', r3.json.dedup === true, r3.json);

  // 清理：删飞书自测记录 + 清本地 jsonl 自测行
  if (rec) {
    const c = mod.CFG;
    const d = await api(token, 'DELETE', `/open-apis/bitable/v1/apps/${c.appToken}/tables/${c.tableId}/records/${rec.record_id}`);
    console.log('删除飞书自测记录 code=', d.code);
  }
  const jf = path.join(__dirname, '..', '..', 'data', 'huidulogs', DATE + '.jsonl');
  if (fs.existsSync(jf)) {
    const kept = fs.readFileSync(jf, 'utf8').split(/\r?\n/).filter((l) => l.trim() && JSON.parse(l).machine_id !== MID);
    fs.writeFileSync(jf, kept.map((l) => l).join('\n') + (kept.length ? '\n' : ''), 'utf8');
    console.log('本地 jsonl 已清自测行，保留', kept.length, '条真实记录');
  }
  console.log(fails.length === 0 ? 'ALL_PASS' : ('FAILED=' + fails.length + ' ' + fails.join(',')));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('E2E 异常:', e); process.exit(1); });
