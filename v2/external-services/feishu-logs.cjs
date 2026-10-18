'use strict';
// Reuse the shared bitable writer with isolated V2 config/storage; legacy mode stays compatible.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {mergeSnapshot}=require('../../backend/log-display.cjs');
const {createTaskLogStore,atomic}=require('./task-log-store.cjs');
const {createFeishuTaskWriter}=require('./feishu-task-writer.cjs');
function readConfig(file){const out={};if(file&&fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);if(m)out[m[1]]=m[2].replace(/^["']|["']$/g,'');}return out;}
function loadWriter({directory,configFile,fetchImpl=fetch}){
 const dirname=path.join(directory,'writer'),envFile=path.join(dirname,'.env');
 const fsView={...fs,existsSync:p=>path.resolve(p)===envFile?!!configFile&&fs.existsSync(configFile):fs.existsSync(p),
  readFileSync:(p,...args)=>path.resolve(p)===envFile?fs.readFileSync(configFile,...args):fs.readFileSync(p,...args)};
 const source=path.resolve(__dirname,'../../backend/feishu-bitable.cjs'),context={module:{exports:{}},__dirname:dirname,Buffer,FormData,Blob,console,
  require:name=>name==='fs'?fsView:require('node:module').createRequire(source)(name),fetch:(url,options={})=>fetchImpl(url,{...options,signal:AbortSignal.timeout(15000)})};
 // The actual module is reused, not copied or string-rewritten. Its private ENV/TXT_DIR
 // resolve only inside this context; V1 .env, files, globals and token cache stay untouched.
 vm.runInNewContext(fs.readFileSync(source,'utf8'),context,{filename:'feishu-bitable.cjs'});return context.module.exports;
}
function createFeishuLogs({directory,configFile,fetchImpl,interval=60000,autoStart=true}={}){
 directory=path.resolve(directory);for(const sub of ['records','outbox','txt'])fs.mkdirSync(path.join(directory,sub),{recursive:true});
 const cfg=readConfig(configFile),writer=loadWriter({directory,configFile,fetchImpl});
 const taskLogs=createTaskLogStore({directory:path.join(directory,'tasks'),writer:createFeishuTaskWriter({cfg,getTenantToken:writer.getTenantToken,fetchImpl}),autoStart,interval});
 const enabled=cfg.FEISHU_TASK_PROTOCOL_ONLY!=='1'&&cfg.FEISHU_SYNC_ENABLED==='1'&&writer.isConfigured(),machineOnly=cfg.FEISHU_LOG_MACHINE_ONLY==='1',appendOnly=!machineOnly&&cfg.FEISHU_LOG_APPEND_ONLY==='1';let running=false,lastError=null,lastSuccess=null;
 const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
 function businessHash(record){
  const value={...record};
  for(const k of ['server_ts','client_ts','upload_count','contentHash','businessHash','receiver_upload_id','sha1','size','reason'])delete value[k];
  // Transport acknowledgements are not new equipment facts or failure evidence.
  value.content=String(value.content||'').split(/\r?\n/).filter(line=>!/^\d{2}:\d{2}:\d{2}\.\d+\s+(?:【操作】)?日志回传\([^\r\n)]*\)[：:]/.test(line)).join('\n').trimEnd();
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  return digest(JSON.stringify(stable(value)));
 }
 function receive(input){
  if(input?.task_protocol!==undefined)return taskLogs.receive(input);
  // When explicitly enabled, unqualified legacy packets remain a local archive only.
  if(cfg.FEISHU_TASK_PROTOCOL_ONLY==='1'){
   if(!input||typeof input.content!=='string'||input.content.length>900000)throw Error('invalid-log');
   const archive=path.join(directory,'legacy-unqualified');fs.mkdirSync(archive,{recursive:true});
   atomic(path.join(archive,digest(JSON.stringify(input))+'.json'),input);
   return {ok:true,accepted:true,durable:true,sync:'not-qualified',success_qualified:false};
  }
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.content!=='string'||input.content.length>900000)throw Error('invalid-log');
  const appendRecord=appendOnly;
  const dev=String(machineOnly?input.machine_id||'':input.devKey||input.machine_id||'');if(!dev||dev.length>160||!/^\d{4}-\d{2}-\d{2}$/.test(input.log_date||''))throw Error('invalid-log-identity');
  const senderIdentity=String(input.device_code||(input.devKey&&input.devKey!==input.machine_id?input.devKey:'')||'');
  const identity=machineOnly?JSON.stringify([dev,senderIdentity,input.log_date]):dev+'@'+input.log_date;
  const id=appendRecord?digest(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b))))):digest(identity),file=path.join(directory,'records',id+'.json'),pending=path.join(directory,'outbox',id+'.json');
  const old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  if(machineOnly){const archive=path.join(directory,'archive');fs.mkdirSync(archive,{recursive:true});const receipt=digest(JSON.stringify(input));fs.writeFileSync(path.join(archive,receipt+'.json'),JSON.stringify(input));}
  if(appendRecord&&old)return {ok:true,dedup:true,sync:enabled?'queued-or-synced':'configuration-required'};
  const record=appendOnly||machineOnly?{}:{...old};for(const [k,v]of Object.entries(input))if(v!==null&&v!==undefined&&v!=='')record[k]=v;
  // Snapshot this upload, never inherit another run's before/after readings for presentation.
  record.site_display_snapshot=mergeSnapshot(input,appendOnly||machineOnly?undefined:old?.site_display_snapshot);
  record.machine_id=String(input.machine_id||old?.machine_id||dev);record.devKey=machineOnly?String(input.devKey||dev):dev;
  if(machineOnly){record.businessHash=businessHash(record);if(old&&record.businessHash===(old.businessHash||businessHash(old)))return {ok:true,dedup:true,sync:enabled?'queued-or-synced':'configuration-required'};}
  const comparison={...record};for(const k of ['server_ts','upload_count','contentHash'])delete comparison[k];
  const hash=digest(JSON.stringify(Object.fromEntries(Object.entries(comparison).sort(([a],[b])=>a.localeCompare(b)))));
  if(old?.contentHash===hash)return {ok:true,dedup:true,sync:enabled?'queued-or-synced':'configuration-required'};
  record.contentHash=hash;record.server_ts=new Date().toISOString();record.upload_count=(old?.upload_count||0)+1;
  if(appendRecord)record.receiver_upload_id=id;
  if(!appendRecord){fs.writeFileSync(file+'.tmp',JSON.stringify(record));fs.renameSync(file+'.tmp',file);}
  fs.writeFileSync(path.join(directory,'txt',id+'.txt'),record.content,'utf8');
  fs.writeFileSync(pending+'.tmp',JSON.stringify(record));fs.renameSync(pending+'.tmp',pending);
  // In append mode, the receipt exists only after TXT and retry queue are durable.
  if(appendRecord){fs.writeFileSync(file+'.tmp',JSON.stringify(record));fs.renameSync(file+'.tmp',file);}
  if(enabled&&autoStart)setImmediate(()=>drain());return {ok:true,dedup:false,sync:enabled?'queued':'configuration-required'};
 }
 async function drain(){if(running||!enabled)return {skipped:true};running=true;let completed=0;
  try{for(const name of fs.readdirSync(path.join(directory,'outbox')).filter(x=>x.endsWith('.json')).slice(0,50)){
   const file=path.join(directory,'outbox',name),record=JSON.parse(fs.readFileSync(file,'utf8'));
   try{const out=await writer.syncHuiduRecord(record);if(out.action==='skipped')continue;
    const current=JSON.parse(fs.readFileSync(file,'utf8'));if(current.contentHash===record.contentHash)fs.unlinkSync(file);
    lastSuccess=new Date().toISOString();lastError=null;completed++;
   }catch(e){lastError={time:new Date().toISOString(),type:e.code||'sync-failed'};break;}
  }}catch{lastError={time:new Date().toISOString(),type:'outbox-read-failed'};}finally{running=false;}return {completed};
 }
 function activity(event){const now=new Date().toISOString();fs.appendFileSync(path.join(directory,'activity.jsonl'),JSON.stringify({time:now,...event})+'\n');
  // Website/request diagnostics are local records, never assistant uploads.
  return {ok:true,storedLocally:true,sync:'not-applicable'};}
 const timer=setInterval(()=>drain(),interval);timer.unref();
 if(enabled&&autoStart)setImmediate(()=>drain());
 return {receive,activity,drain:async()=>{const legacy=await drain(),tasks=await taskLogs.drain();return {completed:(legacy.completed||0)+(tasks.completed||0),legacy,tasks};},authorized:key=>!!cfg.HUIDU_UPLOAD_KEY&&typeof key==='string'&&key===cfg.HUIDU_UPLOAD_KEY,
  status:()=>{const tasks=taskLogs.status(),legacyPending=fs.readdirSync(path.join(directory,'outbox')).filter(x=>x.endsWith('.json')).length;return {enabled:enabled||tasks.configured,configured:writer.isConfigured(),appendOnly,machineOnly,pending:legacyPending+tasks.pending,legacyPending,running:running||tasks.running,lastSuccess,lastError:lastError||tasks.lastError,knowledgeSync:false,tasks};},close:()=>{clearInterval(timer);taskLogs.close();}};
}
module.exports={createFeishuLogs,loadWriter};
