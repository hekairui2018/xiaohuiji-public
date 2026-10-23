'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {interpretCustomerText}=require('../domain/parser/customer-language.cjs');
const {answerGuidance}=require('../domain/knowledge/answer-guidance.cjs');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const {createPublicChat}=require('../adapters/http/public-chat.cjs');
test('Homophones are interpretations, preserving exact identifiers, measurements, quotes and filenames',()=>{
 const original='R512S 接受卡 分辩率1600×800，固件V1.2，ICN2153，代栽多少；“接受卡” 固健.bin';
 const r=interpretCustomerText(original);assert.equal(r.original,original);assert.equal(r.query,'R512S 接收卡 分辨率1600×800，固件V1.2，ICN2153，带载多少；“接受卡” 固健.bin');assert.equal(r.corrections.length,3);
 assert.equal(interpretCustomerText('R7I2 R712S ICN2153P 1600×800 P2').query,'R7I2 R712S ICN2153P 1600×800 P2');
});
test('Fast answers recommend expert analysis on complexity, never on a completed simple resource lookup',()=>{
 assert.equal(answerGuidance({original:'资料'}, {intent:'resources',answerType:'resource-evidence',results:[{}]}).expertSuggestion,null);
 for(const intent of ['aftersales','compatibility','feedback','technical'])assert.equal(answerGuidance({original:'问题'}, {intent}).expertSuggestion.recommended,true);
 assert.match(answerGuidance({original:'问题'}, {answerType:'multiple-actions'}).expertSuggestion.message,/上文/);
});
function model(outputs,extra={}){const calls=[];return {...extra,calls,transport:async(url,options)=>{
 if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'qwen3.8-flash-next-gyro-m-tq2_0'}]})};
 if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:16384}})};
 if(url.pathname==='/tokenize')return {ok:true,json:async()=>({tokens:new Array(1000).fill(0)})};
 calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(typeof outputs==='function'?outputs(calls.length):outputs.shift())}}]})};
 }};}
