'use strict';
// Versioned task events. No device/day inference, Feishu schema changes or legacy migration.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,160}$/.test(v);
function atomic(file,value){
 fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
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
function validate(e){
 if(!e||e.task_protocol!==1||!id(e.task_run_id)||!id(e.event_id)||typeof e.machine_id!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(e.machine_id)||!Number.isSafeInteger(e.event_sequence)||e.event_sequence<1||!['snapshot','receiver_checkpoint','exception'].includes(e.event_kind)||typeof e.content!=='string'||e.content.length>900000||!/^\d{4}-\d{2}-\d{2}$/.test(e.log_date||''))throw Error('invalid-task-event');
 if(e.event_kind==='exception'&&(!['automation','human','unknown'].includes(e.origin)||typeof e.node!=='string'||!e.node||typeof e.message!=='string'||!e.message||e.node.length>500||e.message.length>16000))throw Error('invalid-task-event');
 if(e.device_code!==undefined&&(typeof e.device_code!=='string'||e.device_code.length>160))throw Error('invalid-task-event');
 if(e.receiver_upgrades!==undefined&&(!Array.isArray(e.receiver_upgrades)||e.receiver_upgrades.length>4096))throw Error('invalid-task-event');
 if(e.receiver_inventory!==undefined&&(!Array.isArray(e.receiver_inventory)||e.receiver_inventory.length>256))throw Error('invalid-task-event');
}
function createTaskLogStore({directory,writer,autoStart=true,interval=60000}={}){
 directory=path.resolve(directory);for(const n of ['events','receipts'])fs.mkdirSync(path.join(directory,n),{recursive:true});
 let running=false,lastError=null,closed=false;const pending=new Map(),errors=new Map();
 function eventDir(key){return path.join(directory,'events',key);}
 function read(key){return fs.readdirSync(eventDir(key)).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(eventDir(key),n),'utf8'))).sort((a,b)=>a.input.event_sequence-b.input.event_sequence);}
 function materialize(key){
  const events=read(key),latest=events.at(-1).input,exceptions=events.filter(x=>x.input.event_kind==='exception'&&x.input.origin==='automation').map(x=>({event_id:x.input.event_id,sequence:x.input.event_sequence,node:x.input.node,message:x.input.message,received_at:x.received_at}));
  const proof=events.filter(x=>qualifies(x.input)).at(-1)?.input;
  const facts={};for(const {input}of events)for(const k of ['device_code','sender_model','device_app_version','fpga_version','hdset_version','hdplayer_version','app_version','selected_chip','site_env'])if(input[k])facts[k]=input[k];
  // A later incomplete diagnostic cannot erase an already verified receiver result.
  const success=proof?{...latest,...facts,...Object.fromEntries(['device_code','upgrade_run_id','receiver_upgrades','receiver_inventory','log_date','client_ts'].map(k=>[k,proof[k]]))}:null;
  return {key,task_run_id:latest.task_run_id,machine_id:latest.machine_id,latest:{...latest,...facts},success,exceptions,received_at:events.map(x=>x.received_at).sort().at(-1)};
 }
 function fingerprint(state,kind){
  const r=kind==='success'?state.success:state.latest;if(!r)return null;
  const fields=['device_code','sender_model','device_app_version','fpga_version','hdset_version','hdplayer_version','app_version','selected_chip','upgrade_run_id','receiver_inventory','receiver_upgrades'];
  return hash({task_run_id:state.task_run_id,machine_id:state.machine_id,fields:Object.fromEntries(fields.map(k=>[k,r[k]??null])),exceptions:state.exceptions});
 }
 function receipt(key){const p=path.join(directory,'receipts',key+'.json');return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};}
 function schedule(state){const saved=receipt(state.key);for(const kind of ['success','failure']){
  const eligible=kind==='success'?!!state.success:state.exceptions.length>0;
  if(eligible&&saved[kind]?.hash!==fingerprint(state,kind))pending.set(state.key+':'+kind,{key:state.key,kind});
 }}
 function response(state,dedup,stale){const saved=receipt(state.key);return {ok:true,accepted:true,durable:true,dedup,stale,task_run_id:state.task_run_id,latest_sequence:state.latest.event_sequence,success_qualified:!!state.success,exception_count:state.exceptions.length,sync:Object.fromEntries(['success','failure'].map(k=>[k,(k==='success'?!state.success:!state.exceptions.length)?'not-applicable':saved[k]?.hash===fingerprint(state,k)?'synced':writer?'queued':'configuration-required']))};}
 function receive(input){
  validate(input);const key=hash([input.machine_id,input.task_run_id]),dir=eventDir(key);fs.mkdirSync(dir,{recursive:true});const entries=read(key),existing=entries.find(x=>x.input.event_id===input.event_id||x.input.event_sequence===input.event_sequence);
  if(input.device_code&&entries.some(x=>x.input.device_code&&x.input.device_code!==input.device_code))throw Error('task-device-conflict');
  if(existing){if(hash(existing.input)!==hash(input))throw Error('task-event-conflict');const state=materialize(key);schedule(state);return response(state,true,input.event_sequence<state.latest.event_sequence);}
  atomic(path.join(dir,String(input.event_sequence).padStart(16,'0')+'.json'),{input,received_at:new Date().toISOString()});
  const state=materialize(key);schedule(state);if(writer&&autoStart)setImmediate(()=>drain());return response(state,false,input.event_sequence<state.latest.event_sequence);
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
 return {receive,drain,status:()=>({protocol:1,pending:pending.size,running,lastError,failed:errors.size,configured:!!writer}),close:()=>{closed=true;clearInterval(timer);}};
}
module.exports={createTaskLogStore,qualifies,validate,hash,atomic};
