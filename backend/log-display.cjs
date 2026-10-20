'use strict';
// Presentation derives only from structured readings. Never parse log content or target firmware.
const text=v=>typeof v==='string'?v.trim():'';
const {model,hardwareModel,receiverLabel,cardIdentity,cardResult}=require('./receiver-evidence.cjs');
const split=v=>text(v).split(/[;；,，\n]/).map(model).filter(Boolean);
function candidateFields(x){if(x.model_candidates===undefined)return {};if(!Array.isArray(x.model_candidates)||x.model_candidates.length>256||x.model_candidates.some(v=>typeof v!=='string'||v.length>160))throw Error('invalid-model-candidates');return {model_candidates:[...x.model_candidates]};}
const evidenceFields=['model_evidence_version','model_evidence_suffix','model_evidence_table'];
function evidenceSnapshot(x,write=false){
 const out={...candidateFields(x)};
 for(const k of [...evidenceFields,...(write?['write_reported_status','write_reported_version','write_reported_source']:[])])if(x[k]!==undefined){if(typeof x[k]!=='string'||x[k].length>160)throw Error('invalid-receiver-evidence');out[k]=x[k];}
 if(write&&x.write_reported_finished!==undefined){if(typeof x.write_reported_finished!=='boolean')throw Error('invalid-receiver-evidence');out.write_reported_finished=x.write_reported_finished;}
 return out;
}
function snapshot(input){
 const out={};
 for(const k of ['sender_model','sender_model_source','upgrade_run_id','device_app_version','fpga_version','hdset_version','hdplayer_version','device_code','devKey','product_models','recv_models','recv_models_source','selected_chip','chips','site_env'])out[k]=text(input[k]).slice(0,k==='site_env'?8000:['recv_models','product_models','chips'].includes(k)?500:160);
 if(input.receiver_inventory!==undefined){
  if(!Array.isArray(input.receiver_inventory)||input.receiver_inventory.length>256)throw Error('invalid-receiver-inventory');
  out.receiver_inventory=input.receiver_inventory.map(x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid-receiver-inventory-entry');return {model:text(x.model).slice(0,160),count:x.count,model_source:text(x.model_source).slice(0,160),firmware_model:text(x.firmware_model).slice(0,160),firmware_model_source:text(x.firmware_model_source).slice(0,160),...evidenceSnapshot(x)};});
 }
 if(input.receiver_upgrades!==undefined){
  if(!Array.isArray(input.receiver_upgrades)||input.receiver_upgrades.length>4096)throw Error('invalid-receiver-upgrades');
  out.receiver_upgrades=input.receiver_upgrades.map(x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid-receiver-upgrade-entry');const r={};for(const k of ['run_id','device_id','card_id','model','model_source','firmware_model','firmware_model_source','before_version','before_version_source','after_version','after_version_source','target_version','status','status_source'])r[k]=text(x[k]).slice(0,160);Object.assign(r,evidenceSnapshot(x,true));r.port=x.port;r.after_confirmed=x.after_confirmed===true;r.match_confirmed=x.match_confirmed===true;return r;});
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
 const perCard=rec.recv_models_source==='structured_per_card';
 const sender=model(rec.sender_model)||(perCard?'':([...new Set(split(rec.product_models).filter(x=>!/^R\d/.test(x)))].length===1?split(rec.product_models).filter(x=>!/^R\d/.test(x))[0]:''));
 if(rec.sender_model&&!model(rec.sender_model))warnings.push('发送型号不是独立型号，未将设备编号写入E列');
 const inventory=new Map(),unknownInventory=[],directoryModels=new Set();
 let inventoryRows=rec.receiver_inventory||[];
 if(perCard&&rec.receiver_upgrades.length){
  const identities=new Map();
  for(const r of rec.receiver_upgrades){if(!cardIdentity(r,rec))continue;const k=JSON.stringify([r.port,r.card_id]);if(!identities.has(k))identities.set(k,r);else if(JSON.stringify(identities.get(k))!==JSON.stringify(r))identities.set(k,null);}
  const groups=new Map();for(const r of identities.values()){if(!r)continue;const k=JSON.stringify([hardwareModel(r),r.model_source,r.model_candidates]);if(!groups.has(k))groups.set(k,{...r,count:0});groups.get(k).count++;}
  inventoryRows=[...groups.values()];
 }

 for(const r of [...rec.receiver_inventory||[],...rec.receiver_upgrades||[]])if(r.firmware_model_source==='firmware_directory'&&r.firmware_model)directoryModels.add(r.firmware_model);
 for(const r of inventoryRows){const m=hardwareModel(r);if(!m){unknownInventory.push(Number.isSafeInteger(r.count)&&r.count>0?r.count:null);warnings.push('接收卡型号未确认，未使用固件目录型号代填');continue;}const count=Number.isSafeInteger(r.count)&&r.count>0?r.count:null;
  if(inventory.has(m)&&perCard&&count!==null&&inventory.get(m)!==null)inventory.set(m,inventory.get(m)+count);
  else if(inventory.has(m)){inventory.set(m,null);warnings.push(m+'库存重复，数量未合并');}else inventory.set(m,count);
 }
 const structuredModels=new Set(inventory.keys());
 for(const value of (['structured_per_card','firmware_directory','not_collected','unknown'].includes(rec.recv_models_source)?'':rec.recv_models).split(/[;；,，\n＋+]/)){
  const counted=/^\s*((?:HD[-_ ]?)?[A-Z]{1,5}\d{1,5}[A-Z0-9]{0,5}?)\s*[×x*]\s*(\d+)\s*$/i.exec(value),m=model(counted?counted[1]:value);
  if(!m)continue;
  const n=counted?Number(counted[2]):null,count=Number.isSafeInteger(n)&&n>0?n:null;
  if(!inventory.has(m))inventory.set(m,count);
  else if(count!==null&&inventory.get(m)!==count){if(!structuredModels.has(m))inventory.set(m,null);warnings.push(m+'型号汇总数量冲突，未擅自合并');}
 }
 const lines=[...(rec.device_code?['发送设备：'+rec.device_code]:[]),'发送端应用：'+(rec.device_app_version||'未采集'),'发送端FPGA：'+(rec.fpga_version||'未采集')];
 const seen=new Map();
 for(const r of rec.receiver_upgrades||[]){
  const m=hardwareModel(r);
  if(m&&r.firmware_model_source==='firmware_directory'&&model(r.firmware_model)&&model(r.firmware_model)!==m)warnings.push('接收卡型号证据与固件目录关联冲突，未互相替代');
  if(m&&!inventory.has(m))inventory.set(m,null);
  const identity=rec.upgrade_run_id&&r.run_id===rec.upgrade_run_id&&rec.device_code&&r.device_id===rec.device_code&&Number.isSafeInteger(r.port)&&r.port>=0&&r.card_id;
  const key=identity?JSON.stringify([r.run_id,r.device_id,r.port,r.card_id]):null;
  if(key){const prior=seen.get(key);if(prior&&JSON.stringify(prior)===JSON.stringify(r))continue;if(prior){warnings.push('同一张卡存在冲突版本记录');}seen.set(key,r);}
 }
 // A conflicting card identity makes every record for that card unsuitable for a confirmed transition.
 const grouped=new Map();for(const r of rec.receiver_upgrades||[]){const key=JSON.stringify([r.run_id,r.device_id,r.port,r.card_id]);const set=grouped.get(key)||new Set();set.add(JSON.stringify(r));grouped.set(key,set);}
 const emitted=new Set(),versionRows=new Map();
 for(const r of rec.receiver_upgrades||[]){const m=hardwareModel(r),signature=JSON.stringify(r);if(emitted.has(signature))continue;emitted.add(signature);
  const identity=!!(rec.upgrade_run_id&&r.run_id===rec.upgrade_run_id&&rec.device_code&&r.device_id===rec.device_code&&Number.isSafeInteger(r.port)&&r.port>=0&&r.card_id);
  const conflicting=grouped.get(JSON.stringify([r.run_id,r.device_id,r.port,r.card_id])).size>1;
  const result=cardResult(r);
  const before=r.before_version||'原版本未采集',readback=perCard?result.readback:r.after_confirmed&&r.after_version&&(!r.after_version_source||r.after_version_source==='hdset_upgrade_readback');let value;
  if(identity&&!conflicting&&result.matched)value=before+'（已匹配，无需升级）';
  else if(identity&&!conflicting&&r.status==='succeeded'&&readback)value=before+' → '+r.after_version;
  else if(identity&&!conflicting&&r.status==='failed'&&readback)value=before+' → '+r.after_version+'（升级失败，保留实读结果）';
  else if(identity&&!conflicting&&result.report&&!result.reportConflict){
    value=before+'；HDSet报告写入'+(r.write_reported_status==='succeeded'?'成功':'失败')+'；升后版本未实读';
    if(r.write_reported_version)value+='；报告版本：'+r.write_reported_version;
    if(r.target_version)value+='；目标版本：'+r.target_version;
  }else value=before+' → 升级后待确认'+(r.status==='failed'?'（升级失败）':'');
  if(result.reportConflict)warnings.push('HDSet写入报告与逐卡状态冲突，未确认写入成功');
  const label=m?'接收卡'+receiverLabel(r):'接收卡（'+receiverLabel(r)+'）';
  const rowKey=identity&&!conflicting?JSON.stringify([r.run_id,r.device_id,m||'',r.firmware_model||'',r.firmware_model_source||'',r.model_source||'',r.model_candidates||[],r.model_evidence_version||'',value]):signature;
  if(!versionRows.has(rowKey))versionRows.set(rowKey,{label,value,cards:new Set()});
  if(identity&&!conflicting)versionRows.get(rowKey).cards.add(JSON.stringify([r.run_id,r.device_id,r.port,r.card_id]));
  if(!m)warnings.push('接收卡型号未确认，保留逐卡版本及目录关联来源');
  if(r.after_version_source&&r.after_version_source!=='hdset_upgrade_readback')warnings.push(label+'升级后版本来源不是已支持的实读来源，未作为结果展示');
  if(!identity)warnings.push(label+'缺少同一运行/设备/网口/卡号关联，未采用升级后版本');
  if(r.status==='failed')warnings.push(label+'升级失败，不能声明升级成功或客户问题已解决');
 }
 for(const row of versionRows.values())lines.push(row.label+'（'+(row.cards.size?row.cards.size+'张':'数量未采集')+'）：'+row.value);
 for(const [m,count] of inventory)if(!rec.receiver_upgrades.some(r=>hardwareModel(r)===m))lines.push('接收卡'+m+'（'+(count===null?'数量未采集':count+'张')+'）：原版本未采集 → 升级后待确认');
 if(unknownInventory.length&&!rec.receiver_upgrades.some(r=>!hardwareModel(r)))for(const count of unknownInventory)lines.push('接收卡（型号未确认）（'+(count===null?'数量未采集':count+'张')+'）：原版本未采集 → 升级后待确认');
 if(!rec.receiver_upgrades?.length&&inventory.size)warnings.push('未提供逐卡版本记录，未使用汇总版本或目标固件推测前后关系');
 const chip=rec.selected_chip?'驱动芯片（手动选择）：'+rec.selected_chip:rec.chips?'驱动芯片（手动选择）：未上报':'';
 const directory=directoryModels.size?[...directoryModels].join('、'):rec.recv_models_source==='firmware_directory'?rec.recv_models:'';
 if(perCard&&rec.site_env)warnings.push('旧现场环境原文仅保留详情，型号及结果以当前逐卡数据为准');
 const receiverSources=[...new Set(rec.receiver_upgrades.map(r=>'接收卡：'+receiverLabel(r)+(r.model_evidence_version?'；依据版本：'+r.model_evidence_version:'')+(r.model_evidence_suffix?'；尾缀：'+r.model_evidence_suffix:'')+(r.model_evidence_table?'；对照表：'+r.model_evidence_table:'')))];
 const siteEnvironment=[perCard?'':rec.site_env,perCard?receiverSources.join('\n'):'',chip,rec.hdset_version?'HDSet：'+rec.hdset_version:'',rec.hdplayer_version?'HDPlayer：'+rec.hdplayer_version:'',directory?'接收卡固件目录关联：'+directory+'（非硬件型号确认）':''].filter(Boolean).join('\n');
 const unknown=inventoryRows.filter(r=>!hardwareModel(r)).map(r=>'接收卡（'+receiverLabel(r)+'）'+(Number.isSafeInteger(r.count)&&r.count>0?'×'+r.count:''));if(!unknown.length&&rec.receiver_upgrades.some(r=>!hardwareModel(r)))unknown.push('接收卡（型号未确认）');
 return {productModel:[sender,...[...inventory].map(([m,c])=>{const row=[...rec.receiver_upgrades,...inventoryRows].find(r=>hardwareModel(r)===m);return (row?receiverLabel(row):m)+(c===null?'':'×'+c);}),...unknown].filter(Boolean).join('＋'),versionInfo:lines.join('\n'),siteEnvironment,warnings:[...new Set(warnings)],snapshot:rec};
}
const cell=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x?.text||'').join(''):typeof v==='string'?v:'';
// Compare each current cell with its persisted last automatic value; a manual change/clear
// permanently protects that field. Legacy values without a baseline are never assumed automatic.
function displayPatch(display,{existing=false,currentFields={}}={}){
 const environmentColumn='现场环境（软/固件版本、源端设备、线材）';
 const fields={'自动建议-产品型号':display.productModel,'自动建议-版本信息':display.versionInfo,'自动建议-现场环境':display.siteEnvironment||'','自动建议-缺失或冲突':display.warnings.join('\n')};
 let previous={};try{previous=JSON.parse(cell(currentFields['自动写入基线']));}catch{}
 const state={schemaVersion:1,fields:{}};
 for(const [column,proposed]of [['产品型号',display.productModel],['版本信息',display.versionInfo],[environmentColumn,display.siteEnvironment]]){
  const prior=previous?.fields?.[column];
  const bootstrapEmptyEnvironment=column===environmentColumn&&!prior&&!cell(currentFields[column]);
  const manual=existing&&!bootstrapEmptyEnvironment&&(!prior||prior.manual===true||typeof prior.value!=='string'||cell(currentFields[column])!==prior.value);
  state.fields[column]={manual,value:manual?(prior?.value??null):(proposed||cell(currentFields[column]))};
  if(!manual&&proposed)fields[column]=proposed;
 }
 fields['自动写入基线']=JSON.stringify(state);
 return fields;
}
function recordDetails(rec){return Object.fromEntries(['machine_id','device_code','devKey','receiver_upload_id','app_version','device_app_version','fpga_version','hdset_version','hdplayer_version','selected_chip','chips','product_models','recv_models','recv_models_source','recv_versions','version_info','site_env','sender_model','sender_model_source','upgrade_run_id','receiver_inventory','receiver_upgrades','site_display_snapshot'].filter(k=>rec[k]!==undefined).map(k=>[k,rec[k]]));}
module.exports={model,snapshot,mergeSnapshot,buildDisplay,displayPatch,recordDetails};
