'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFeishuTaskWriter}=require('../external-services/feishu-task-writer.cjs');
function fixture({cleanLeader=false}={}){
 const rows=new Map(),requests=[],cfg={FEISHU_TASK_SYNC_ENABLED:'1',FEISHU_APP_TOKEN:'synthetic-leader',FEISHU_TABLE_ID:'leader',FEISHU_FAILURE_APP_TOKEN:'synthetic-private',FEISHU_FAILURE_TABLE_ID:'failure'};
 let lost=false,privateAccess=true;
 const ok=data=>({ok:true,json:async()=>({code:0,data})});
 const fetchImpl=async(url,init)=>{
  requests.push({url,method:init.method,body:init.body});
  if(url.includes('/permissions/'))return ok({permission_public:{link_share_entity:privateAccess?'closed':'tenant_readable',external_access:false}});
  if(url.includes('/fields?'))return ok({items:[{field_name:'任务编号',is_primary:true,type:1},...['产品型号','版本信息','现场环境（软/固件版本、源端设备、线材）','非人工暂停记录','自动写入基线','自动建议-产品型号','自动建议-版本信息','自动建议-现场环境','自动建议-缺失或冲突','备注','人工备注','验收人工备注','运行ID','机器码','异常记录','运行日志','日志附件','设备信息','异常次数','服务器接收时间'].filter(n=>!cleanLeader||(!n.startsWith('自动建议-')&&n!=='自动写入基线')).map(field_name=>({field_name,type:1}))]});
  if(url.includes('/upload_all')){assert.ok(init.body instanceof FormData);return ok({file_token:'synthetic-log'});}
  const kind=url.includes('/tables/leader/')?'success':'failure';
  if(url.includes('/records/search'))return ok({items:rows.has(kind)?[rows.get(kind)]:[]});
  if(init.method==='POST'&&url.includes('/records?')){
   assert.match(new URL(url).searchParams.get('client_token'),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
   assert.equal(rows.has(kind),false,'never create a second row for an ambiguous prior write');
   rows.set(kind,{record_id:'record-'+kind,fields:JSON.parse(init.body).fields});if(lost){lost=false;throw Error('response-lost');}return ok({record:rows.get(kind)});
  }
  if(init.method==='PUT'&&url.includes('/records/record-')){Object.assign(rows.get(kind).fields,JSON.parse(init.body).fields);return ok({record:rows.get(kind)});}
  throw Error('unexpected API operation '+init.method+' '+url);
 };
 const writer=createFeishuTaskWriter({cfg,getTenantToken:async()=>'synthetic',fetchImpl});
 const r={device_code:'VP1240A',upgrade_run_id:'receiver-run-1',log_date:'2026-10-19',sender_model:'VP1240A',content:'full original log',receiver_inventory:[{count:1,model_source:'not_collected'}],receiver_upgrades:[{run_id:'receiver-run-1',device_id:'VP1240A',port:7,card_id:'3',status:'succeeded',after_confirmed:true,after_version_source:'hdset_upgrade_readback',after_version:'25.26.65.30'}]};
 const state={key:'synthetic-task-key',task_run_id:'synthetic-task-run',machine_id:'synthetic-machine',success:r,latest:r,exceptions:[],received_at:'2026-10-19T01:00:00Z'};
 return {writer,state,rows,requests,loseNextResponse(){lost=true;},makePublic(){privateAccess=false;}};
}
test('Strict task writer never modifies schema or remarks; manual changes and clears remain protected',async()=>{
 const f=fixture();const receipt=await f.writer.sync('success',f.state,{});
 const fields=f.rows.get('success').fields;assert.equal(fields['非人工暂停记录'],'无');
 fields['人工备注']='customer hand edited';fields['备注']='historical note';fields['验收人工备注']='old acceptance';fields['产品型号']='manual model';fields['版本信息']='';
 await f.writer.sync('success',{...f.state,success:{...f.state.success,sender_model:'VP1640'}},receipt);
 assert.equal(fields['产品型号'],'manual model');assert.equal(fields['版本信息'],'');assert.equal(fields['人工备注'],'customer hand edited');assert.equal(fields['备注'],'historical note');assert.equal(fields['验收人工备注'],'old acceptance');
 assert.ok(f.requests.every(x=>!x.url.endsWith('/fields')&&!x.url.includes('/views/')&&!['DELETE','PATCH'].includes(x.method)));
});
test('Remote creation success with lost response is recovered by stable run identity',async()=>{
 const f=fixture();f.loseNextResponse();await assert.rejects(()=>f.writer.sync('success',f.state,{}),/response-lost/);
 const receipt=await f.writer.sync('success',f.state,{});assert.equal(receipt.record_id,'record-success');
 assert.equal(f.requests.filter(x=>x.method==='POST'&&x.url.includes('/records?')).length,1);
});
test('Exception logs use private independent target with full attachment; public configuration blocks writing',async()=>{
 const f=fixture();const state={...f.state,exceptions:[{event_id:'synthetic-event',node:'receiver-read',message:'failed'}],latest:{...f.state.latest,content:'原始日志'.repeat(10000)}};
 await f.writer.sync('failure',state,{});const fields=f.rows.get('failure').fields;
 assert.equal(fields['异常次数'],1);assert.equal(fields['运行ID'],state.task_run_id);assert.ok(fields['运行日志'].length<13000);assert.deepEqual(fields['日志附件'],[{file_token:'synthetic-log'}]);
 assert.ok(!f.rows.has('success'));f.makePublic();await assert.rejects(()=>f.writer.sync('failure',state,{}),/not-private/);
});
test('Deleted leadership technical columns stay deleted; local baseline still protects manual clears',async()=>{
 const f=fixture({cleanLeader:true});let receipt=await f.writer.sync('success',f.state,{});const fields=f.rows.get('success').fields;
 assert.ok(receipt.baseline);assert.equal(fields['自动写入基线'],undefined);assert.equal(fields['自动建议-产品型号'],undefined);
 receipt=await f.writer.sync('success',{...f.state,success:{...f.state.success,sender_model:'VP1640'}},receipt);assert.match(fields['产品型号'],/^VP1640/);
 fields['产品型号']='';await f.writer.sync('success',f.state,receipt);assert.equal(fields['产品型号'],'');
});
test('Prepared local baseline survives an ambiguous create and protects a subsequent human edit',async()=>{
 const f=fixture({cleanLeader:true});let prepared;f.loseNextResponse();await assert.rejects(()=>f.writer.sync('success',f.state,{},value=>{prepared=value;}),/response-lost/);
 f.rows.get('success').fields['版本信息']='';await f.writer.sync('success',f.state,{prepared_baseline:prepared});assert.equal(f.rows.get('success').fields['版本信息'],'');
});
