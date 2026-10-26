'use strict';
// GrayDesk software-fatal errors only. Never store raw request bodies or credentials.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROUTE='/api/graydesk/errors',MAX_BYTES=65536;
const FIELDS={'事件ID':1,'发生时间':5,'接收时间':5,'软件版本':1,'匿名安装标识':1,'异常类别':1,'严重程度':1,'发生阶段':1,'涉及的远程软件':1,'停滞秒数':2,'异常类型':1,'错误摘要':1,'异常堆栈':1,'脱敏日志片段':1,'重复次数':2,'处理状态':1,'处理备注':1};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(code,status=422)=>{const e=Error(code);e.status=status;throw e;};
function redact(s){
 return s.replace(/(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|\/(?:Users|home)\/)[^\\/\s]+/gi,m=>m.replace(/[^\\/]+$/,'[USER]'))
  .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi,'[URL]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL]')
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[IP]')
  .replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi,'[MAC]')
  .replace(/\b(?=[A-Za-z0-9_+\/-]{24,}\b)(?=[A-Za-z0-9_+\/-]*\d)[A-Za-z0-9_+\/-]{24,}={0,2}/g,'[OPAQUE IDENTIFIER]')
  .replace(/\b\d(?:[ -]?\d){3,}\b/g,'[NUMBER]')
  // Entire sensitive lines are discarded, including quoted/JSON values and chat content.
  .split(/\r?\n/).map(line=>/(?:password|passwd|pwd|credential|token|secret|authorization|bearer|device[ _-]?(?:id|code)|remote[ _-]?id|account|username|user_name|chat|message[ _-]?content|clipboard|密码|口令|设备码|识别码|伙伴[码IＤID]|账号|帐号|聊天|对话内容|剪贴板|截图|data:image)/i.test(line)?'[REDACTED SENSITIVE LINE]':line).join('\n');
}
function validate(input){
 const keys=['event_id','occurred_at','software_version','installation_id','category','severity','stage','remote_software','stalled_seconds','exception_type','error_summary','stack_trace','log_excerpt','repeat_count','execution_blocked','reason_code'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))fail('unknown-or-forbidden-field');
 for(const k of ['event_id','installation_id'])if(typeof input[k]!=='string'||!uuid.test(input[k]))fail('invalid-'+k);
 if(typeof input.occurred_at!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.occurred_at)||!Number.isFinite(Date.parse(input.occurred_at))||Date.parse(input.occurred_at)>Date.now()+300000)fail('invalid-occurred_at');
 if(!['crash','unexpected_exit','unhandled_exception','no_progress','operation_hang'].includes(input.category))fail('not-software-fatal');
 if(!['fatal','critical'].includes(input.severity)||input.execution_blocked!==true)fail('not-software-fatal');
 const stages=['process','recognition','launch_client','auto_fill_code','password_input','automation'];
 if(!stages.includes(input.stage))fail('invalid-stage');
 const reasons=['process_crash','unexpected_exit','unhandled_exception','progress_timeout','operation_deadlock'];
 if(!reasons.includes(input.reason_code))fail('not-software-fatal');
 const expected={crash:'process_crash',unexpected_exit:'unexpected_exit',unhandled_exception:'unhandled_exception',no_progress:'progress_timeout',operation_hang:'operation_deadlock'};
 if(input.reason_code!==expected[input.category])fail('category-reason-mismatch');
 const stalled=input.stalled_seconds??0;
 if(!Number.isInteger(stalled)||stalled<0||stalled>604800)fail('invalid-stalled_seconds');
 if(input.category==='no_progress'&&(!['auto_fill_code','password_input'].includes(input.stage)||stalled<=30))fail('progress-timeout-must-exceed-30s');
 if(input.category==='operation_hang'&&!['recognition','launch_client','automation'].includes(input.stage))fail('invalid-hang-stage');
 if(!['none','ToDesk','Sunlogin','AnyDesk','TeamViewer','RustDesk','Other'].includes(input.remote_software))fail('invalid-remote_software');
 if(typeof input.software_version!=='string'||!/^\d{1,4}(?:\.\d{1,4}){1,3}(?:-[a-zA-Z0-9.]{1,24})?$/.test(input.software_version))fail('invalid-software_version');
 if(typeof input.exception_type!=='string'||!/^[-\w.$+`]{1,160}$/.test(input.exception_type))fail('invalid-exception_type');
 for(const [key,max]of [['error_summary',1000],['stack_trace',12000],['log_excerpt',8000]])if(typeof input[key]!=='string'||input[key].length>max||(key==='error_summary'&&!input[key].trim()))fail('invalid-'+key);
 if(!Number.isInteger(input.repeat_count??1)||(input.repeat_count??1)<1||(input.repeat_count??1)>1000000)fail('invalid-repeat_count');
 // Ordinary outcomes must never be upgraded into fatal errors by contradictory flags.
 if(/device[_ -]?offline|wrong[_ -]?password|password[_ -]?incorrect|peer[_ -]?rejected|waiting[_ -]?(?:for[_ -]?)?(?:user[_ -]?)?(?:password|authorization)|设备不在线|密码错误|对方拒绝|等待用户(?:输入密码|授权)|正常等待/i.test(input.error_summary))fail('ordinary-business-outcome');
 const out={...input,event_id:input.event_id.toLowerCase(),installation_id:input.installation_id.toLowerCase(),occurred_at:new Date(input.occurred_at).toISOString(),stalled_seconds:stalled,repeat_count:input.repeat_count??1};
 for(const key of ['error_summary','stack_trace','log_excerpt'])out[key]=redact(input[key]);
 return out;
}
function readConfig(file){if(!file||!fs.existsSync(file))return {};return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function createFeishuClient(cfg,{fetchImpl=fetch}={}){
 let cached=null;
 async function token(){if(cached&&cached.until>Date.now())return cached.token;const r=await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:cfg.appId,app_secret:cfg.appSecret}),signal:AbortSignal.timeout(10000)});const j=await r.json();if(!r.ok||j.code!==0||!j.tenant_access_token)throw Error('feishu-auth-failed');cached={token:j.tenant_access_token,until:Date.now()+Math.max(0,(j.expire-300))*1000};return cached.token;}
 async function api(method,route,body){const r=await fetchImpl('https://open.feishu.cn/open-apis/'+route,{method,headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});const j=await r.json();if(!r.ok||j.code!==0){if([99991663,99991664,99991668].includes(j.code))cached=null;throw Error('feishu-request-failed-'+(j.code??r.status));}return j.data;}
 return {api};
}
function createGraydeskReceiver({configFile,directory,client=null,now=Date.now}={}){
 const cfg=readConfig(configFile),configured=!!(cfg.uploadKey&&cfg.uploadKey.length>=32&&cfg.appId&&cfg.appSecret&&cfg.appToken&&cfg.tableId);
 const remote=client||(configured?createFeishuClient(cfg):null),base='bitable/v1/apps/'+cfg.appToken+'/tables/'+cfg.tableId;
 const buckets=new Map();let queue=Promise.resolve(),inflight=0;
 const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
 function allow(key,limit){const minute=Math.floor(now()/60000),entry=buckets.get(key);if(buckets.size>4096)for(const [k,v]of buckets)if(v.minute!==minute)buckets.delete(k);if(buckets.size>4096&&!entry)return false;const v=entry?.minute===minute?entry:{minute,count:0};v.count++;buckets.set(key,v);return v.count<=limit;}
 async function persist(event){
  const file=path.join(directory,event.event_id+'.json');fs.mkdirSync(directory,{recursive:true});
  let saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  const fingerprint=digest(JSON.stringify(event));
  if(saved&&saved.fingerprint!==fingerprint)fail('event-id-conflict',409);
  if(!saved){saved={fingerprint,event,received_at:new Date(now()).toISOString()};fs.writeFileSync(file+'.tmp',JSON.stringify(saved),{mode:0o600});fs.renameSync(file+'.tmp',file);}
  // Check remote identity on EVERY attempt, including response-loss/restart recovery.
  const found=await remote.api('POST',base+'/records/search',{filter:{conjunction:'and',conditions:[{field_name:'事件ID',operator:'is',value:[event.event_id]}]},page_size:2});
  if((found.items||[]).length>1)throw Error('duplicate-remote-events');
  let row=found.items?.[0],duplicate=!!row;
  if(row&&saved.record_id&&row.record_id!==saved.record_id)throw Error('remote-identity-conflict');
  if(!row){
   const e=saved.event,fields={'事件ID':e.event_id,'发生时间':Date.parse(e.occurred_at),'接收时间':Date.parse(saved.received_at),'软件版本':e.software_version,'匿名安装标识':e.installation_id,'异常类别':e.category,'严重程度':e.severity,'发生阶段':e.stage,'涉及的远程软件':e.remote_software,'停滞秒数':e.stalled_seconds,'异常类型':e.exception_type,'错误摘要':e.error_summary,'异常堆栈':e.stack_trace,'脱敏日志片段':e.log_excerpt,'重复次数':e.repeat_count,'处理状态':'待处理','处理备注':''};
   // Stable UUIDv4 idempotency key plus serialized writes protect response-loss races.
   row=(await remote.api('POST',base+'/records?client_token='+e.event_id,{fields})).record;
   if(!row?.record_id)throw Error('missing-record-confirmation');
  }
  saved.record_id=row.record_id;fs.writeFileSync(file+'.tmp',JSON.stringify(saved),{mode:0o600});fs.renameSync(file+'.tmp',file);
  return {ok:true,event_id:event.event_id,status:duplicate?'exists':'written',retryable:false};
 }
 async function handle(req,res){
  if(req.url.split('?')[0]!==ROUTE)return false;
  const send=(status,body,retry)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(retry?{'Retry-After':String(retry)}:{})});res.end(JSON.stringify(body));};
  const error=(status,code,retry=false,after)=>send(status,{ok:false,error:code,retryable:retry},after);
  if(req.method!=='POST'){res.setHeader('Allow','POST');error(405,'method-not-allowed');return true;}
  if(!configured){error(503,'receiver-not-configured',true,60);return true;}
  // Never trust X-Forwarded-For supplied by a client; source comes from the socket.
  if(!allow('ip:'+req.socket.remoteAddress,120)){error(429,'rate-limited',true,60);return true;}
  const supplied=String(req.headers.authorization||'');const a=Buffer.from(supplied),b=Buffer.from('Bearer '+cfg.uploadKey);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){error(401,'invalid-credential');return true;}
  if(!allow('credential',60)){error(429,'rate-limited',true,60);return true;}
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')){error(415,'json-required');return true;}
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity'){error(415,'compression-not-supported');return true;}
  if(Number(req.headers['content-length'])>MAX_BYTES){error(413,'request-too-large');return true;}
  try{
   const chunks=[];let size=0;let expired=false;const timer=setTimeout(()=>{expired=true;error(408,'request-timeout',true,30);req.destroy();},10000);timer.unref();
   try{for await(const c of req){size+=c.length;if(size>MAX_BYTES){error(413,'request-too-large');return true;}chunks.push(c);}}finally{clearTimeout(timer);}
   if(expired)return true;
   let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('invalid-json',400);}
   const event=validate(input);
   if(!allow('installation:'+event.installation_id,10)){error(429,'installation-rate-limited',true,60);return true;}
   if(inflight>=16){error(503,'receiver-busy',true,30);return true;}
   inflight++;const task=queue.then(()=>persist(event));queue=task.catch(()=>{});
   try{send(200,await task);}finally{inflight--;}
  }catch(e){if(e.status)error(e.status,e.message);else error(503,'storage-unavailable',true,30);}
  return true;
 }
 return {handle,configured};
}
module.exports={ROUTE,MAX_BYTES,FIELDS,validate,redact,createFeishuClient,createGraydeskReceiver};
