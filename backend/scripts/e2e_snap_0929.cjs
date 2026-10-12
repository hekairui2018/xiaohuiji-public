// 端到端：发送端新增 4 个设备字段 -> 本机后端 -> 飞书现场台账列；断言后自动清理。
const fs = require('fs');
const path = require('path');

(async () => {
  // 0) 载入 backend/.env 到 process.env（不打印密钥）
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const KEY = process.env.HUIDU_UPLOAD_KEY;
  const APP = process.env.FEISHU_APP_TOKEN;
  const TABLE = process.env.FEISHU_TABLE_ID;
  const fb = require('../feishu-bitable.cjs');

  const mid = 'SELFTEST-SNAP-0929';
  const date = '2026-09-29';
  const body = {
    machine_id: mid, app_version: 'V2.1.2', reason: 'manual', log_date: date,
    client_ts: '2026-09-29T18:00:00+08:00',
    content: '【自测】发送端设备快照端到端，断言后自动删除，无需处理。',
    product_models: 'A6L-23-A04A4',
    chips: '3364S;ICN2038',
    version_info: '主控 A系列 A6L FPGA 43.19.70；接收卡R712 25.16.30.41→25.16.65.41 ×2；接收卡R720 25.12.30.40→25.12.65.40 ×1',
    site_env: '接收卡R712×2；接收卡R720×1；网口 2'
  };

  // 1) POST 本机后端
  const resp = await fetch('http://127.0.0.1:3789/api/huidu/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Upload-Key': KEY },
    body: JSON.stringify(body)
  });
  const rj = await resp.json();
  console.log('POST ->', resp.status, JSON.stringify(rj));
  if (!rj.ok) throw new Error('POST failed');

  // 2) 轮询飞书记录（后端异步写）
  const token = await fb.getTenantToken();
  const primary = mid + '@' + date;
  let rec = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const q = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ filter: { conjunction: 'and', conditions: [{ field_name: '机器-日期', operator: 'is', value: [primary] }] } })
    }).then(x => x.json()).catch(() => null);
    if (q && q.code === 0 && q.data && q.data.items && q.data.items.length) { rec = q.data.items[0]; break; }
  }
  if (!rec) throw new Error('飞书未找到自测记录');
  const f = rec.fields;
  const txt = v => Array.isArray(v) ? v.map(x => (x && x.text) || '').join('') : (v == null ? '' : String(v));
  const got = {
    产品型号: txt(f['产品型号']), 驱动芯片: txt(f['驱动芯片']), 版本信息: txt(f['版本信息']),
    现场环境: txt(f['现场环境']), 数据来源: txt(f['数据来源']), 置信度: txt(f['置信度']),
    场次: txt(f['场次']), 客户: txt(f['客户/联系方式'])
  };
  console.log('飞书落列：', JSON.stringify(got, null, 2));

  const assert = (name, cond) => { if (!cond) throw new Error('断言失败: ' + name); console.log('PASS', name); };
  assert('产品型号含 A6L', got.产品型号.includes('A6L'));
  assert('驱动芯片含 3364S', got.驱动芯片.includes('3364S'));
  assert('驱动芯片含 ICN2038', got.驱动芯片.includes('ICN2038'));
  assert('版本信息含 R712 从到', got.版本信息.includes('R712') && got.版本信息.includes('25.16.65.41'));
  assert('现场环境含网口2', got.现场环境.includes('网口 2'));
  assert('数据来源=助手自动采集', got.数据来源 === '助手自动采集');
  assert('置信度=high', got.置信度 === 'high');
  assert('手动列[场次]未被写', got.场次 === '');
  assert('手动列[客户]未被写', got.客户 === '');

  // 3) 删除飞书自测记录
  const del = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${rec.record_id}`, {
    method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
  }).then(x => x.json());
  console.log('删除飞书自测记录 code=', del.code);

  // 4) 清本地 jsonl 自测行（保留真实记录）
  const jf = path.join(__dirname, '..', '..', 'data', 'huidulogs', date + '.jsonl');
  if (fs.existsSync(jf)) {
    const lines = fs.readFileSync(jf, 'utf8').split(/\r?\n/).filter(l => l.trim());
    const keep = lines.filter(l => { try { return JSON.parse(l).machine_id !== mid; } catch { return true; } });
    fs.writeFileSync(jf, keep.join('\n') + (keep.length ? '\n' : ''));
    console.log('本地 jsonl 清理自测行：', lines.length, '->', keep.length);
  }
  console.log('SNAP_E2E_ALL_PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
