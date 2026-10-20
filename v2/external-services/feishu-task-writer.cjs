'use strict';
// Explicit two-table adapter. Reads schema, never creates/renames/reorders fields or permissions.
const {model,buildDisplay,buildV2Display,displayPatch}=require('../../backend/log-display.cjs');
const {hash}=require('./task-log-store.cjs');
const {receiverLabel,hardwareModel}=require('../../backend/receiver-evidence.cjs');
const DOMAIN='https://open.feishu.cn/open-apis/';
function createFeishuTaskWriter({cfg,getTenantToken,fetchImpl=fetch}){
 const targets={success:{app:cfg.FEISHU_APP_TOKEN,table:cfg.FEISHU_TABLE_ID},failure:{app:cfg.FEISHU_FAILURE_APP_TOKEN,table:cfg.FEISHU_FAILURE_TABLE_ID}};
 if(cfg.FEISHU_TASK_SYNC_ENABLED!=='1'||Object.values(targets).some(t=>!t.app||!t.table))return null;
 if(targets.success.app===targets.failure.app)throw Error('failure-base-must-be-independent');
 async function api(method,route,body){
  const form=body instanceof FormData;
  const res=await fetchImpl(DOMAIN+route,{method,headers:{Authorization:'Bearer '+await getTenantToken(),...(!form?{'Content-Type':'application/json'}:{})},...(body?{body:form?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const j=await res.json();if(res.ok===false||j.code!==0){const e=Error('feishu-task-request-failed');e.code='feishu-'+(j.code??res.status);throw e;}return j.data;
 }
 async function fields(base){let token='',items=[];do{const data=await api('GET',base+'/fields?page_size=100'+(token?'&page_token='+encodeURIComponent(token):''));items.push(...data.items||[]);token=data.has_more?data.page_token:'';if(data.has_more&&!token)throw Error('invalid-schema-page');}while(token);return items;}
 const cell=v=>Array.isArray(v)?v.map(x=>x.text||'').join(''):String(v??'');
 const uuid=key=>{const b=Buffer.from(hash(key).slice(0,32),'hex');b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const s=b.toString('hex');return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');};
 async function sync(kind,state,receipt,prepare=()=>{}){
  if(kind==='failure'){
   const p=(await api('GET','drive/v1/permissions/'+targets.failure.app+'/public?type=bitable')).permission_public;
   if(!p||p.link_share_entity!=='closed'||p.external_access!==false)throw Error('failure-base-not-private');
  }
  const t=targets[kind],base='bitable/v1/apps/'+t.app+'/tables/'+t.table,schema=await fields(base),primary=schema.find(x=>x.is_primary),names=new Set(schema.map(x=>x.field_name));
  const required=kind==='success'?['产品型号','版本信息','现场环境（软/固件版本、源端设备、线材）','非人工暂停记录']:['运行ID','机器码','异常记录','运行日志','日志附件','设备信息'];
  if(!primary||primary.type!==1||required.some(n=>!names.has(n)))throw Error('task-schema-not-confirmed');
  const identity='run:'+state.task_run_id+':'+state.key.slice(0,12);
  // Search every attempt: recover a remote success whose response/local receipt was lost.
  const found=await api('POST',base+'/records/search',{filter:{conjunction:'and',conditions:[{field_name:primary.field_name,operator:'is',value:[identity]}]},page_size:2});
  if((found.items||[]).length>1)throw Error('duplicate-task-records-require-review');
  const row=found.items?.[0];if(receipt.record_id&&(!row||receipt.record_id!==row.record_id))throw Error('task-record-identity-conflict');
  const current={...row?.fields},r=kind==='success'?state.success:state.latest;
  // The technical baseline no longer needs a visible/hidden leadership column.
  if(!names.has('自动写入基线'))current['自动写入基线']=receipt.prepared_baseline||receipt.baseline||'';
  const pauses=state.exceptions.map(x=>x.node+'：'+x.message).join('\n');let patch;
  if(kind==='success'){
   const display=buildV2Display(r);
   patch=displayPatch(display,{existing:!!row,currentFields:current});
   patch['非人工暂停记录']=state.exceptions.length?'共'+state.exceptions.length+'次\n'+state.exceptions.slice(-20).map(x=>x.node+'：'+x.message.slice(0,280)).join('\n')+'\n完整异常见内部异常表':'无';
   // Dates only on creation. The existing human/business columns are never bulk replaced.
   if(!row&&names.has('日期'))patch['日期']=Date.parse(r.log_date+'T00:00:00+08:00');
   for(const [name,key]of [['APP版本','app_version'],['发送型号','sender_model'],['FPGA版本','fpga_version'],['应用版本','device_app_version'],['HDSet版本','hdset_version'],['HDPlayer版本','hdplayer_version']])if(names.has(name)&&r[key])patch[name]=r[key];
  }else{
   const equipment={device_code:r.device_code||null,upgrade_run_id:r.upgrade_run_id||null,
    sender_model:r.sender_model||null,sender_model_source:r.sender_model_source||null,
    receiver_inventory:r.receiver_inventory||[],receiver_upgrades:r.receiver_upgrades||[],recv_models_source:r.recv_models_source||null};
   const display=buildDisplay(r);equipment.product_model_display=display.productModel;
   equipment.model_source_notes=[...new Set(display.snapshot.receiver_upgrades.map(receiverLabel))];
   if(r.recv_models_source!=='structured_per_card'){
    const labels=new Set();for(const card of [...equipment.receiver_inventory,...equipment.receiver_upgrades]){
     if(!card||card.device_id&&card.device_id!==r.device_code||card.run_id&&card.run_id!==r.upgrade_run_id)continue;
     if(hardwareModel(card))labels.add(receiverLabel(card));
     else if(card.firmware_model_source==='firmware_directory'&&model(card.firmware_model))labels.add(model(card.firmware_model)+'（接收卡型号：固件目录关联）');
    }
    equipment.product_model_display=[model(r.sender_model),...labels].filter(Boolean).join('＋');
   }
   const fullLog='运行ID：'+state.task_run_id+'\n异常事件：\n'+JSON.stringify(state.exceptions,null,2)+'\n原始任务事件：\n'+JSON.stringify(state.raw_events||[],null,2)+'\n设备信息：\n'+JSON.stringify(equipment,null,2)+'\n完整运行日志：\n'+r.content;
   const form=new FormData();form.append('file_name','task-'+state.task_run_id+'.txt');form.append('parent_type','bitable_file');form.append('parent_node',t.app);form.append('size',String(Buffer.byteLength(fullLog)));form.append('file',new Blob([fullLog]),'task-'+state.task_run_id+'.txt');
   const attachment=await api('POST','drive/v1/medias/upload_all',form);if(!attachment.file_token)throw Error('task-log-attachment-missing');
   const equipmentText=JSON.stringify(equipment);
   patch={'运行ID':state.task_run_id,'机器码':state.machine_id,'异常记录':pauses.length>12000?pauses.slice(0,12000)+'\n（完整异常见日志附件）':pauses,'运行日志':fullLog.length>12000?fullLog.slice(0,12000)+'\n（完整内容见日志附件）':fullLog,'日志附件':[{file_token:attachment.file_token}],'设备信息':equipmentText.length>12000?JSON.stringify({device_code:r.device_code,sender_model:equipment.sender_model,sender_model_source:equipment.sender_model_source,recv_models_source:equipment.recv_models_source,card_count:equipment.receiver_upgrades.length,details:'完整receiver_inventory、receiver_upgrades及来源见日志附件'}):equipmentText, '异常次数':state.exceptions.length,'服务器接收时间':Date.parse(state.received_at)};
   for(const [name,key]of [['APP版本','app_version'],['FPGA版本','fpga_version'],['应用版本','device_app_version'],['HDSet版本','hdset_version'],['HDPlayer版本','hdplayer_version']])if(r[key])patch[name]=r[key];
   // Never put a combined product label or a device serial in the sender column.
   patch['发送型号']=model(r.sender_model);
  }
  // Never include any human remarks field, even if it is renamed after configuration.
  const baseline=kind==='success'?patch['自动写入基线']:undefined;
  if(baseline)prepare(baseline);
  for(const name of ['备注','人工备注','验收人工备注'])delete patch[name];
  patch=Object.fromEntries(Object.entries(patch).filter(([n])=>names.has(n)));
  if(!row)patch[primary.field_name]=identity;
  const result=await api(row?'PUT':'POST',base+'/records'+(row?'/'+row.record_id:'?client_token='+uuid([kind,state.key])),{fields:patch});
  return {record_id:row?.record_id||result.record?.record_id,...(baseline?{baseline}:{})};
 }
 return {sync};
}
module.exports={createFeishuTaskWriter};
