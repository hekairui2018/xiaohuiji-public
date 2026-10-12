'use strict';
const path = require('path');
const mod = require(path.join(__dirname, '..', 'feishu-bitable.cjs'));
const DOMAIN = 'https://open.feishu.cn';
async function api(token, method, p, body) {
  const opt = { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(DOMAIN + p, opt);
  return r.json();
}
function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map((x) => (x && x.text) || (x && x.name) || '').join('');
  return v.text || v.name || '';
}
(async () => {
  const c = mod.CFG, token = await mod.getTenantToken();
  const tb = `/open-apis/bitable/v1/apps/${c.appToken}/tables/${c.tableId}`;
  // 现有视图
  let vj = await api(token, 'GET', tb + '/views?page_size=50');
  let views = (vj.data && vj.data.items) || [];
  console.log('现有视图:', views.map((v) => v.view_name).join(', '));
  if (!views.some((v) => v.view_name === '现场台账')) {
    const cr = await api(token, 'POST', tb + '/views', { view_name: '现场台账', view_type: 'grid' });
    console.log('创建现场台账视图 code=', cr.code, cr.msg || '', cr.data && cr.data.view && cr.data.view.view_id);
  } else { console.log('现场台账视图已存在'); }
  // 核对记录
  const rj = await api(token, 'POST', tb + '/records/search?page_size=20', {});
  const items = (rj.data && rj.data.items) || [];
  console.log('--- 表内记录 ' + items.length + ' 条 ---');
  for (const it of items) {
    const f = it.fields;
    console.log(JSON.stringify({
      key: txt(f['机器-日期']), 日期: txt(f['日期']), 型号: txt(f['产品型号']), 芯片: txt(f['驱动芯片']),
      类型: txt(f['上报类型']), 字节: txt(f['字节数']), 附件: Array.isArray(f['日志附件']) ? f['日志附件'].length : 0
    }));
  }
  process.exit(0);
})().catch((e) => { console.error('异常:', e); process.exit(1); });
