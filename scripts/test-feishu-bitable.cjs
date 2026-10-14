'use strict';
// 飞书故障回归：执行实际模块，隔离配置/文件系统/网络，绝不写真实表或日志。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../backend/feishu-bitable.cjs'), 'utf8');
const names = ['APP版本', '上报类型', '日期', '客户端时间', '服务器接收时间',
  '上传次数', '日志附件', '入库时间', '发送型号', 'FPGA版本', '应用版本',
  '接收卡型号', '接收卡版本', 'HDSet版本', 'HDPlayer版本', '驱动芯片'];
const rec = { machine_id: 'test-machine', devKey: 'A3L-00-test', device_code: 'A3L-00-test',
  device_class: 'async', log_date: '2026-10-12', app_version: 'test-build', reason: 'done',
  content: 'test log', client_ts: '2026-10-12T10:30:00+08:00',
  server_ts: '2026-10-12T02:30:01Z', upload_count: 3 };

function fixture(options = {}) {
  const state = { primary: options.primary || '日期-时间', fieldsReads: 0, uploads: 0,
    mutations: [], searches: [], fieldCreates: [], files: [], rows: options.rows || [] };
  const ok = (data) => ({ json: async () => ({ code: 0, data }) });
  const fail = (code) => ({ json: async () => ({ code, msg: code === 1254045 ? 'FieldNameNotFound' : 'denied' }) });
  const context = {
    module: { exports: {} }, __dirname: path.resolve(__dirname, '../backend'),
    Buffer, FormData, Blob, console,
    require: (name) => name === 'fs' ? {
      existsSync: () => true,
      readFileSync: () => 'FEISHU_APP_ID=test\nFEISHU_APP_SECRET=test\nFEISHU_APP_TOKEN=test\nFEISHU_TABLE_ID=test',
      mkdirSync: () => {}, writeFileSync: (fp, buf) => state.files.push({ fp, text: buf.toString() })
    } : require(name),
    fetch: async (url, init = {}) => {
      const method = init.method || 'GET';
      if (url.includes('/tenant_access_token/')) {
        return { json: async () => ({ code: 0, tenant_access_token: 'mock', expire: 7200 }) };
      }
      if (url.includes('/fields?')) {
        state.fieldsReads++;
        const fields = names.filter(name=>!(options.missingFields||[]).includes(name)).map((field_name) => ({ field_name, type: 1, is_primary: false }));
        if (!options.noPrimary) fields.push({ field_name: state.primary, type: options.primaryType || 1, is_primary: true });
        if (options.paginate && !url.includes('page_token=')) return ok({ items: fields.slice(0, 5), has_more: true, page_token: 'next' });
        return ok({ items: options.paginate ? fields.slice(5) : fields, has_more: false });
      }
      if (url.endsWith('/fields')) {
        state.fieldCreates.push(JSON.parse(init.body));
        return ok({});
      }
      if (url.includes('/medias/upload_all')) { state.uploads++; return ok({ file_token: 'attachment' }); }
      if (url.includes('/records/search')) {
        const body = JSON.parse(init.body);
        state.searches.push(body);
        if (options.renameOnSearch && !state.renamed) { state.primary = '再次改名'; state.renamed = true; return fail(1254045); }
        if (options.searchUnsupported) return fail(1254001);
        if (body.filter.conditions.some((c) => !names.includes(c.field_name) && c.field_name !== state.primary)) return fail(1254045);
        const rows = state.rows.filter((r) => body.filter.conditions.every((c) => {
          const v = r.fields[c.field_name];
          const text = Array.isArray(v) ? v.map((x) => x.text || '').join('') : v;
          return text === c.value[0];
        }));
        return ok({ items: rows });
      }
      if (method === 'GET' && url.includes('/records?')) return ok({ items: state.rows, has_more: false });
      if (url.includes('/records') && ['POST', 'PUT'].includes(method)) {
        const body = JSON.parse(init.body);
        state.mutations.push({ method, body });
        if (options.renameOnWrite && !state.renamed) { state.primary = '再次改名'; state.renamed = true; }
        if (options.writeError) return fail(options.writeError);
        if (Object.keys(body.fields).some((name) => !names.includes(name) && name !== state.primary)) return fail(1254045);
        if (method === 'PUT') {
          const row = state.rows.find((r) => url.endsWith('/' + r.record_id));
          Object.assign(row.fields, body.fields);
          return ok({ record: row });
        }
        const row = { record_id: 'new-' + state.rows.length, fields: body.fields };
        state.rows.push(row);
        return ok({ record: row });
      }
      throw new Error('Unexpected mock request: ' + method + ' ' + url);
    }
  };
  vm.runInNewContext(source, context, { filename: 'feishu-bitable.cjs' });
  return { fb: context.module.exports, state };
}

