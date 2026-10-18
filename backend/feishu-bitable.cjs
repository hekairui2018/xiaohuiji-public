'use strict';
// ==================== HD升级助手日志 -> 飞书多维表格 同步模块 ====================
// 纯 Node 内置能力（Node 18+ 全局 fetch/FormData/Blob），零第三方依赖。
// 事实源：backend/.env 中的 FEISHU_* 配置（显式读取文件，不被系统同名环境变量污染）。
// 设计：
//  - 未配置 FEISHU_APP_SECRET 时 syncHuiduRecord 直接 skipped，不报错、不刷屏（上报主链路不受影响）。
//  - 多维表按「发送型号-日期」(devKey@log_date) 幂等 upsert；同一设备段码同一天只保留一条（老版本回退机器码）。
//  - 字段自愈：首次运行按 EXPECTED_FIELDS 补齐缺失列，已存在的列一律不动（不改类型/不删列）。
//  - 字段名/类型严格对齐正式表《HD升级助手运行日志》：日期/服务器接收时间为日期型(毫秒)，上报类型为单选。
//  - 日志一律以 TXT 承载（2026-10 起，不再按长度区分）：
//      1) 同一份 TXT 先落盘到后端 data/huidulogs/txt/（服务器本地永久留底，飞书不可用时也有原件）；
//      2) 再作为附件上传到多维表「日志附件」列；
//      3) 新记录不再写「日志全文」长文本列（保持为空）。历史记录不回填、不改写。
//  - 任何飞书/落盘错误都抛出，由调用方决定落 outbox / 记录日志；本模块不吞错（落盘失败也抛出，避免“飞书有、本地无”）。
const fs = require('fs');
const path = require('path');

const DOMAIN = 'https://open.feishu.cn';
// 主列可以被用户重命名，必须从字段 API 的 is_primary 读取，不能硬编码旧列名。
let primaryField = '';
let logDateField = '日期';
const TXT_DIR = path.join(__dirname, '..', 'data', 'huidulogs', 'txt'); // 服务器本地 TXT 留底目录
// 上报类型中文化：done→完成 batch→补传 manual→手动（显示层映射；写字符串，飞书单选自动新增中文选项）
const REASON_CN = { done: '完成', batch: '补传', manual: '手动' };
function reasonCn(r) { return REASON_CN[r] || r || ''; }

// 期望字段（主键除外），与正式表结构一致。type：1=多行文本 2=数字 3=单选 5=日期 17=附件 1001=创建时间(自动)
// 仅在全新表缺列时补建；正式表这些列均已存在，不会重复创建。
// 2026-10-10 起：删 SHA1/日志全文（迁移脚本删列）；新增 发送型号/FPGA版本/应用版本/接收卡型号/接收卡版本/HDSet版本/HDPlayer版本/上传次数。
const EXPECTED_FIELDS = [
  { name: 'APP版本', type: 1 },
  { name: '上报类型', type: 3, property: { options: [{ name: '完成' }, { name: '补传' }, { name: '手动' }] } },
  { name: '日期', type: 5, property: { date_formatter: 'yyyy-MM-dd', auto_fill: false } },
  { name: '客户端时间', type: 1 },
  { name: '服务器接收时间', type: 5, property: { date_formatter: 'yyyy-MM-dd HH:mm', auto_fill: false } },
  { name: '上传次数', type: 2, property: { formatter: '0' } },
  { name: '日志附件', type: 17 },
  { name: '入库时间', type: 1001, property: { date_formatter: 'yyyy-MM-dd HH:mm' } },
  // 现场台账自动列（拆分上报，老版本留空）
  { name: '发送型号', type: 1 },
  { name: 'FPGA版本', type: 1 },
  { name: '应用版本', type: 1 },
  { name: '驱动芯片', type: 1 },
  { name: '接收卡型号', type: 1 },
  { name: '接收卡版本', type: 1 },
  { name: 'HDSet版本', type: 1 },
  { name: 'HDPlayer版本', type: 1 }
];

