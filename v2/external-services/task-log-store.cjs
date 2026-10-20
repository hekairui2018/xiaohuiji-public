'use strict';
// Versioned task events. No device/day inference, Feishu schema changes or legacy migration.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {snapshot}=require('../../backend/log-display.cjs');
const {cardIdentity,cardResult,version}=require('../../backend/receiver-evidence.cjs');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,160}$/.test(v);
function atomic(file,value,raw=false){
 fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,raw?value:JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);
}
function qualifies(e){
 if(e.event_kind!=='receiver_checkpoint'||!['receiver_version_comparison','receiver_upgrade_readback'].includes(e.checkpoint_source))return false;
 if(!e.upgrade_run_id||!e.device_code||!Array.isArray(e.receiver_upgrades)||!e.receiver_upgrades.length)return false;
 const identities=new Set();
 for(const r of e.receiver_upgrades){
  if(!r||r.run_id!==e.upgrade_run_id||r.device_id!==e.device_code||!Number.isSafeInteger(r.port)||r.port<0||typeof r.card_id!=='string'||!r.card_id)return false;
  const key=JSON.stringify([r.port,r.card_id]);if(identities.has(key))return false;identities.add(key);
  const version=v=>typeof v==='string'&&/^\d+(?:\.\d+)+$/.test(v);
  const checked=r.status==='matched_no_upgrade'&&r.match_confirmed===true&&r.status_source==='explicit_version_comparison'&&version(r.before_version)&&r.before_version===r.target_version;
  const upgraded=r.status==='succeeded'&&r.after_confirmed===true&&r.after_version_source==='hdset_upgrade_readback'&&version(r.after_version)&&r.after_version===r.target_version;
  if(!checked&&!upgraded)return false;
 }
 // Never mistake one completed batch for completion of all observed receiver cards.
 return Array.isArray(e.receiver_inventory)&&e.receiver_inventory.length>0&&e.receiver_inventory.every(x=>x&&Number.isSafeInteger(x.count)&&x.count>0)&&e.receiver_inventory.reduce((s,x)=>s+x.count,0)===identities.size;
}
// Record eligibility is deliberately separate from strict readback success.
function collectionQualifies(e){
 if(e.recv_models_source!=='structured_per_card'||!e.upgrade_run_id||!e.device_code||!Array.isArray(e.receiver_upgrades)||!e.receiver_upgrades.length)return false;
 const seen=new Map();let observation=false;
 for(const r of e.receiver_upgrades){
  if(!cardIdentity(r,e))return false;
  const key=JSON.stringify([r.port,r.card_id]);
  if(seen.has(key)&&hash(seen.get(key))!==hash(r))return false;seen.set(key,r);
  const result=cardResult(r);
  if(version(r.before_version)&&r.before_version_source==='hdset_detection'||result.readback||result.matched||result.report&&!result.reportConflict)observation=true;
 }
 return observation;
}
function validate(e){
 if(!e||e.task_protocol!==1||!id(e.task_run_id)||!id(e.event_id)||typeof e.machine_id!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(e.machine_id)||!Number.isSafeInteger(e.event_sequence)||e.event_sequence<1||!['snapshot','receiver_checkpoint','exception'].includes(e.event_kind)||typeof e.content!=='string'||e.content.length>900000||!/^\d{4}-\d{2}-\d{2}$/.test(e.log_date||''))throw Error('invalid-task-event');
 if(e.event_kind==='exception'&&(!['automation','human','unknown'].includes(e.origin)||typeof e.node!=='string'||!e.node||typeof e.message!=='string'||!e.message||e.node.length>500||e.message.length>16000))throw Error('invalid-task-event');
 try{snapshot(e);}catch{throw Error('invalid-task-event');}
 if(e.sender_model!==undefined&&(typeof e.sender_model!=='string'||e.sender_model.length>160))throw Error('invalid-task-event');
 if(e.sender_model_source!==undefined&&(typeof e.sender_model_source!=='string'||e.sender_model_source.length>160))throw Error('invalid-task-event');
 if(e.device_code!==undefined&&(typeof e.device_code!=='string'||e.device_code.length>160))throw Error('invalid-task-event');
 if(e.receiver_upgrades!==undefined&&(!Array.isArray(e.receiver_upgrades)||e.receiver_upgrades.length>4096))throw Error('invalid-task-event');
 if(e.receiver_inventory!==undefined&&(!Array.isArray(e.receiver_inventory)||e.receiver_inventory.length>256))throw Error('invalid-task-event');
}
function createTaskLogStore({directory,writer,autoStart=true,interval=60000}={}){
 directory=path.resolve(directory);for(const n of ['events','receipts','txt'])fs.mkdirSync(path.join(directory,n),{recursive:true});
 let running=false,lastError=null,closed=false;const pending=new Map(),errors=new Map();
 function eventDir(key){return path.join(directory,'events',key);}
 function read(key){return fs.readdirSync(eventDir(key)).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(eventDir(key),n),'utf8'))).sort((a,b)=>a.input.event_sequence-b.input.event_sequence);}
 function materialize(key){
  const allEvents=read(key),events=allEvents.filter(x=>!x.obsolete_run),latest=events.at(-1).input,exceptions=allEvents.filter(x=>x.input.event_kind==='exception'&&x.input.origin==='automation').map(x=>({event_id:x.input.event_id,sequence:x.input.event_sequence,node:x.input.node,message:x.input.message,received_at:x.received_at}));
  const currentRun=events.map(x=>x.input.upgrade_run_id).filter(Boolean).at(-1);
  const proof=events.filter(x=>qualifies(x.input)&&x.input.upgrade_run_id===currentRun).at(-1)?.input;
  // Existing archives are not retroactively enrolled under a new table admission policy.
  const collection=events.filter(x=>x.collection_policy===2&&collectionQualifies(x.input)&&x.input.upgrade_run_id===currentRun).at(-1)?.input;
  const facts={};let receiverRun,receiverFacts={};
  const device=events.map(x=>x.input.device_code).filter(Boolean).at(-1);
  for(const {input}of events){
   // Never borrow equipment observations lacking the current device identity.
   if(device&&input.device_code!==device)continue;
   for(const k of ['device_code','device_app_version','fpga_version','hdset_version','hdplayer_version','app_version','selected_chip','site_env'])if(input[k])facts[k]=input[k];
   if(input.upgrade_run_id&&receiverRun&&receiverRun!==input.upgrade_run_id){delete facts.sender_model;delete facts.sender_model_source;}
   if(Object.hasOwn(input,'sender_model')){
    facts.sender_model=input.sender_model;
    // Source and model are one observation; a legacy replacement cannot inherit a source.
    facts.sender_model_source=input.sender_model_source||null;
   }else if(input.sender_model_source&&facts.sender_model)facts.sender_model_source=input.sender_model_source;
   if(input.upgrade_run_id){
    if(receiverRun!==input.upgrade_run_id){receiverRun=input.upgrade_run_id;receiverFacts={};}
    for(const k of ['receiver_inventory','receiver_upgrades','recv_models_source'])if(Object.hasOwn(input,k))receiverFacts[k]=input[k];
   }
  }
  if(receiverRun)Object.assign(facts,{upgrade_run_id:receiverRun},receiverFacts);
  // A later incomplete diagnostic cannot erase an already verified receiver result.
  const selected=proof||collection;
  const success=selected?{...latest,...facts,...Object.fromEntries(['device_code','upgrade_run_id','receiver_upgrades','receiver_inventory','log_date','client_ts','recv_models_source'].filter(k=>selected[k]!==undefined).map(k=>[k,selected[k]]))}:null;
  if(success&&selected!==latest)success.recv_models_source=selected.recv_models_source||null;
  if(success&&proof&&collection&&collection.event_sequence>proof.event_sequence){
   // Supplement provenance only on an identical observed card, never compose version results.
   success.receiver_upgrades=proof.receiver_upgrades.map(original=>{
    const update=collection.receiver_upgrades.find(r=>cardIdentity(r,proof)&&r.port===original.port&&r.card_id===original.card_id&&r.before_version===original.before_version);
    if(!update)return original;
    const keys=['model','model_source','model_candidates','model_evidence_version','model_evidence_suffix','model_evidence_table','firmware_model','firmware_model_source'];
    return {...original,...Object.fromEntries(keys.filter(k=>Object.hasOwn(update,k)).map(k=>[k,update[k]]))};
   });
   if(collection.recv_models_source)success.recv_models_source=collection.recv_models_source;
  }
  return {key,task_run_id:latest.task_run_id,machine_id:latest.machine_id,latest:{...latest,...facts},success,readback_success_qualified:!!proof,raw_events:allEvents.map(x=>x.input),exceptions,received_at:events.map(x=>x.received_at).sort().at(-1)};
 }
 function fingerprint(state,kind){
  const r=kind==='success'?state.success:state.latest;if(!r)return null;
  const fields=['device_code','sender_model','device_app_version','fpga_version','hdset_version','hdplayer_version','app_version','selected_chip','sender_model_source','recv_models_source','upgrade_run_id','receiver_inventory','receiver_upgrades'];
  return hash({task_run_id:state.task_run_id,machine_id:state.machine_id,fields:Object.fromEntries(fields.map(k=>[k,r[k]??null])),...(kind==='success'&&!state.readback_success_qualified?{readback_success_qualified:false}:{}),exceptions:state.exceptions});
 }
 function receipt(key){const p=path.join(directory,'receipts',key+'.json');return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};}
 function schedule(state){const saved=receipt(state.key);for(const kind of ['success','failure']){
  const eligible=kind==='success'?!!state.success:state.exceptions.length>0;
  if(!eligible){pending.delete(state.key+':'+kind);continue;}
  if(saved[kind]?.hash!==fingerprint(state,kind))pending.set(state.key+':'+kind,{key:state.key,kind});
 }}
 function response(state,dedup,stale){const saved=receipt(state.key);return {ok:true,accepted:true,durable:true,dedup,stale,task_run_id:state.task_run_id,latest_sequence:state.latest.event_sequence,success_qualified:state.readback_success_qualified,collection_qualified:!!state.success,exception_count:state.exceptions.length,records:Object.fromEntries(['success','failure'].map(k=>[k,saved[k]?.record_id||null])),sync:Object.fromEntries(['success','failure'].map(k=>[k,(k==='success'?!state.success:!state.exceptions.length)?'not-applicable':saved[k]?.hash===fingerprint(state,k)?'synced':writer?'queued':'configuration-required']))};}
 function receive(input){
  validate(input);const key=hash([input.machine_id,input.task_run_id]),dir=eventDir(key);fs.mkdirSync(dir,{recursive:true});const entries=read(key),existing=entries.find(x=>x.input.event_id===input.event_id||x.input.event_sequence===input.event_sequence);
  if(input.device_code&&entries.some(x=>x.input.device_code&&x.input.device_code!==input.device_code))throw Error('task-device-conflict');
  if(existing){if(hash(existing.input)!==hash(input))throw Error('task-event-conflict');const state=materialize(key);atomic(path.join(directory,'txt',key+'.txt'),state.raw_events.map(e=>JSON.stringify(e,null,2)).join('\n\n'),true);schedule(state);return response(state,true,!!existing.obsolete_run||input.event_sequence<state.latest.event_sequence);}
  const latestRun=entries.filter(x=>!x.obsolete_run).map(x=>x.input.upgrade_run_id).filter(Boolean).at(-1);
  const obsolete=!!(input.upgrade_run_id&&latestRun&&input.upgrade_run_id!==latestRun&&entries.some(x=>x.input.upgrade_run_id===input.upgrade_run_id)&&input.event_sequence>(entries.at(-1)?.input.event_sequence||0));
  atomic(path.join(dir,String(input.event_sequence).padStart(16,'0')+'.json'),{input,collection_policy:2,...(obsolete?{obsolete_run:true}:{}),received_at:new Date().toISOString()});
  const state=materialize(key);atomic(path.join(directory,'txt',key+'.txt'),state.raw_events.map(e=>JSON.stringify(e,null,2)).join('\n\n'),true);schedule(state);if(writer&&autoStart)setImmediate(()=>drain());return response(state,false,obsolete||input.event_sequence<state.latest.event_sequence);
 }
 async function drain(){if(running||closed||!writer)return {skipped:true};running=true;let completed=0,failed=0;
  try{for(const [queueKey,item] of [...pending]){
   try{
   const state=materialize(item.key),before=fingerprint(state,item.kind),saved=receipt(item.key);
   const result=await writer.sync(item.kind,state,saved[item.kind]||{},prepared=>{
    saved[item.kind]={...saved[item.kind],prepared_baseline:prepared};atomic(path.join(directory,'receipts',item.key+'.json'),saved);
   });
   if(!result||!result.record_id)throw Error('task-sync-no-record-id');
   saved[item.kind]={hash:before,record_id:result.record_id,synced_at:new Date().toISOString(),...(result.baseline?{baseline:result.baseline}:{})};atomic(path.join(directory,'receipts',item.key+'.json'),saved);
   if(fingerprint(materialize(item.key),item.kind)===before)pending.delete(queueKey);completed++;errors.delete(queueKey);
   }catch(e){failed++;lastError={kind:item.kind,code:e.code||(/^[a-z-]{1,80}$/.test(e.message)?e.message:'task-sync-failed'),time:new Date().toISOString()};errors.set(queueKey,lastError);}
  }}catch{lastError={code:'task-outbox-read-failed',time:new Date().toISOString()};}finally{running=false;}
  if(!failed&&!errors.size)lastError=null;return {completed,failed};
 }
 // Rebuild delivery work from the immutable journal, including crashes after archive/remote write.
 for(const key of fs.readdirSync(path.join(directory,'events')))if(/^[a-f0-9]{64}$/.test(key)&&fs.readdirSync(eventDir(key)).some(n=>n.endsWith('.json')))schedule(materialize(key));
 const timer=setInterval(()=>drain(),interval);timer.unref();if(writer&&autoStart)setImmediate(()=>drain());
 return {receive,drain,status:()=>({protocol:1,collectionPolicy:2,pending:pending.size,running,lastError,failed:errors.size,configured:!!writer}),close:()=>{closed=true;clearInterval(timer);}};
}
module.exports={createTaskLogStore,qualifies,collectionQualifies,validate,hash,atomic};
