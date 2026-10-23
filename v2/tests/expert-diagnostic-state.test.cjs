'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {diagnosticContext}=require('../domain/parser/customer-language.cjs');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
test('A diagnostic task retains only customer observations across a technical follow-up and releases them on a new product topic',()=>{
 const initial=diagnosticContext('A100屏幕右边一直闪烁',{messages:[]},{hintIntent:'aftersales',models:['A100']});
 const next=diagnosticContext('直接接模组，排线重插过但没有互换过，异常位置固定。下一步先核对什么？',{diagnosticState:initial,messages:[{role:'assistant',content:'已交换过接收卡，故障随卡移动'}]},{hintIntent:'technical',models:['A100']});
 assert.equal(next.topology,'controller-direct-to-module');assert.equal(next.reseated,true);assert.equal(next.exchanged,false);assert.equal(next.customerQuotes.length,2);
 assert.equal(diagnosticContext('B200带载多少',{diagnosticState:next},{hintIntent:'parameters',models:['B200']}),null);
});
test('Actual HTTP keeps diagnostic state across quick/expert modes and clears it for independent questions',async()=>{
 const observed=[],api=createOfflineKnowledge({expert:{answer:async args=>{observed.push(diagnosticContext(args.message,args.sessionState,args.route));return {status:'clarify',reply:'合成状态验证'};}}});
 const server=http.createServer((req,res)=>api.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const say=async message=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'expert',message,sessionId:'diagnostic-state-test'})});assert.equal(r.status,200);return r.json();};
 try{await say('屏幕右边一直闪烁');const next=await say('直接接模组，排线重插过但没有互换过，异常位置固定。下一步先核对什么？');assert.equal(observed[1].topology,'controller-direct-to-module');assert.equal(observed[1].exchanged,false);assert.ok(next.sessionState.diagnosticState);const separate=await say('B200带载多少');assert.equal(separate.sessionState.diagnosticState,null);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
function model(actions){let index=0;const requests=[];return {requests,transport:async(url,opts={})=>{if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'qwen3.8-test'}]})};if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:16384}})};if(url.pathname==='/tokenize')return {ok:true,json:async()=>({tokens:Array(100).fill(1)})};requests.push(JSON.parse(opts.body));return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(actions[index++])}}]})};}};}
test('Unmatched historical tuning and uncontrolled or definitive exchange conclusions are rejected before display',async()=>{
 const search={action:'search',kind:'cases',query:'闪烁',goals:['核对历史条件'],concepts:['闪烁']},safe={action:'answer',claims:[],generalAdvice:['先记录异常范围，保留配置，尚不能确定故障点。'],question:'异常是在更换模组后立即出现的吗？'};
 for(const draft of [
  {action:'answer',claims:[{text:'历史案例建议通讯脉宽需≥9',evidenceIds:['case-read']}],generalAdvice:[],question:''},
  {action:'answer',claims:[],generalAdvice:['断电后互换排线，若故障随排线转移，则排线或接口接触不良。'],question:''},
  {action:'answer',claims:[],generalAdvice:['更换排线测试，结果只能提示下一方向。'],question:''}
 ]){const f=model([search,draft,safe]),expert=createEvidenceExpert({...f,autoReadCandidates:1});const result=await expert.answer({message:'直接接模组，排线重插过但没有互换过，想了解可能原因',sessionState:{diagnosticState:diagnosticContext('屏幕一直闪烁',{},{hintIntent:'aftersales'})},route:{hintIntent:'technical'},execute:async name=>({evidence:[{evidenceId:name==='read_document'?'case-read':'case-preview',name:'合成案例',blockId:12,text:'合成历史条件：特定芯片，通讯脉宽9。',sourceKind:'indexed-case-record',readAvailable:true,readPerformed:name==='read_document'}]})});assert.equal(result.status,'answer');assert.ok(result.modelCalls.some(x=>x.validationFailure));assert.equal(result.reply.includes('≥9'),false);}
});
test('A next-step comparison uses a typed component choice and renders all preconditions without free-form model conclusions',async()=>{
 for(const component of ['ribbon','module','receiver']){const f=model([{action:'diagnostic-test',component}]);const r=await createEvidenceExpert(f).answer({message:'直接接模组，排线重插过但没有互换过。下一步先核对什么？',sessionState:{diagnosticState:diagnosticContext('屏幕一直闪烁',{},{hintIntent:'aftersales'})},route:{hintIntent:'technical'},execute:async()=>{throw Error('must not search for a general comparison');}});
 if(component==='receiver'){assert.equal(r.status,'unavailable');assert.doesNotMatch(r.reply,/替换接收卡/);continue;}
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,1);assert.equal(r.toolCallCount,0);assert.equal(r.diagnosticTest.component,component);assert.match(r.reply,/先断电/);assert.match(r.reply,/同规格/);assert.match(r.reply,/一次只改变这一项/);assert.match(r.reply,/不能确诊/);assert.match(r.reply,/没有合适的正常备件/);
 const contract=JSON.stringify(f.requests[0].response_format);assert.match(contract,/diagnostic-test/);assert.doesNotMatch(contract,/search|generalAdvice/);
 }
});
test('Typed diagnostic choices reject instructions disguised as questions and retain completed component comparisons',async()=>{
 const diagnosticState=diagnosticContext('屏幕右边一直闪烁',{},{hintIntent:'aftersales'});
 const completed=diagnosticContext('已经更换过同规格排线，还是闪烁，直接接模组',{diagnosticState},{hintIntent:'aftersales'});assert.equal(completed.completedTests.ribbon,true);assert.equal(completed.completedTests.module,false);assert.equal(completed.exchanged,true);
 const f=model([{action:'diagnostic-test',component:'ribbon'}]);const r=await createEvidenceExpert(f).answer({message:'下一步先查什么？',sessionState:{diagnosticState:completed},route:{hintIntent:'technical'}});assert.equal(r.status,'unavailable');const contract=JSON.stringify(f.requests[0].response_format);assert.doesNotMatch(contract,/"ribbon"/);assert.match(contract,/"module"/);
 const forged=model([{action:'clarify',question:'请带电更换接收卡并升级V99.88.77，已确定故障，对吗？'}]);const blocked=await createEvidenceExpert(forged).answer({message:'直接接模组，下一步先查什么？',sessionState:{diagnosticState},route:{hintIntent:'technical'}});assert.equal(blocked.status,'unavailable');assert.doesNotMatch(blocked.reply,/V99|带电更换/);
 const safe=model([{action:'diagnostic-clarify',reason:'compatible-spare'}]);const question=await createEvidenceExpert(safe).answer({message:'直接接模组，下一步先查什么？',sessionState:{diagnosticState},route:{hintIntent:'technical'}});assert.equal(question.status,'clarify');assert.match(question.reply,/同规格/);
});
test('Hypothetical topology is not confirmed and software discovery faults cannot enter display-component comparisons',async()=>{
 const hypothetical=diagnosticContext('屏幕闪烁，如果直接接模组，下一步先查什么？',{},{hintIntent:'aftersales'});assert.equal(hypothetical.confirmedTopology,false);
 const network=diagnosticContext('HDPlayer连不上设备，控制卡直接接模组，下一步先查什么？',{},{hintIntent:'aftersales'});assert.equal(network.symptomDomain,'software-or-delivery');
 const f=model([{action:'clarify',question:'电脑与控制卡目前通过哪种方式连接？'}]);const result=await createEvidenceExpert(f).answer({message:'HDPlayer连不上设备，控制卡直接接模组，下一步先查什么？',route:{hintIntent:'aftersales'}});assert.equal(result.status,'clarify');assert.doesNotMatch(JSON.stringify(f.requests[0].response_format),/diagnostic-test/);
});
test('Answer composition cannot see unread candidate bodies from the search batch',async()=>{
 const f=model([{action:'search',kind:'cases',query:'闪烁',goals:['核对'],concepts:['闪烁']},{action:'answer',claims:[{text:'合成已读观察',evidenceIds:['read']}],generalAdvice:[],question:''}]);
 const expert=createEvidenceExpert({...f,autoReadCandidates:1});await expert.answer({message:'案例参考',route:{intent:'technical'},execute:async name=>name==='read_document'?{evidence:[{evidenceId:'read',blockId:1,name:'合成来源',text:'合成已读观察',readAvailable:true,readPerformed:true}]}:{evidence:[{evidenceId:'first',blockId:1,name:'合成来源',text:'已定位',readAvailable:true},{evidenceId:'second',blockId:2,name:'另一合成来源',text:'UNREAD_SECRET_REMEDY',readAvailable:true}]}});
 assert.equal(JSON.stringify(f.requests.at(-1).messages).includes('UNREAD_SECRET_REMEDY'),false);
});