function loadEnv() {
  const out = {};
  try {
    const ep = path.join(__dirname, '.env');
    if (fs.existsSync(ep)) {
      for (const line of fs.readFileSync(ep, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) { console.error('[feishu] .env', e.message); }
  return out;
}

const ENV = loadEnv();
const siteDisplayEnabled = ENV.FEISHU_SITE_DISPLAY === '1';
const SITE_DISPLAY_FIELDS = ['产品型号', '版本信息', '现场环境（软/固件版本、源端设备、线材）', '自动建议-产品型号', '自动建议-版本信息', '自动建议-现场环境', '自动建议-缺失或冲突', '结构化日志详情', '自动写入基线'].map(name => ({name, type: 1}));
const CFG = {
  appId: ENV.FEISHU_APP_ID || '',
  appSecret: ENV.FEISHU_APP_SECRET || '',
  appToken: ENV.FEISHU_APP_TOKEN || '',
  tableId: ENV.FEISHU_TABLE_ID || ''
};

function isConfigured() {
  return !!(CFG.appId && CFG.appSecret && CFG.appToken && CFG.tableId);
}

// yyyy-MM-dd -> 当天本地正午毫秒（服务器在中国 UTC+8），跨时区查看也不跨天
function dayStartMs(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).getTime();
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function hhmmss(d) { return pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()); }
// 文件名只保留安全字符，防路径穿越/非法文件名字符
function safeName(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_.-]/g, '_'); }

// 生成同一份 TXT 的文件名（本地留底与飞书附件同名，便于对照）：
// HD升级日志_2026-10-06_done_2d11faf0374a_092239.txt
function txtFileName(rec) {
  const mid = safeName(rec.machine_id || 'unknown');
  const reason = safeName(rec.reason || 'log');
  let d = new Date();
  const t1 = rec.client_ts ? new Date(rec.client_ts) : null;
  if (t1 && !Number.isNaN(t1.getTime())) d = t1;
  else {
    const t2 = rec.server_ts ? new Date(rec.server_ts) : null;
    if (t2 && !Number.isNaN(t2.getTime())) d = t2;
  }
  return 'HD升级日志_' + rec.log_date + '_' + reason + '_' + mid + '_' + hhmmss(d) + '.txt';
}

// 在服务器本地留一份 TXT（先于飞书上传）。失败直接抛出，由调用方落 outbox 重试，保证本地与飞书不缺边。
function saveLocalTxt(fileName, buf) {
  fs.mkdirSync(TXT_DIR, { recursive: true });
  const fp = path.join(TXT_DIR, fileName);
  fs.writeFileSync(fp, buf); // UTF-8 无 BOM；与上传附件同一 Buffer，字节数一致
  return fp;
}

// ---------------- token 缓存 ----------------
let tokenCache = { token: '', expAt: 0 };
async function getTenantToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expAt) return tokenCache.token;
  const resp = await fetch(DOMAIN + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: CFG.appId, app_secret: CFG.appSecret })
  });
  const j = await resp.json();
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error('tenant_token 失败 code=' + j.code + ' msg=' + j.msg);
  }
  const expire = typeof j.expire === 'number' ? j.expire : 7200;
  tokenCache = { token: j.tenant_access_token, expAt: now + (expire - 300) * 1000 };
  return tokenCache.token;
}

// ---------------- 统一请求封装 ----------------
async function api(method, urlPath, body, opts) {
  const token = await getTenantToken();
  const options = { method, headers: { Authorization: 'Bearer ' + token } };
  if (body !== undefined && !(opts && opts.isForm)) {
    options.headers['Content-Type'] = 'application/json; charset=utf-8';
    options.body = JSON.stringify(body);
  } else if (opts && opts.isForm) {
    options.body = body; // FormData，让 fetch 自动带 multipart boundary
  }
  const resp = await fetch(DOMAIN + urlPath, options);
  let j = null;
  try { j = await resp.json(); } catch (e) { throw new Error('飞书返回非 JSON status=' + resp.status); }
  if (j.code !== 0) {
    const err = new Error('飞书API ' + method + ' ' + urlPath + ' code=' + j.code + ' msg=' + j.msg);
    err.code = j.code;
    throw err;
  }
  return j.data || {};
}

// ---------------- 字段自愈 ----------------
let schemaReady = false;
let schemaLoading = null;
async function readTableFields() {
  const base = '/open-apis/bitable/v1/apps/' + CFG.appToken + '/tables/' + CFG.tableId + '/fields';
  const fields = [];
  let pageToken = '';
  do {
    const q = '?page_size=100' + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
    const data = await api('GET', base + q);
    fields.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : '';
  } while (pageToken);
  return fields;
}