test('主列重命名为日期-时间后可创建；不重建列、不写人工内容', async () => {
  const { fb, state } = fixture();
  assert.equal((await fb.syncHuiduRecord(rec)).action, 'created');
  assert.equal(state.rows[0].fields['日期-时间'], '2026-10-12 10:30 A3L-00-test');
  assert.equal(state.rows[0].fields['机器-日期'], undefined);
  assert.equal(state.rows[0].fields['上传次数'], 3);
  assert.equal(state.rows[0].fields['日志附件'][0].file_token, 'attachment');
  assert.equal(state.files[0].text, rec.content);
  assert.equal(state.fieldCreates.length, 0);
});

test('旧名仍兼容；重复同步更新原行并保留人工列', async () => {
  const { fb, state } = fixture({ primary: '机器-日期' });
  await fb.syncHuiduRecord(rec);
  Object.assign(state.rows[0].fields, { '客户/联系方式': '人工客户', '备注': '保留', '问题状态': '已关闭' });
  const result = await fb.syncHuiduRecord({ ...rec, content: 'latest' });
  assert.equal(result.action, 'updated');
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].fields['备注'], '保留');
  assert.equal(state.rows[0].fields['问题状态'], '已关闭');
  assert.equal(state.rows[0].fields['客户/联系方式'], '人工客户');
  assert.equal(state.fieldsReads, 1);
  assert.equal(state.mutations[1].body.fields['备注'], undefined);
});

for (const phase of ['renameOnWrite', 'renameOnSearch']) {
  test(phase + ': 中途改名刷新并重试，复用附件', async () => {
    const { fb, state } = fixture({ [phase]: true });
    assert.equal((await fb.syncHuiduRecord(rec)).action, 'created');
    assert.equal(state.fieldsReads, 2);
    assert.equal(state.uploads, 1);
    assert.equal(state.rows[0].fields['再次改名'], '2026-10-12 10:30 A3L-00-test');
    assert.equal(state.rows[0].fields['日期-时间'], undefined);
    assert.equal(state.fieldCreates.length, 0);
  });
}

test('启动缓存后改名，下一轮仍能更新原行', async () => {
  const { fb, state } = fixture();
  await fb.syncHuiduRecord(rec);
  const f = state.rows[0].fields;
  f['任意新名称'] = f['日期-时间']; delete f['日期-时间'];
  state.primary = '任意新名称';
  assert.equal((await fb.syncHuiduRecord(rec)).action, 'updated');
  assert.equal(state.rows.length, 1);
  assert.equal(state.fieldsReads, 2);
});

test('持续字段错误最多重试一次；其他错误直接抛给 outbox 调用方', async () => {
  for (const code of [1254045, 99991672]) {
    const { fb, state } = fixture({ writeError: code });
    await assert.rejects(fb.syncHuiduRecord(rec), (e) => e.code === code);
    assert.equal(state.mutations.length, code === 1254045 ? 2 : 1);
    assert.equal(state.uploads, 1);
  }
});

test('无设备字段的旧机器日期主键不产生重复行', async () => {
  const legacy = { ...rec, device_code: '', devKey: '', machine_id: 'old-machine' };
  const row = { record_id: 'old', fields: { '日期-时间': [{ text: 'old-machine@2026-10-12' }], '备注': '人工备注' } };
  const { fb, state } = fixture({ rows: [row] });
  assert.equal((await fb.syncHuiduRecord(legacy)).record_id, 'old');
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].fields['备注'], '人工备注');
});

