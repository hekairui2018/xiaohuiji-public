'use strict';
// Reuse the shared bitable writer with isolated V2 config/storage; legacy mode stays compatible.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {mergeSnapshot}=require('../../backend/log-display.cjs');
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
 const enabled=cfg.FEISHU_SYNC_ENABLED==='1'&&writer.isConfigured();let running=false,lastError=null,lastSuccess=null;
 const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
 function receive(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.content!=='string'||input.content.length>900000)throw Error('invalid-log');
  const dev=String(input.devKey||input.machine_id||'');if(!dev||dev.length>160||!/^\d{4}-\d{2}-\d{2}$/.test(input.log_date||''))throw Error('invalid-log-identity');
  const id=digest(dev+'@'+input.log_date),file=path.join(directory,'records',id+'.json'),pending=path.join(directory,'outbox',id+'.json');
  const old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  const record={...old};for(const [k,v]of Object.entries(input))if(v!==null&&v!==undefined&&v!=='')record[k]=v;
  // Snapshot this upload, never inherit another run's before/after readings for presentation.
  record.site_display_snapshot=mergeSnapshot(input,old?.site_display_snapshot);
  record.machine_id=String(input.machine_id||old?.machine_id||dev);record.devKey=dev;
  const comparison={...record};for(const k of ['server_ts','upload_count','contentHash'])delete comparison[k];
  const hash=digest(JSON.stringify(Object.fromEntries(Object.entries(comparison).sort(([a],[b])=>a.localeCompare(b)))));
  if(old?.contentHash===hash)return {ok:true,dedup:true,sync:enabled?'queued-or-synced':'configuration-required'};
  record.contentHash=hash;record.server_ts=new Date().toISOString();record.upload_count=(old?.upload_count||0)+1;
  fs.writeFileSync(file+'.tmp',JSON.stringify(record));fs.renameSync(file+'.tmp',file);
  fs.writeFileSync(path.join(directory,'txt',id+'.txt'),record.content,'utf8');
  fs.writeFileSync(pending+'.tmp',JSON.stringify(record));fs.renameSync(pending+'.tmp',pending);
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
  return receive({machine_id:'v2-'+digest(event.sessionId||'local').slice(0,16),log_date:now.slice(0,10),client_ts:now,reason:'manual',app_version:'xiaohuiji-v2-offline',content:JSON.stringify(event)});}
 const timer=setInterval(()=>drain(),interval);timer.unref();
 if(enabled&&autoStart)setImmediate(()=>drain());
 return {receive,activity,drain,authorized:key=>!!cfg.HUIDU_UPLOAD_KEY&&typeof key==='string'&&key===cfg.HUIDU_UPLOAD_KEY,
  status:()=>({enabled,configured:writer.isConfigured(),pending:fs.readdirSync(path.join(directory,'outbox')).filter(x=>x.endsWith('.json')).length,running,lastSuccess,lastError,knowledgeSync:false}),close:()=>clearInterval(timer)};
}
module.exports={createFeishuLogs,loadWriter};