async function ensureSchema(force = false) {
  if (schemaLoading) return schemaLoading;
  if (schemaReady && !force) return primaryField;
  schemaReady = false;
  schemaLoading = (async () => {
    const fields = await readTableFields();
    // An explicit stable field ID keeps log upserts independent from the display index.
    const primary = ENV.FEISHU_LOG_KEY_FIELD_ID ? fields.find(f=>f.field_id===ENV.FEISHU_LOG_KEY_FIELD_ID) : fields.find((f) => f.is_primary === true);
    if (!primary || !primary.field_name || primary.type !== 1) {
      throw new Error('飞书主列缺失或不是文本类型，停止同步；请核对现有表结构');
    }
    primaryField = primary.field_name;
    if(ENV.FEISHU_LOG_DATE_FIELD_ID){const date=fields.find(f=>f.field_id===ENV.FEISHU_LOG_DATE_FIELD_ID);if(!date||date.type!==5)throw new Error('独立日志日期字段缺失或类型错误，停止同步');logDateField=date.field_name;}
    const existing = new Set(fields.map((f) => f.field_name));
    const base = '/open-apis/bitable/v1/apps/' + CFG.appToken + '/tables/' + CFG.tableId + '/fields';

    for (const f of [...EXPECTED_FIELDS, ...(siteDisplayEnabled ? SITE_DISPLAY_FIELDS : [])]) {
      if (existing.has(f.name)) continue;
      const payload = { field_name: f.name, type: f.type };
      if (f.property) payload.property = f.property;
      await api('POST', base, payload);
      console.log('[feishu] 已补建字段：' + f.name);
    }
    schemaReady = true;
    return primaryField;
  })();
  try { return await schemaLoading; }
  finally { schemaLoading = null; }
}

function fieldNameMissing(err) { return Number(err && err.code) === 1254045; }

// ---------------- TXT 附件上传 ----------------
async function uploadTxt(fileName, buf) {
  const form = new FormData();
  form.append('file_name', fileName);
  form.append('parent_type', 'bitable_file');
  form.append('parent_node', CFG.appToken);
  form.append('size', String(buf.length));
  form.append('file', new Blob([buf], { type: 'text/plain;charset=utf-8' }), fileName);
  const data = await api('POST', '/open-apis/drive/v1/medias/upload_all', form, { isForm: true });
  if (!data.file_token) throw new Error('附件上传未返回 file_token');
  return data.file_token;
}

// 行键匹配：按 发送型号+日期 判行（主键列内容=最新上报时间(到分钟)+发送型号，随上报更新；内部判行不依赖主键文本）。
function clientTsMinute(cts) {
  if (!cts) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(cts));
  return m ? m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] : '';
}
function sendModel(rec) {
  const v = (rec.device_code || rec.product_models || '').trim();
  if (!v) return '';
  const segs = v.split(';').map((s) => s.trim()).filter(Boolean);
  // 老版本上报的是当天设备集合（分号拼接，如 C16H;C16H-26-02332）：取最后一段设备码，纯型号前缀不记
  return segs.length ? segs[segs.length - 1] : '';
}