test('搜索不支持时用实际主列全表回退匹配，保留人工备注', async () => {
  const row = { record_id: 'existing', fields: {
    '日期-时间': [{ text: '2026-10-12 10:30 A3L-00-test' }], '备注': '人工备注'
  } };
  const { fb, state } = fixture({ rows: [row], searchUnsupported: true });
  assert.equal((await fb.syncHuiduRecord(rec)).record_id, 'existing');
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].fields['备注'], '人工备注');
});

test('分页返回主列可识别；只读字段核验不触发任何写入', async () => {
  const { fb, state } = fixture({ paginate: true });
  const fields = await fb.readTableFields();
  assert.equal(fields.find((f) => f.is_primary).field_name, '日期-时间');
  assert.equal(state.fieldsReads, 2);
  assert.equal(state.uploads + state.mutations.length + state.fieldCreates.length + state.files.length, 0);
});

test('主列缺失或类型不兼容时停止；不猜列、不建列、不上传', async () => {
  for (const options of [{ noPrimary: true }, { primaryType: 5 }]) {
    const { fb, state } = fixture(options);
    await assert.rejects(fb.syncHuiduRecord(rec), /主列缺失或不是文本类型/);
    assert.equal(state.uploads + state.mutations.length + state.fieldCreates.length, 0);
  }
});

test('并发首次同步只读取一次字段结构，避免重复补建', async () => {
  const { fb, state } = fixture();
  const results = await Promise.all([fb.ensureSchema(), fb.ensureSchema(), fb.ensureSchema()]);
  assert.deepEqual(results, ['日期-时间', '日期-时间', '日期-时间']);
  assert.equal(state.fieldsReads, 1);
  assert.equal(state.fieldCreates.length, 0);
});

test('驱动芯片与各类版本分别使用真实独立字段，不从汇总或日志猜测', async () => {
  const { fb,state }=fixture();
  await fb.syncHuiduRecord({...rec,chips:'  ICND2153  ',app_version:'2.1.3+20261014-093000',device_app_version:'APP-DEVICE-1',fpga_version:'FPGA-2',hdset_version:'HDSet-3',hdplayer_version:'HDPlayer-4',version_info:'不得使用此汇总'});
  const fields=state.rows[0].fields;
  assert.equal(fields['驱动芯片'],'ICND2153');assert.equal(fields['应用版本'],'APP-DEVICE-1');assert.equal(fields['APP版本'],'2.1.3+20261014-093000');
  assert.equal(fields['FPGA版本'],'FPGA-2');assert.equal(fields['HDSet版本'],'HDSet-3');assert.equal(fields['HDPlayer版本'],'HDPlayer-4');
});

test('缺失或仅空白的芯片及应用/APP版本不清空同一行已有人工值', async () => {
  const { fb,state }=fixture();await fb.syncHuiduRecord(rec);
  Object.assign(state.rows[0].fields,{'驱动芯片':'人工芯片','应用版本':'人工设备版本','APP版本':'已有助手版本'});
  for(const empty of [undefined,'','   ']){
    assert.equal((await fb.syncHuiduRecord({...rec,chips:empty,device_app_version:empty,app_version:empty})).action,'updated');
    const fields=state.mutations.at(-1).body.fields;
    for(const name of ['驱动芯片','应用版本','APP版本'])assert.equal(Object.hasOwn(fields,name),false);
    assert.equal(state.rows.length,1);assert.equal(state.rows[0].fields['驱动芯片'],'人工芯片');assert.equal(state.rows[0].fields['应用版本'],'人工设备版本');assert.equal(state.rows[0].fields['APP版本'],'已有助手版本');
  }
});

test('旧记录无真实芯片/设备应用字段时不从FPGA/软件/正文回填，缺芯片列仅补文本列', async () => {
  const {fb,state}=fixture({missingFields:['驱动芯片']});
  await fb.syncHuiduRecord({...rec,fpga_version:'FPGA-only',hdset_version:'HDSet-only',hdplayer_version:'HDPlayer-only',version_info:'APP guessing forbidden',content:'芯片FM6363 应用V1.0，仅正文不作字段'});
  assert.equal(state.rows[0].fields['驱动芯片'],undefined);assert.equal(state.rows[0].fields['应用版本'],undefined);
  assert.deepEqual(state.fieldCreates,[{field_name:'驱动芯片',type:1}]);
});
