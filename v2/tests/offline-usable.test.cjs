'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const {createServer}=require('../adapters/http/server.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {searchRecords,projectFacts}=require('../domain/aftersales/case-search.cjs');
const {createOfflineSessions}=require('../adapters/http/offline-session.cjs');
const {createFeishuLogs}=require('../external-services/feishu-logs.cjs');
const listen=async s=>{await new Promise(r=>s.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.address().port;};
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r);});
const fakeKnowledge={version:'synthetic',products:()=>[{modelId:'HD-Z100',documents:[{name:'Z100 V1.pdf',url:'/official-files/Z100%20V1.pdf'}]}],evidenceDocuments:()=>[],cases:()=>[
 {stableId:'case-a',recordType:'case',phenomenon:'Z100 闪屏',terms:['闪屏'],modelIds:['HD-Z100'],duplicateGroup:'a',scope:{softwareVersions:['1.0']},checks:[],verificationStatus:'reference_only',sourceExcerpt:'现象：闪屏。处理效果未记录。',historicalSolution:'核对配置',sourceReference:{file:'private/reference.json',locator:'第2段'}},
 {stableId:'case-b',recordType:'case',phenomenon:'Z100A 闪屏',terms:['闪屏'],modelIds:['HD-Z100A'],duplicateGroup:'b',scope:{},checks:[],sourceReference:{file:'private/reference.json'}}]};
