'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{randomUUID}=require('node:crypto');
const {validate,redact,createGraydeskReceiver,MAX_BYTES}=require('../external-services/graydesk-errors.cjs');
const sample=()=>({event_id:randomUUID(),occurred_at:new Date().toISOString(),software_version:'1.0.0',installation_id:randomUUID(),category:'no_progress',severity:'critical',stage:'auto_fill_code',remote_software:'ToDesk',stalled_seconds:31,exception_type:'ProgressTimeout',error_summary:'Automation stopped with no progress',stack_trace:'at Runner.Run in C:\\Users\\Alice\\src\\Runner.cs:line 48',log_excerpt:'operation stalled',repeat_count:1,execution_blocked:true,reason_code:'progress_timeout'});
async function fixture(t,{responseLoss=false,failWrite=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'graydesk-')),configFile=path.join(dir,'config.json');
 fs.writeFileSync(configFile,JSON.stringify({uploadKey:'synthetic-only-credential-at-least-32-bytes',appId:'synthetic',appSecret:'synthetic',appToken:'synthetic',tableId:'synthetic'}));
 const rows=[];let attempts=0,loss=responseLoss;
 const client={api:async(method,route,body)=>{if(route.endsWith('/records/search'))return {items:rows.filter(x=>x.fields['事件ID']===body.filter.conditions[0].value[0])};attempts++;if(failWrite)throw Error('synthetic-outage');const row={record_id:'rec'+rows.length,fields:body.fields};rows.push(row);if(loss){loss=false;throw Error('synthetic-response-loss');}return {record:row};}};
 let receiver=createGraydeskReceiver({configFile,directory:path.join(dir,'events'),client});
 const server=http.createServer((req,res)=>receiver.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const post=async(payload,headers={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/graydesk/errors',{method:'POST',headers:{authorization:'Bearer synthetic-only-credential-at-least-32-bytes','content-type':'application/json',...headers},body:typeof payload==='string'?payload:JSON.stringify(payload)});return {status:r.status,body:await r.json(),retry:r.headers.get('retry-after')};};
 return {post,rows,dir,attempts:()=>attempts,restart:()=>{receiver=createGraydeskReceiver({configFile,directory:path.join(dir,'events'),client});}};
}
test('qualifies only fatal software outcomes',()=>{
 assert.equal(validate(sample()).stalled_seconds,31);
 for(const category of ['crash','unexpected_exit','unhandled_exception'])assert.equal(validate({...sample(),category,stage:'process',reason_code:category==='crash'?'process_crash':category}).category,category);
 assert.equal(validate({...sample(),category:'operation_hang',stage:'recognition',reason_code:'operation_deadlock'}).category,'operation_hang');
 for(const patch of [{execution_blocked:false},{severity:'info'},{category:'offline'},{reason_code:'wrong_password'},{stalled_seconds:30},{stage:'process'},{screenshot:'forbidden'},{device_code:'forbidden'},{password:'forbidden'},{chat:'forbidden'},{installation_id:'host-name'},{event_id:'bad'},{occurred_at:'bad'},{stack_trace:{}},{repeat_count:0},{software_version:'C:\\Users\\Alice'},{remote_software:'user input'},{error_summary:'设备不在线'},{error_summary:'密码错误'},{error_summary:'对方拒绝'},{error_summary:'正常等待用户输入密码'},{error_summary:'waiting for authorization'}])assert.throws(()=>validate({...sample(),...patch}),JSON.stringify(patch));
});
test('privacy redacts username, credentials, IDs, chat, addresses and unlabelled numeric codes',()=>{
 const text=redact('C:\\Users\\Alice\\repo\\a.cs\n/home/bob/a\npassword = abcDEF\n设备码: 123456789\n聊天: hello\nmail x@y.com ip 192.168.1.2\ncode 123 456 789\nhttps://host/path?secret=hidden');
 for(const value of ['Alice','bob','abcDEF','123456789','hello','x@y.com','192.168.1.2','123 456 789','hidden'])assert.ok(!text.includes(value),value);
});
test('parallel duplicates, restart and manual-field preservation',async t=>{
 const f=await fixture(t),e=sample();const result=await Promise.all([f.post(e),f.post(e),f.post(e)]);
 assert.ok(result.every(r=>r.status===200&&r.body.ok));assert.equal(f.rows.length,1);assert.equal(f.attempts(),1);
 assert.equal(Object.keys(f.rows[0].fields).length,17);assert.ok(!f.rows[0].fields['异常堆栈'].includes('Alice'));
 f.rows[0].fields['处理状态']='已处理';f.rows[0].fields['处理备注']='人工备注';f.restart();assert.equal((await f.post(e)).body.status,'exists');assert.equal(f.rows[0].fields['处理备注'],'人工备注');assert.equal(f.rows[0].fields['重复次数'],1);
 assert.equal((await f.post({...e,error_summary:'changed event'})).status,409);
});
test('remote success with response loss returns 503 then recovers without a second write',async t=>{
 const f=await fixture(t,{responseLoss:true}),e=sample(),r=await f.post(e);assert.equal(r.status,503);assert.equal(r.body.ok,false);assert.equal(r.body.retryable,true);assert.equal(r.retry,'30');
 f.restart();assert.equal((await f.post(e)).body.status,'exists');assert.equal(f.rows.length,1);assert.equal(f.attempts(),1);
});
test('write failure never acknowledges success; auth/JSON/type/size checks leave no remote row',async t=>{
 const f=await fixture(t,{failWrite:true});assert.equal((await f.post(sample())).status,503);assert.equal(f.rows.length,0);
 assert.equal((await f.post(sample(),{authorization:'Bearer wrong'})).status,401);
 assert.equal((await f.post('{')).status,400);assert.equal((await f.post(sample(),{'content-type':'text/plain'})).status,415);
 assert.equal((await f.post('x'.repeat(MAX_BYTES+1))).status,413);assert.equal((await f.post({...sample(),account:'forbidden'})).status,422);
});
test('per-installation limit returns retry guidance',async t=>{const f=await fixture(t),e=sample();for(let i=0;i<10;i++)assert.equal((await f.post(e)).status,200);const r=await f.post(e);assert.equal(r.status,429);assert.equal(r.body.retryable,true);assert.equal(r.retry,'60');});
test('public HTTP and HTTPS permit the scoped authenticated POST',()=>{
 const {createLanGuard}=require('../adapters/http/lan-access.cjs');
 const run=origin=>{const headers={};let status;const res={writeHead:n=>{status=n;},end:()=>{},setHeader:(k,v)=>headers[k]=v};const req={url:'/api/graydesk/errors',method:'POST',headers:{host:'errors.example.test'},socket:{remoteAddress:'127.0.0.1'}};const allowed=createLanGuard({address:'192.168.1.2',cidr:'192.168.1.0/24',port:8520,publicOrigin:origin})(req,res);return {allowed,status};};
 assert.equal(run('http://errors.example.test').allowed,true);assert.equal(run('https://errors.example.test').allowed,true);
});
module.exports={sample};
