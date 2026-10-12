'use strict';
// 一次性迁移：把「日志日期」列改名为「日期」，再由 feishu-bitable.ensureSchema 补齐现场台账列。
const path = require('path');
const mod = require(path.join(__dirname, '..', 'feishu-bitable.cjs'));

const DOMAIN = 'https://open.feishu.cn';
async function api(token, method, urlPath, body) {
  const opt = { method, headers: { Authorization: 'Bearer ' + token } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json; charset=utf-8'; opt.body = JSON.stringify(body); }
  const resp = await fetch(DOMAIN + urlPath, opt);
  const j = await resp.json();
  if (j.code !== 0) throw new Error(method + ' ' + urlPath + ' code=' + j.code + ' msg=' + j.msg);
  return j.data || {};
}

(async () => {
  if (!mod.isConfigured()) { console.error('未配置 FEISHU_*，退出'); process.exit(1); }
  const c = mod.CFG;
  const token = await mod.getTenantToken();
  const base = `/open-apis/bitable/v1/apps/${c.appToken}/tables/${c.tableId}/fields`;

  // 1) 列出字段，找「日志日期」改名「日期」
  let items = [];
  let pt = '';
  do {
    const d = await api(token, 'GET', base + '?page_size=100' + (pt ? '&page_token=' + pt : ''));
    items = items.concat(d.items || []);
    pt = d.has_more ? d.page_token : '';
  } while (pt);
  const day = items.find((f) => f.field_name === '日志日期');
  const already = items.find((f) => f.field_name === mod.DAY_FIELD);
  if (day && !already) {
    await api(token, 'PUT', base + '/' + day.field_id, {
      field_name: mod.DAY_FIELD, type: 5,
      property: { date_formatter: 'yyyy-MM-dd', auto_fill: false }
    });
    console.log('已改名：日志日期 -> ' + mod.DAY_FIELD + ' (' + day.field_id + ')');
  } else {
    console.log('无需改名（日志日期存在=' + !!day + '，日期已存在=' + !!already + '）');
  }

  // 2) 补齐缺失列
  await mod.ensureSchema();

  // 3) dump 最终结构
  const d2 = await api(token, 'GET', base + '?page_size=100');
  console.log('--- 最终字段（' + (d2.items || []).length + '）---');
  (d2.items || []).forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. [t${f.type}] ${f.field_name}  (${f.field_id})`));
  process.exit(0);
})().catch((e) => { console.error('迁移失败：', e.message); process.exit(1); });