// 同步卡 30 分钟窗口（ISO 分钟格式，与「客户端时间」列原样值同分隔符、字典序=时间序）
function isoMinuteOffset(tsMin, offsetMin) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(tsMin || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  d.setTime(d.getTime() + offsetMin * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---------------- 按行键查记录 ----------------
// 优先：发送型号 + 日期（异步卡/默认，稳定判行）；同步卡(device_class='sync')：发送型号 + 客户端时间 30 分钟窗口
//   （同步卡只有型号+序号无法唯一分辨，同一天间隔>30分钟的上报跨行，避免误合并不同场次）；
// 回退：主键文本（老格式 machine@date / 无型号记录）。
async function findRecordId(model, logDate, rec) {
  const base = '/open-apis/bitable/v1/apps/' + CFG.appToken + '/tables/' + CFG.tableId + '/records';
  // 同步卡：发送型号 + 客户端时间 ±30 分钟窗口
  if (rec && rec.device_class === 'sync' && model && rec.client_ts) {
    const tsMin = clientTsMinute(rec.client_ts);
    const winStart = isoMinuteOffset(tsMin, -30);
    const winEnd = isoMinuteOffset(tsMin, 30);
    if (tsMin && winStart && winEnd) {
      try {
        const d = await api('POST', base + '/search?page_size=10', {
          filter: {
            conjunction: 'and',
            conditions: [
              { field_name: '发送型号', operator: 'is', value: [model] },
              { field_name: '客户端时间', operator: 'isGreaterOrEqual', value: [winStart] },
              { field_name: '客户端时间', operator: 'isLessOrEqual', value: [winEnd] }
            ]
          }
        });
        const items = d.items || [];
        if (items.length) return items[0].record_id;
      } catch (e) { if (fieldNameMissing(e)) throw e; /* 查询不支持时走回退 */ }
    }
  }
  if (model && logDate) {
    const dayMs = dayStartMs(logDate);
    if (dayMs !== null) {
      try {
        const d = await api('POST', base + '/search?page_size=10', {
          filter: {
            conjunction: 'and',
            conditions: [
              { field_name: '发送型号', operator: 'is', value: [model] },
              { field_name: logDateField, operator: 'is', value: ['ExactDate', String(dayMs)] }
            ]
          }
        });
        const items = d.items || [];
        if (items.length) return items[0].record_id;
      } catch (e) { if (fieldNameMissing(e)) throw e; /* 查询不支持时走回退 */ }
    }
  }
  // 回退 1：主键文本精确匹配（老格式 machine@date / 型号@date / 时间+型号）
  const keyValCandidates = [];
  const devKey = rec && (rec.devKey || rec.machine_id);
  if (devKey && logDate) keyValCandidates.push(devKey + '@' + logDate);
  if (model && logDate) keyValCandidates.push([clientTsMinute(rec && rec.client_ts) || logDate, model].join(' '));
  if (model && logDate) keyValCandidates.push(model + '@' + logDate);
  for (const keyVal of keyValCandidates) {
    if (!keyVal) continue;
    try {
      const data = await api('POST', base + '/search?page_size=10', {
        filter: {
          conjunction: 'and',
          conditions: [{ field_name: primaryField, operator: 'is', value: [keyVal] }]
        }
      });
      const items = data.items || [];
      if (items.length) return items[0].record_id;
    } catch (e) { if (fieldNameMissing(e)) throw e; /* 继续下一个候选 */ }
  }
  // 回退 2：遍历全表按主键文本匹配
  let pageToken = '';
  do {
    const q = '?page_size=500' + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
    const data = await api('GET', base + q);
    for (const it of data.items || []) {
      const v = it.fields && it.fields[primaryField];
      const text = Array.isArray(v) ? v.map((x) => (x && x.text) || '').join('') : (v || '');
      for (const keyVal of keyValCandidates) {
        if (text === keyVal) return it.record_id;
      }
    }
    pageToken = data.has_more ? data.page_token : '';
  } while (pageToken);
  return '';
}

// ---------------- 组装字段值（对齐正式表字段类型）+ 产出 TXT ----------------
// 日志一律 TXT：先本地留底，再传附件；不写「日志全文」长文本列（该列已删除）。
// 主键列内容：时间(到分钟)+发送型号（如 2026-10-07 10:44 VP210C-0）；无型号回退 机器码@日期（老版本兜底）。
async function buildFields(rec) {
  const devKey = (rec.devKey || rec.machine_id || '');
  const model = sendModel(rec);
  const tsMin = clientTsMinute(rec.client_ts);
  const key = model ? ([tsMin || rec.log_date, model].filter(Boolean).join(' ')) : (devKey + '@' + rec.log_date);
  const content = String(rec.content || '') + (siteDisplayEnabled ? '\n\n[结构化上报原始字段，仅供日志详情核对]\n' + JSON.stringify(require('./log-display.cjs').recordDetails(rec), null, 2) : '');
  const buf = Buffer.from(content, 'utf8');
  const fileName = txtFileName(rec);

  const localPath = saveLocalTxt(fileName, buf);            // 1) 服务器本地留底（失败即抛）
  const fileToken = await uploadTxt(fileName, buf);          // 2) 上传为多维表附件

  const fields = {
    [primaryField]: key,
    '上报类型': reasonCn(rec.reason),          // 单选，写中文字符串（不存在的选项飞书会自动新增）
    '客户端时间': rec.client_ts || '',
    '上传次数': Number(rec.upload_count) || 1,
    '日志附件': [{ file_token: fileToken }] // 日志不再写全文，一律附件承载
  };
  // Only explicit nonempty fields update these columns; older records must not erase manual values.
  for (const [column, key] of [['驱动芯片', 'chips'], ['应用版本', 'device_app_version'], ['APP版本', 'app_version']]) {
    const value = typeof rec[key] === 'string' ? rec[key].trim() : '';
    if (value) fields[column] = value;
  }
  // 现场台账拆分列：老版本没有独立字段时回退旧汇总字段（发送型号←产品型号；接收卡两列留空）
  if (rec.device_code) fields['发送型号'] = rec.device_code;
  else if (rec.product_models) fields['发送型号'] = rec.product_models;
  if (rec.fpga_version) fields['FPGA版本'] = rec.fpga_version;
  if (rec.recv_models) fields['接收卡型号'] = rec.recv_models;
  if (rec.recv_versions) fields['接收卡版本'] = rec.recv_versions;
  if (rec.hdset_version) fields['HDSet版本'] = rec.hdset_version;
  if (rec.hdplayer_version) fields['HDPlayer版本'] = rec.hdplayer_version;
  const dayMs = dayStartMs(rec.log_date);
  if (dayMs !== null) { fields[logDateField] = dayMs;if(ENV.FEISHU_LOG_DATE_FIELD_ID)fields['日期']=String(rec.log_date); }
  if (rec.server_ts) {
    const t = new Date(rec.server_ts).getTime();
    if (!Number.isNaN(t)) fields['服务器接收时间'] = t;
  }
  return { fields, primaryField, localPath, fileName, fileToken, bytes: buf.length };
}

// ---------------- 主入口：同步一条落盘记录 ----------------
// rec: {machine_id, devKey, app_version, reason, log_date, content, sha1, client_ts, server_ts, size, upload_count, ...}
async function syncHuiduRecordNow(rec) {
  if (!isConfigured()) return { action: 'skipped', reason: 'feishu_not_configured' };
  if (!rec || (!rec.machine_id && !rec.devKey) || !rec.log_date) throw new Error('syncHuiduRecord 缺少 devKey/machine_id/log_date');
  await ensureSchema();
  const built = await buildFields(rec);
  let field = built.primaryField;
  const key = built.fields[field];
  const base = '/open-apis/bitable/v1/apps/' + CFG.appToken + '/tables/' + CFG.tableId + '/records';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const recordId = await findRecordId(sendModel(rec), rec.log_date, rec);
      if (siteDisplayEnabled) {
        const { buildDisplay, displayPatch, recordDetails } = require('./log-display.cjs');
        const display = buildDisplay({...rec, ...(rec.site_display_snapshot || {})});
        const current = recordId ? await api('GET', base + '/' + recordId) : null;
        Object.assign(built.fields, displayPatch(display, {existing: !!recordId,currentFields: current?.record?.fields || {}}));
        const detail = JSON.stringify(recordDetails(rec));
        built.fields['结构化日志详情'] = detail.length <= 16000 ? detail : JSON.stringify({machine_id: rec.machine_id, device_code: rec.device_code, note:'结构化明细较长，完整内容已保存在本条TXT附件和本地留底中，未截断原始证据'});
      }
      if (recordId) {
        await api('PUT', base + '/' + recordId, { fields: built.fields });
        return { action: 'updated', record_id: recordId, key, localPath: built.localPath, fileName: built.fileName, fileToken: built.fileToken };
      }
      const data = await api('POST', base, { fields: built.fields });
      return { action: 'created', record_id: data.record && data.record.record_id, key, localPath: built.localPath, fileName: built.fileName, fileToken: built.fileToken };
    } catch (e) {
      if (!fieldNameMissing(e) || attempt > 0) throw e;
      // 运行期间改列名：刷新一次实际结构，用同一个附件重新匹配/写入；不建新表、不改人工列。
      await ensureSchema(true);
      delete built.fields[field];
      field = primaryField;
      built.fields[field] = key;
    }
  }
}

let siteSyncQueue = Promise.resolve();
function syncHuiduRecord(rec) {
  if (!siteDisplayEnabled) return syncHuiduRecordNow(rec);
  const task = siteSyncQueue.then(() => syncHuiduRecordNow(rec));
  siteSyncQueue = task.catch(() => {});
  return task;
}

module.exports = { syncHuiduRecord, isConfigured, getTenantToken, ensureSchema, readTableFields, CFG };
