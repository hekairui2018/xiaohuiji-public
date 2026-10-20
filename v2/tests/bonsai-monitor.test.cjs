'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createCapture,redact}=require('../dev-monitor/capture.cjs'),{createMonitoredExpert}=require('../dev-monitor/expert.cjs'),{createMonitorHttp}=require('../dev-monitor/http.cjs');

test('disabled observer is identity-preserving and records nothing',async()=>{
 const capture=createCapture(),original={answer:async()=>({reply:'unchanged'})};const expert=createMonitoredExpert({capture,createExpert:()=>original});assert.equal(expert,original);assert.deepEqual(await expert.answer({}),{reply:'unchanged'});assert.equal(capture.list().length,0);
});
test('all model rounds, raw tools and final output are observed without modifying inputs or outputs',async()=>{
 const capture=createCapture({enabled:true}),sent=[];
 const createExpert=({transport,onDiagnostic})=>({status:async()=>({available:true}),answer:async input=>{
  const messages=[{role:'system',content:'real system fixture'},{role:'user',content:input.message}];
  for(let round=0;round<2;round++){const response=await transport(new URL('http://127.0.0.1:8080/v1/chat/completions'),{method:'POST',headers:{Authorization:'Bearer hidden'},body:JSON.stringify({messages,tools:[{name:'fixture-read'}]})});await response.json();if(round===0){const result=await input.execute('read_document',{blockId:1});messages.push({role:'tool',content:JSON.stringify(result)});onDiagnostic({event:'tool-result',cached:false});}}
  return {status:'answer',reply:'original final'};
 }});
 const expert=createMonitoredExpert({capture,createExpert,transport:async(url,options)=>{sent.push(options.body);return {ok:true,status:200,json:async()=>({choices:[{message:{content:'original reply'}}],usage:{total_tokens:5}})};}});
 const input={message:'question',sessionState:{id:'session-private',messages:[]},execute:async()=>({text:'full tool result',password:'hidden password'})};
 const result=await expert.answer(input);await capture.flush();assert.equal(result.reply,'original final');assert.equal(sent.length,2);const record=capture.get(capture.list()[0].id);
 assert.equal(record.events.filter(e=>e.type==='model.request').length,2);assert.equal(record.events.filter(e=>e.type==='model.response').length,2);assert.ok(record.events.some(e=>e.type==='tool.result'&&e.data.result.text==='full tool result'));assert.ok(record.events.some(e=>e.type==='assistant.final'));const serialized=JSON.stringify(record);assert.ok(!serialized.includes('hidden password'));assert.ok(!serialized.includes('Bearer hidden'));assert.equal(input.sessionState.id,'session-private');assert.equal(record.omitted,0);
});
test('privacy filter handles JSON inside messages, common credentials and personal fields',()=>{
 const result=redact({content:JSON.stringify({api_key:'SECRET',customerName:'个人姓名',phone:'13800138000',nested:{access_token:'TOKEN'}}),text:'API Key: ABC password=DEF 邮箱 a@b.cn 电话13800138000 联系人：张三',usage:{total_tokens:100}});const text=JSON.stringify(result);for(const secret of ['SECRET','个人姓名','13800138000','TOKEN','ABC','DEF','a@b.cn','张三'])assert.ok(!text.includes(secret),secret);assert.equal(result.usage.total_tokens,100);
});
test('existing expert loop records search, read and subsequent full requests across three rounds',async()=>{
 const capture=createCapture({enabled:true});
 const outputs=[{action:'search',query:'资料',kind:'text'},{action:'read',blockId:2},{action:'answer',claims:[{text:'原文记录',evidenceIds:['block-2']}],question:''}];
 const expert=createMonitoredExpert({capture,transport:async url=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(outputs.shift())}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})};
 }});
 const answer=await expert.answer({message:'请查资料',sessionState:{messages:[],facts:{},checks:[]},execute:async name=>({evidence:[{evidenceId:'block-2',blockId:2,name:'fixture.txt',text:'原文记录',readAvailable:true,readPerformed:name==='read_document'}]})});await capture.flush();assert.equal(answer.status,'answer');const record=capture.get(capture.list()[0].id),requests=record.events.filter(e=>e.type==='model.request'&&e.data.path==='/v1/chat/completions');assert.equal(requests.length,3);assert.equal(record.events.filter(e=>e.type==='tool.result').length,2);assert.ok(requests[1].data.payload.messages.some(m=>m.role==='user'&&m.content.includes('toolResult')));assert.ok(requests[2].data.payload.response_format.schema);assert.equal(record.omitted,0);
});
test('record and event limits are bounded and missing events are explicitly reported',async()=>{
 const capture=createCapture({enabled:true,maxRecords:2,maxEvents:2,maxEventBytes:1000,maxRecordBytes:3000,maxBytes:8000});for(let i=0;i<4;i++){await capture.run({message:'q'+i},async()=>{capture.event('large',{text:'x'.repeat(2000)});for(let n=0;n<4;n++)capture.event('item',{n});return {status:'answer'};});await capture.flush();}assert.equal(capture.list().length,2);assert.ok(capture.status().bytes<=8000);for(const r of capture.list()){assert.ok(r.omitted>0);assert.ok(r.eventCount<=2);}assert.ok(capture.status().dropped>0);
});
test('monitor endpoints are GET-only and reject forwarded or cross-origin access',async()=>{
 const capture=createCapture({enabled:true}),monitor=createMonitorHttp(capture),server=http.createServer((req,res)=>{if(!monitor.handle(req,res)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'/dev/bonsai')).status,200);assert.equal((await fetch(base+'/dev/bonsai/api/requests')).status,200);assert.equal((await fetch(base+'/dev/bonsai/api/requests',{method:'POST'})).status,405);for(const headers of [{'X-Forwarded-For':'10.0.0.2'},{Origin:'https://example.com'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(base+'/dev/bonsai/api/requests',{headers})).status,403);const wrongHost=await new Promise((resolve,reject)=>{http.get(base+'/dev/bonsai/api/requests',{headers:{Host:'external.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});assert.equal(wrongHost,403);assert.equal((await fetch(base+'/dev/bonsai/api/requests/not-retained')).status,404);}finally{await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
});
