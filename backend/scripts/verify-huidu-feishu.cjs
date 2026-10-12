'use strict';
// 只读核验实际主列与日志记录；不补建字段、不上传附件、不更新记录。
const fb = require('../feishu-bitable.cjs');
function txt(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x && (x.text || x.name)) || '').join('');
  return typeof v === 'object' ? (v.text || v.name || '') : String(v);
}
async function main() {
  if (!fb.isConfigured()) throw new Error('飞书未配置');
  const fields = await fb.readTableFields();
  const primary = fields.find((f) => f.is_primary === true);
  if (!primary) throw new Error('未找到实际主列');
  console.log('实际主列：' + primary.field_name + ' type=' + primary.type);
  const token = await fb.getTenantToken();
  let pageToken = '', total = 0;
  do {
    const url = 'https://open.feishu.cn/open-apis/bitable/v1/apps/' + fb.CFG.appToken +
      '/tables/' + fb.CFG.tableId + '/records?page_size=500' +
      (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
    const resp = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000)
    });
    const j = await resp.json();
    if (j.code !== 0) throw new Error('查询失败 code=' + j.code + ' msg=' + j.msg);
    for (const item of j.data.items || []) {
      const f = item.fields || {};
      const attachments = Array.isArray(f['日志附件']) ? f['日志附件'] : [];
      console.log(JSON.stringify({
        record_id: item.record_id, key: txt(f[primary.field_name]),
        device: txt(f['发送型号']), app_version: txt(f['APP版本']),
        date: f['日期'], upload_count: f['上传次数'],
        attachments: attachments.map((a) => ({ name: a.name, size: a.size }))
      }));
      total++;
    }
    pageToken = j.data.has_more ? j.data.page_token : '';
  } while (pageToken);
  console.log('总记录数：' + total);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