test('No-model history browser preserves reference conditions and isolates suffix models',()=>{
 const api=createOfflineKnowledge({knowledge:fakeKnowledge});const r=api.searchCases('Z100 闪屏');assert.equal(r.results.length,1);assert.equal(r.results[0].id,'case-a');assert.equal(r.results[0].verificationStatus,'reference_only');assert.deepEqual(r.results[0].scope.softwareVersions,['1.0']);assert.equal(r.results[0].referenceOnly,true);assert.match(r.results[0].resultStatus,/不等于/);assert.equal(r.results[0].checks.length,0);
});
test('Offline pages and body search work without model tools; passage locations become real download links',async()=>{
 let calls=0;const upstream=http.createServer((req,res)=>{calls++;assert.ok(!req.url.includes('/chat'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({results:[{name:'Z100 V1.pdf',blockId:1,sha256:'a'.repeat(64),ordinal:2,text:'说明正文',locator:{page:1,cells:['internal author']},locations:[{id:7,path:'G:\\private\\file.pdf'}]}]}));});
 const source=await listen(upstream),s=createServer(undefined,{offlineKnowledge:createOfflineKnowledge({knowledge:fakeKnowledge,resourceBase:source})}),base=await listen(s);
 try{
  const html=await fetch(base+'/huiai').then(r=>r.text());assert.ok(html.includes('/v2/offline/client.js'));assert.ok(!html.includes('/v2/local-knowledge/client.js'));
  const data=await fetch(base+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json','X-V2-Offline-Knowledge':'text'},body:JSON.stringify({message:'Z100'})}).then(r=>r.json());
  assert.equal(data.model,'v2-offline-search');assert.equal(data.results[0].download,'/v2/offline/preview?id=7');assert.ok(!JSON.stringify(data).includes('G:'));assert.ok(!JSON.stringify(data).includes('internal author'));
  assert.equal((await fetch(base+'/v2/offline/read?block=../private')).status,400);
  assert.equal((await fetch(base+'/v2/offline/search?q=Z100',{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(base+'/v2/offline/search?q=')).status,400);
  assert.equal((await fetch(base+'/official-files/Z100%20V1.pdf')).status,404); // No exact actual file: never substitute another version.
  assert.equal((await fetch(base+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json','X-V2-Offline-Knowledge':'cases'},body:'{'})).status,400);
  assert.equal(calls,2);
 }finally{await close(s);await close(upstream);}
});
test('An unavailable original index does not break existing quick lookup or ordering',async()=>{
 const s=createServer(undefined,{offlineKnowledge:createOfflineKnowledge({knowledge:fakeKnowledge,resourceBase:'http://127.0.0.1:1'})}),base=await listen(s);
 try{assert.equal((await fetch(base+'/v2/offline/search?q=Z100')).status,503);const q=await fetch(base+'/api/search?q=A3L').then(r=>r.json());assert.ok(q.results.length);const order=await fetch(base+'/v2/ordering/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'配单 P2 模组160x80 40扫 HUB75 全彩 室内 同步接收卡 10宽8高 R716'})}).then(r=>r.json());assert.ok(order.result.bom.length);assert.equal((await fetch(base+'/v2/ordering/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({demand:{operation:'aftersales'}})})).status,400);}finally{await close(s);}
});
test('Explicit range, version, chip and denied conditions exclude contradictions without inventing missing facts',()=>{
 const source=fakeKnowledge.cases()[0];const cases=[{...source,stableId:'local',duplicateGroup:'local',sourceExcerpt:'现象：局部间歇闪屏\n最近操作：升级后出现',possibleCause:'电源故障',scope:{chips:['X100'],softwareVersions:['1.0']}},{...source,stableId:'whole',duplicateGroup:'whole',sourceExcerpt:'现象：整屏持续闪屏',scope:{chips:['X200'],softwareVersions:['2.0']}}];
 let r=searchRecords('闪屏',cases,{faultScope:['局部'],temporalPattern:['间歇'],chips:['X100'],softwareVersions:['1.0']});assert.deepEqual(r.results.map(x=>x.case.stableId),['local']);assert.equal(r.excluded,1);
 assert.equal(searchRecords('闪屏',cases,{deniedInformation:['电源故障']}).results.some(x=>x.case.stableId==='local'),false);
 assert.equal(projectFacts(cases[0]).originalCustomerExpression,null);assert.deepEqual(projectFacts(cases[0]).checkResults,[]);assert.ok(projectFacts(cases[0]).recentOperations.includes('升级后出现'));
 assert.equal(searchRecords('闪屏',cases,{}).results.length,2);
});
test('Session originals and user check results persist independently, including after reopening',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-sessions-'));try{const store=createOfflineSessions(dir);store.update('customer-a',{message:'原话保留',originalMessage:'完整原话与搜索词分别保存',facts:{chips:['X100']},checks:[{action:'重插',result:'无变化'}]});store.update('customer-b',{message:'另一客户',facts:{chips:['X200']}});const reopen=createOfflineSessions(dir);assert.equal(reopen.get('customer-a').messages[0].content,'完整原话与搜索词分别保存');assert.equal(reopen.get('customer-a').messages[0].query,'原话保留');assert.equal(reopen.get('customer-a').checks[0].result,'无变化');assert.deepEqual(reopen.get('customer-b').facts.chips,['X200']);assert.throws(()=>store.get('../private'),/invalid/);}finally{assert.ok(dir.startsWith(path.join(os.tmpdir(),'xhj-sessions-')));fs.rmSync(dir,{recursive:true,force:true});}
});
test('Actual reused bitable writer: local TXT, offline outbox, retry, dedup and partial update preserve manual fields',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-feishu-')),config=path.join(dir,'feishu.env');
 fs.writeFileSync(config,'FEISHU_SYNC_ENABLED=1\nFEISHU_APP_ID=synthetic\nFEISHU_APP_SECRET=synthetic\nFEISHU_APP_TOKEN=synthetic\nFEISHU_TABLE_ID=synthetic\nHUIDU_UPLOAD_KEY=synthetic');
 let fail=true,updates=[];const names=['APP版本','上报类型','日期','客户端时间','服务器接收时间','上传次数','日志附件','入库时间','发送型号','FPGA版本','应用版本','驱动芯片','接收卡型号','接收卡版本','HDSet版本','HDPlayer版本'];
 const ok=data=>({json:async()=>({code:0,data})});
 const fetchImpl=async(url,init)=>{if(fail)throw Error('simulated outage');if(url.includes('/tenant_access_token/'))return {json:async()=>({code:0,tenant_access_token:'synthetic',expire:7200})};if(url.includes('/fields?'))return ok({items:[{field_name:'记录',is_primary:true,type:1},...names.map(field_name=>({field_name,type:1}))]});if(url.includes('/upload_all'))return ok({file_token:'synthetic-attachment'});if(url.includes('/records/search'))return ok({items:[{record_id:'existing',fields:{人工备注:'保留'}}]});if(init.method==='PUT'){updates.push(JSON.parse(init.body));return ok({});}throw Error('unexpected mock request');};
 const logs=createFeishuLogs({directory:dir,configFile:config,fetchImpl,autoStart:false});
 try{const record={machine_id:'synthetic-machine',devKey:'synthetic-device',log_date:'2026-10-17',reason:'manual',content:'synthetic log',app_version:'build-test',device_app_version:'device-test',chips:'X100'};assert.equal(logs.receive(record).dedup,false);assert.equal(logs.receive(record).dedup,true);assert.equal(logs.status().pending,1);assert.equal(fs.readdirSync(path.join(dir,'txt')).length,1);await logs.drain();assert.equal(logs.status().pending,1);fail=false;await logs.drain();assert.equal(logs.status().pending,0);assert.equal(updates.length,1);assert.equal(updates[0].fields['驱动芯片'],'X100');assert.equal(updates[0].fields['应用版本'],'device-test');assert.equal(updates[0].fields['APP版本'],'build-test');assert.equal('人工备注' in updates[0].fields,false);assert.equal(logs.authorized('synthetic'),true);
 }finally{logs.close();fs.rmSync(dir,{recursive:true,force:true});}
});