test('Current Strata model uses schema protocol and a bounded answer budget',async()=>{
 const f=model([{action:'answer',claims:[{text:'最大带载26万点',evidenceIds:['ref']}],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'R712带载多少',route:{models:['HD-R712']},execute:async()=>({evidence:[{evidenceId:'ref',text:'最大带载26万点'}]})});
 assert.equal(r.status,'answer');assert.equal(f.calls[0].response_format.type,'json_schema');assert.equal(f.calls[0].max_tokens,2048);
});
test('Invalid draft is repaired once, unsupported numbers never reach the customer',async()=>{
 const f=model([{action:'answer',claims:[{text:'最大带载999万点',evidenceIds:['ref']}],question:''},{action:'answer',claims:[{text:'最大带载26万点',evidenceIds:['ref']}],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'R712带载多少',route:{models:['HD-R712']},execute:async()=>({evidence:[{evidenceId:'ref',text:'最大带载26万点'}]})});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.ok(!r.reply.includes('999'));assert.equal(r.modelCalls[0].validationFailure,'expert-unsupported-number');
});
test('Total capacity cannot be relabelled as per-port capacity even with a valid citation',async()=>{
 const f=model(()=>({action:'answer',claims:[{text:'每个网口带载26万点',evidenceIds:['ref']}],question:''}));
 const r=await createEvidenceExpert(f).answer({message:'R712带载多少',route:{models:['HD-R712']},execute:async()=>({evidence:[{evidenceId:'ref',text:'整卡最大带载26万点'}]})});
 assert.equal(r.status,'unavailable');assert.equal(r.error,'expert-unsupported-scope');assert.equal(r.modelCallCount,2);assert.ok(!r.reply.includes('每个网口带载26'));
});
test('A model ignoring finish instructions cannot create an unbounded search loop',async()=>{
 const f=model(n=>({action:'search',query:'topic '+n,kind:'text'}),{maxModelCalls:4,maxToolCalls:2});let tools=0;
 const r=await createEvidenceExpert(f).answer({message:'复杂问题',execute:async()=>{tools++;return {evidence:[]}}});
 assert.equal(tools,2);assert.equal(r.error,'expert-tool-limit');assert.equal(r.modelCallCount,3);
 const choices=f.calls.at(-1).response_format.json_schema.schema.oneOf;assert.deepEqual(choices.map(c=>c.properties.action.const),['answer','clarify']);
});
test('Fast task context and verbatim customer history reach the expert with correction provenance',async()=>{
 const taskState={version:1,activeId:'task-1',tasks:[{id:'task-1',type:'ordering',ordering:{confirmed:{screen:{pixelWidth:1600,pixelHeight:800}}}}]};
 const f=model([{action:'finish'},{action:'answer',claims:[],generalAdvice:[],question:'需要同步还是异步播放？'}]);
 const r=await createEvidenceExpert(f).answer({message:'接受卡怎么选',sessionState:{taskState,messages:[{role:'user',content:'P2整屏分辨率1600×800'}]},execute:async()=>({evidence:[]})});
 assert.equal(r.status,'clarify');const input=JSON.parse(f.calls[0].messages[1].content);assert.equal(input.taskContext.confirmed.screen.pixelWidth,1600);assert.equal(input.taskContext.activeId,'task-1');assert.equal(input.message,'接受卡怎么选');assert.equal(input.interpretation.query,'接收卡怎么选');assert.equal(input.history[0].content,'P2整屏分辨率1600×800');
});
test('Public parameter search falls back to verified pages when another product has indexed claims',async()=>{
 const a='a'.repeat(64),b='b'.repeat(64),names=['R712规格书.pdf','R716规格书.pdf'];
 const catalog={approvedResources:()=>names.map(name=>({name,url:'https://example.test/'+encodeURIComponent(name)})),transform:x=>x};
 const ref={originalName:names[0],originalSha256:a};
 const products=names.map((name,i)=>({modelId:i?'HD-R716':'HD-R712',displayName:i?'R716':'R712',aliases:[],documents:[{name,kind:'spec'}],claims:i?[]:[{claimId:'first',text:'R712带载26万点',sourceReference:ref}]}));
 let count=0;const expert={answer:async({execute})=>{const found=await execute('search_evidence',{query:'R716带载',kind:'products'});count=found.evidence.length;assert.ok(found.evidence.every(e=>e.name===names[1]));return {status:'answer',reply:'已核对',actualMode:'expert',results:found.evidence};}};
 const chat=createPublicChat({app:{quickBrowse:()=>products},knowledge:{evidenceDocuments:()=>names.map((name,i)=>({document:{name,sha256:i?b:a,pages:[{page:1,text:(i?'R716':'R712')+'带载26万点'}]}}))},catalog,expert,verifiedDocuments:names.map((name,i)=>({name,sha256:i?b:a}))});
 const r=await chat.answer({message:'R716带载多少',mode:'expert'});assert.ok(count>0);assert.equal(r.body.results[0].location,'页 1');assert.equal(r.body.results[0].sha256,undefined);
});

test('Quoted text and document names across office formats remain exact',()=>{
 for(const text of ['固健.txt','接受卡.docx','分辩率.xlsx','代栽.pptx',"'接受卡'",'‘分辩率’','『固健』'])assert.equal(interpretCustomerText(text).query,text);
});
test('Different parameter conditions remain visible rather than being silently discarded',()=>{
 const {conciseParameters}=require('../domain/knowledge/answer-guidance.cjs');
 const rows=[1,2,3].map(n=>({modelIds:['HD-R712'],field:'load',documentVersion:'V1',text:'带载'+n+'万点',conditions:['扫描'+n]}));assert.equal(conciseParameters(rows).length,3);
});
test('Authorized candidate reading prepares context before answering without a second model planning round',async()=>{
 const f=model([{action:'search',query:'局部闪烁',kind:'cases'},{action:'answer',claims:[{text:'原记录处理后恢复',evidenceIds:['read']}],question:''}],{autoReadCandidates:2});const seen=[];
 const r=await createEvidenceExpert(f).answer({message:'局部闪烁先查哪里',execute:async(name)=>{seen.push(name);return name==='search_evidence'?{evidence:[{evidenceId:'candidate',name:'合成案例',text:'原记录',blockId:3,readAvailable:true}]}:{evidence:[{evidenceId:'read',name:'合成案例',text:'原记录处理后恢复',blockId:3,readPerformed:true}]};}});
 assert.equal(r.status,'answer');assert.deepEqual(seen,['search_evidence','read_document']);assert.equal(r.modelCallCount,2);assert.ok(r.toolTrace.some(t=>t.purpose==='retrieved-context-prefetch'));
});
test('Protocol failure gets one correction while invalid actions never execute',async()=>{
 const f=model([{action:'finish'},{action:'answer',claims:[],generalAdvice:['当前只能确认已提供的现象，具体原因仍需核查。'],question:''}]);const base=f.transport;let failures=0;f.transport=async(url,options)=>{
 if(url.pathname==='/v1/chat/completions'&&failures++===0)return {ok:false,status:502,json:async()=>({error:{code:'structured_output_failed',message:'required field missing'}})};return base(url,options);};
 const r=await createEvidenceExpert(f).answer({message:'现象咨询',execute:async()=>{throw Error('must not execute');}});assert.equal(r.status,'answer');assert.equal(r.modelCallCount,3);assert.equal(r.modelCalls[0].recovery,'schema-contract');
});

test('Unverified definitive diagnoses are repaired rather than exposed as customer advice',async()=>{
 const f=model([{action:'finish'},{action:'answer',claims:[],generalAdvice:['异常随模组移动，则确认为模组硬件故障。'],question:''},{action:'answer',claims:[],generalAdvice:['若异常随模组移动，可优先核查模组相关因素；具体原因仍需验证。'],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'交叉测试怎么看',execute:async()=>({evidence:[]})});assert.equal(r.status,'answer');assert.ok(!r.reply.includes('确认为'));assert.equal(r.modelCalls[1].validationFailure,'expert-unverified-diagnosis');
});
test('Public category followup retains the product and offers approved signed originals',async()=>{
 const sha='c'.repeat(64),name='R712规格书_已签章.pdf',ref={originalName:name,originalSha256:sha,verificationStatus:'verified',page:1};
 const product={modelId:'HD-R712',displayName:'R712',aliases:['R712'],documents:[{name,sha256:sha,kind:'spec'}],claims:[{claimId:'capacity',text:'最大带载26万点',field:'load',verificationStatus:'verified',sourceReference:ref}]};
 const catalog={approvedResources:()=>[{name,url:'https://example.test/spec.pdf'}],transform:x=>x};
 const chat=createPublicChat({app:{quickBrowse:()=>[product]},knowledge:{evidenceDocuments:()=>[{document:{name,sha256:sha,pages:[{page:1,text:'HD-R712 最大带载26万点'}]}}]},catalog,verifiedDocuments:[{name,sha256:sha}]});
 const first=await chat.answer({message:'R712带载多少'});const next=await chat.answer({message:'规格书',conversationId:first.body.conversationId});assert.match(next.body.reply,/HD-R712/);assert.match(next.body.reply,/找到对应资料/);assert.equal(next.body.results.length,1);assert.equal(next.body.results[0].name,name);
});

test('Reseating is never recorded as an exchange test, including explicitly unperformed checks',()=>{
 const {diagnosticContext}=require('../domain/parser/customer-language.cjs');const route={hintIntent:'aftersales'};
 const a=diagnosticContext('排线重插过，异常位置固定，还没有交换过模组',{messages:[]},route);assert.equal(a.reseated,true);assert.equal(a.exchanged,false);assert.equal(a.confirmedTopology,false);
 const b=diagnosticContext('外接R712接收卡，已交换过模组，异常未跟随',{messages:[]},route);assert.equal(b.confirmedTopology,true);assert.equal(b.exchanged,true);
});
test('Advice cannot assume independent receiver cards when customer topology is unknown',async()=>{
 const f=model([{action:'finish'},{action:'answer',claims:[],generalAdvice:['把左右接收卡互换测试。'],question:'结果怎样？'},{action:'answer',claims:[],generalAdvice:['先保留当前接线，核对异常范围及近期更换情况。'],question:'控制卡是直接接模组，还是外接独立接收卡？'}]);
 const r=await createEvidenceExpert(f).answer({message:'局部异常',route:{hintIntent:'aftersales'},execute:async()=>({evidence:[]})});assert.equal(r.status,'answer');assert.equal(r.modelCalls[1].validationFailure,'expert-unknown-topology');assert.match(r.question,/直接接模组/);
});

test('A provided but unregistered name survives a scoped procedural request as an unverified clue',()=>{
 const lookup={findProducts:()=>[],products:()=>[],softwareItems:()=>[],isSoftware:()=>false};
 const q=require('../domain/knowledge/quick-query.cjs').parseQuickQuery('使用Z93调试时，网口串线方式有什么需要注意？',lookup);
 assert.deepEqual(q.models,[]);assert.ok(q.unknownModels.includes('Z93'));
});

test('Successful software discovery does not steal a reported hardware fault, and gray-level aliases retain parameter intent',()=>{
 const {chatIntent}=require('../domain/parser/chat-intent.cjs'),lookup={findProducts:()=>[],isSoftware:s=>/^HDPlayer$/i.test(s),products:()=>[]};
 for(const ending of ['','。先查哪里？']){const text='C16L右边几排颜色不正常且闪烁，HDPlayer能找到设备且节目发送成功，前两天换过模组'+ending;
 const fault=chatIntent(text,lookup);assert.equal(fault.intent,'aftersales');assert.equal(require('../domain/knowledge/quick-query.cjs').parseQuickQuery(text,lookup).intent,'aftersales');}
 for(const field of ['灰阶','灰度等级','灰度级'])assert.equal(chatIntent('R712'+field,lookup).intent,'parameters');
});
