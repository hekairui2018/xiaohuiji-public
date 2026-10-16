'use strict';
// Presentation derives only from structured readings. Never parse log content or target firmware.
const text=v=>typeof v==='string'?v.trim():'';
function model(v){const s=text(v).toUpperCase().replace(/^HD[-_ ]/,'');return /^[A-Z]{1,5}\d{1,5}[A-Z0-9]{0,5}$/.test(s)?s:'';}
const split=v=>text(v).split(/[;；,，\n]/).map(model).filter(Boolean);
function snapshot(input){
 const out={};
 for(const k of ['sender_model','upgrade_run_id','device_app_version','fpga_version','device_code','devKey','product_models','recv_models'])out[k]=text(input[k]).slice(0,k==='recv_models'||k==='product_models'?500:160);
 if(input.receiver_inventory!==undefined){
  if(!Array.isArray(input.receiver_inventory)||input.receiver_inventory.length>256)throw Error('invalid-receiver-inventory');
  out.receiver_inventory=input.receiver_inventory.map(x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid-receiver-inventory-entry');return {model:text(x.model),count:x.count};});
 }
 if(input.receiver_upgrades!==undefined){
  if(!Array.isArray(input.receiver_upgrades)||input.receiver_upgrades.length>4096)throw Error('invalid-receiver-upgrades');
  out.receiver_upgrades=input.receiver_upgrades.map(x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid-receiver-upgrade-entry');const r={};for(const k of ['run_id','device_id','card_id','model','before_version','after_version','target_version','status'])r[k]=text(x[k]).slice(0,160);r.port=x.port;r.after_confirmed=x.after_confirmed===true;r.match_confirmed=x.match_confirmed===true;return r;});
 }
 return out;
}
function mergeSnapshot(input,previous){
 const next=snapshot(input);
 if(previous&&next.upgrade_run_id&&next.upgrade_run_id===previous.upgrade_run_id&&next.device_code&&next.device_code===previous.device_code){
  for(const k of ['sender_model','device_app_version','fpga_version'])if(!next[k])next[k]=previous[k]||'';
  if(next.receiver_inventory===undefined&&previous.receiver_inventory!==undefined)next.receiver_inventory=previous.receiver_inventory;
 }
 return next;
}
function buildDisplay(input){
 const rec=snapshot(input),warnings=[];
 rec.receiver_upgrades=(rec.receiver_upgrades||[]).filter(r=>{if((rec.upgrade_run_id&&r.run_id&&r.run_id!==rec.upgrade_run_id)||(rec.device_code&&r.device_id&&r.device_id!==rec.device_code)){warnings.push('其他运行或设备的升级记录未进入展示');return false;}return true;});
 const sender=model(rec.sender_model)||([...new Set(split(rec.product_models).filter(x=>!/^R\d/.test(x)))].length===1?split(rec.product_models).filter(x=>!/^R\d/.test(x))[0]:'');
 if(rec.sender_model&&!model(rec.sender_model))warnings.push('发送型号不是独立型号，未将设备编号写入E列');
 const inventory=new Map();
 for(const r of rec.receiver_inventory||[]){const m=model(r.model);if(!m){warnings.push('接收卡型号缺失或不合法');continue;}const count=Number.isSafeInteger(r.count)&&r.count>0?r.count:null;
  if(inventory.has(m)){inventory.set(m,null);warnings.push(m+'库存重复，数量未合并');}else inventory.set(m,count);
 }
 for(const m of split(rec.recv_models))if(!inventory.has(m))inventory.set(m,null);
 const lines=['发送端应用：'+(rec.device_app_version||'未采集'),'发送端FPGA：'+(rec.fpga_version||'未采集')];
 const seen=new Map();
 for(const r of rec.receiver_upgrades||[]){
  const m=model(r.model);if(!m){warnings.push('升级记录缺少独立接收卡型号');continue;}
  if(!inventory.has(m))inventory.set(m,null);
  const identity=rec.upgrade_run_id&&r.run_id===rec.upgrade_run_id&&rec.device_code&&r.device_id===rec.device_code&&Number.isSafeInteger(r.port)&&r.port>=0&&r.card_id;
  const key=identity?JSON.stringify([r.run_id,r.device_id,r.port,r.card_id]):null;
  if(key){const prior=seen.get(key);if(prior&&JSON.stringify(prior)===JSON.stringify(r))continue;if(prior){warnings.push('同一张卡存在冲突版本记录');}seen.set(key,r);}
 }
 // A conflicting card identity makes every record for that card unsuitable for a confirmed transition.
 const grouped=new Map();for(const r of rec.receiver_upgrades||[]){const key=JSON.stringify([r.run_id,r.device_id,r.port,r.card_id]);const set=grouped.get(key)||new Set();set.add(JSON.stringify(r));grouped.set(key,set);}
 const emitted=new Set();
 for(const r of rec.receiver_upgrades||[]){const m=model(r.model);if(!m)continue;const signature=JSON.stringify(r);if(emitted.has(signature))continue;emitted.add(signature);
  const identity=!!(rec.upgrade_run_id&&r.run_id===rec.upgrade_run_id&&rec.device_code&&r.device_id===rec.device_code&&Number.isSafeInteger(r.port)&&r.port>=0&&r.card_id);
  const conflicting=grouped.get(JSON.stringify([r.run_id,r.device_id,r.port,r.card_id])).size>1;
  const before=r.before_version||'原版本未采集';let value;
  if(identity&&!conflicting&&r.status==='matched_no_upgrade'&&r.match_confirmed&&r.before_version&&(!r.after_version||r.after_version===r.before_version))value=before+'（已匹配，无需升级）';
  else if(identity&&!conflicting&&r.status==='succeeded'&&r.after_confirmed&&r.after_version)value=before+' → '+r.after_version;
  else value=before+' → 升级后待确认';
  lines.push('接收卡'+m+'：'+value);
  if(!identity)warnings.push(m+'缺少同一运行/设备/网口/卡号关联，未采用升级后版本');
  if(r.status==='failed')warnings.push(m+'升级失败，不能声明升级成功或客户问题已解决');
 }
 for(const m of inventory.keys())if(!rec.receiver_upgrades.some(r=>model(r.model)===m))lines.push('接收卡'+m+'：原版本未采集 → 升级后待确认');
 if(!rec.receiver_upgrades?.length&&inventory.size)warnings.push('未提供逐卡版本记录，未使用汇总版本或目标固件推测前后关系');
 return {productModel:[sender,...[...inventory].map(([m,c])=>m+(c===null?'':'×'+c))].filter(Boolean).join('＋'),versionInfo:lines.join('\n'),warnings:[...new Set(warnings)],snapshot:rec};
}
const cell=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x?.text||'').join(''):typeof v==='string'?v:'';
// Compare each current cell with its persisted last automatic value; a manual change/clear
// permanently protects that field. Legacy values without a baseline are never assumed automatic.
function displayPatch(display,{existing=false,currentFields={}}={}){
 const fields={'自动建议-产品型号':display.productModel,'自动建议-版本信息':display.versionInfo,'自动建议-缺失或冲突':display.warnings.join('\n')};
 let previous={};try{previous=JSON.parse(cell(currentFields['自动写入基线']));}catch{}
 const state={schemaVersion:1,fields:{}};
 for(const [column,proposed]of [['产品型号',display.productModel],['版本信息',display.versionInfo]]){
  const prior=previous?.fields?.[column];
  const manual=existing&&(!prior||prior.manual===true||typeof prior.value!=='string'||cell(currentFields[column])!==prior.value);
  state.fields[column]={manual,value:manual?(prior?.value??null):(proposed||cell(currentFields[column]))};
  if(!manual&&proposed)fields[column]=proposed;
 }
 fields['自动写入基线']=JSON.stringify(state);
 return fields;
}
function recordDetails(rec){return Object.fromEntries(['machine_id','device_code','devKey','app_version','device_app_version','fpga_version','hdset_version','hdplayer_version','chips','product_models','recv_models','recv_versions','version_info','site_env','sender_model','upgrade_run_id','receiver_inventory','receiver_upgrades','site_display_snapshot'].filter(k=>rec[k]!==undefined).map(k=>[k,rec[k]]));}
module.exports={snapshot,mergeSnapshot,buildDisplay,displayPatch,recordDetails};
