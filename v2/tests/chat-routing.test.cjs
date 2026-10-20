'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chatIntent,expertIntent}=require('../domain/parser/chat-intent.cjs');
const {createQuickAnswer}=require('../adapters/http/quick-answer.cjs');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const lookup={findProducts:id=>['HD-C16L','HD-R512','HD-R512S'].includes(id)?[{modelId:id}]:[]};
test('Speech acts consume the whole input; suffixes, resource kinds, fault and ordering remain distinct',()=>{
 for(const text of ['你好','谢谢！','你能做什么'])assert.equal(chatIntent(text,lookup).intent,'social');
 assert.equal(chatIntent('你好，C16L说明书',lookup).intent,'resources');
 assert.deepEqual(chatIntent('R512S 和 R512 固件能通用吗',lookup).models,['HD-R512S','HD-R512']);
 assert.equal(chatIntent('C16L右边几排颜色异常且闪烁',lookup).intent,'aftersales');
 assert.equal(chatIntent('屏幕显示正常但搜不到 Wi-Fi',lookup).intent,'aftersales');
 assert.equal(chatIntent('P10 全彩屏用什么控制卡',lookup).demand.operation,'ordering');
 assert.equal(chatIntent('R512硬件V1.2固件',lookup).hardwareRequested,true);
 assert.equal(chatIntent('完全没有公司资料的事物',lookup).intent,'clarify');
});
test('Social and ambiguous quick inputs perform zero index calls; faults never fall through to raw text',async()=>{
 let scans=0,cases=0;const qa=createQuickAnswer({knowledge:{findProducts:lookup.findProducts},search:async()=>{scans++;return {results:[]};},searchCases:()=>{cases++;return {results:[]};}});
 for(const text of ['你好','谢谢','我想了解某个不明事物']){const r=await qa.answer(qa.classify(text));assert.equal(r.results.length,0);}
 assert.equal(scans,0);await qa.answer(qa.classify('屏幕显示正常但搜不到Wi-Fi'));assert.equal(cases,1);assert.equal(scans,0);
 const rows=[{name:'R512S',text:'HD-R512S 扫描方式设置'},{name:'R512',text:'HD-R512 扫描方式设置'},{name:'无关文档',text:'设置你好文字'}];
 assert.deepEqual(qa.filter('R512扫描方式',rows,['HD-R512']).map(r=>r.name),['R512']);
 assert.equal(qa.filter('LED灰阶异常测试',rows,[]).length,0);
 const hardware=await qa.answer(qa.classify('R512硬件V1.2固件'));assert.equal(hardware.status,'clarify');assert.equal(hardware.results.length,0);assert.equal(scans,0);
});
function fake(outputs){const calls=[];return {calls,transport:async(url,init)=>{if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic-bonsai'}]})};calls.push(JSON.parse(init.body));const item=outputs.shift();return {ok:true,status:200,json:async()=>({choices:[{message:{content:typeof item==='string'?item:JSON.stringify(item)},finish_reason:'stop'}],usage:{completion_tokens:10}})};}};}
test('Strata receives its supported schema envelope with expanded visible output budgets and the same citation constraints',async()=>{
 const f=fake([{action:'search',query:'C16L闪烁',kind:'cases'},{action:'finish'},{action:'answer',claims:[{text:'历史记录',evidenceIds:['source']}],generalAdvice:[],question:''}]);
 const transport=f.transport;f.transport=(url,init)=>url.pathname==='/v1/models'?Promise.resolve({ok:true,json:async()=>({data:[{id:'qwen3.8-flash-next-coder-iq1_m'}]})}):transport(url,init);
 const r=await createEvidenceExpert(f).answer({message:'C16L闪烁',route:{intent:'technical'},execute:async()=>({evidence:[{evidenceId:'source',name:'案例',text:'历史记录'}]})});
 assert.equal(r.status,'answer');assert.equal(f.calls.length,3);
 for(const call of f.calls){assert.equal(call.response_format.type,'json_schema');assert.equal(call.response_format.json_schema.strict,true);assert.equal(call.max_tokens,call===f.calls.at(-1)?8192:512);assert.equal(call.chat_template_kwargs.enable_thinking,false);}
 const branches=f.calls[2].response_format.json_schema.schema.oneOf;assert.ok(branches.some(s=>s.properties.action.const==='search'));assert.deepEqual(branches.find(s=>s.properties.action.const==='answer').properties.claims.items.properties.evidenceIds.items.enum,['source']);
});
test('Read choices enumerate only evidence-backed blocks; no original is offered when no block exists',async()=>{
 const f=fake([{action:'search',query:'原文',kind:'text'},{action:'read',blockId:7},{action:'answer',claims:[],generalAdvice:['核对现场条件。'],question:''}]);
 await createEvidenceExpert(f).answer({message:'技术问题',execute:async()=>({evidence:[{evidenceId:'block-7',blockId:7,name:'原文',text:'现场条件'}]})});
 assert.ok(!f.calls[0].response_format.schema.oneOf.some(s=>s.properties.action.const==='read'));
 assert.deepEqual(f.calls[1].response_format.schema.oneOf.find(s=>s.properties.action.const==='read').properties.blockId.enum,[7]);
});
test('Decision JSON length recovery increases only the decision budget without executing partial tools',async()=>{
 const calls=[];let tools=0;
 const expert=createEvidenceExpert({transport:async(url,init)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
  calls.push(JSON.parse(init.body));if(calls.length===1)return {ok:false,status:502,json:async()=>({error:{code:'structured_output_failed',message:'finish_reason=length'}})};
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls.length===2?{action:'finish'}:{action:'answer',claims:[],generalAdvice:['核对条件。'],question:''})}}]})};
 }});const r=await expert.answer({message:'技术问题',execute:async()=>{tools++;return {};}});
 assert.equal(r.status,'answer');assert.equal(tools,0);assert.deepEqual(calls.map(c=>c.max_tokens),[512,2048,8192]);assert.ok(calls.every(c=>c.chat_template_kwargs.enable_thinking===false));assert.equal(r.modelCalls[0].recovery,'decision-json-budget');
});

test('Expert social replies genuinely call the model, use plain text and never invoke retrieval',async()=>{
 const f=fake(['你好，需要我协助查什么资料？']);const r=await createEvidenceExpert(f).answer({message:'你好',route:{intent:'social'},execute:()=>{throw Error('must not search');}});assert.equal(r.status,'answer');assert.equal(f.calls.length,1);assert.equal(f.calls[0].response_format,undefined);assert.equal(r.toolTrace.length,0);
});
test('Expert validates structured tools and renders real names rather than internal citation IDs',async()=>{
 const f=fake([{action:'answer',claims:[{text:'找到对应规格书',evidenceIds:['file-synthetic-id']}],generalAdvice:[],question:''}]);const r=await createEvidenceExpert(f).answer({message:'C16L规格书',route:{intent:'resources',simpleResource:true},execute:async()=>({evidence:[{evidenceId:'file-synthetic-id',name:'C16L规格书 V2.0.pdf',text:'说明原文件',download:'/synthetic-source'}]})});assert.equal(r.status,'answer');assert.ok(f.calls[0].response_format.schema);assert.match(r.reply,/C16L规格书 V2.0.pdf/);assert.ok(!r.reply.includes('file-synthetic-id'));assert.equal(r.results[0].download,'/synthetic-source');
});
test('Unexpected model format and truncation fail explicitly without a search-result fallback',async()=>{
 for(const output of ['not JSON',{action:'unknown'}]){const f=fake([output]);const r=await createEvidenceExpert(f).answer({message:'技术问题',execute:()=>{throw Error('must not search');}});assert.equal(r.status,'unavailable');assert.deepEqual(r.results,[]);}
 const f=fake(['irrelevant']);const original=f.transport;f.transport=async(url,init)=>{const r=await original(url,init);if(url.pathname.includes('completions')){const j=await r.json();j.choices[0].finish_reason='length';return {...r,json:async()=>j};}return r;};const r=await createEvidenceExpert(f).answer({message:'你好',route:{intent:'social'}});assert.equal(r.error,'expert-output-truncated');
});
test('Uncited company claims fail; general advice is separately labelled and can work with no evidence',async()=>{
 const f=fake([{action:'answer',claims:[],generalAdvice:['先记录现场条件并逐项核对连接。'],question:'完整型号是什么？'}]);const r=await createEvidenceExpert(f).answer({message:'没有相关资料的故障',route:{intent:'technical'}});assert.equal(r.status,'answer');assert.match(r.reply,/通用排查建议/);assert.equal(r.toolTrace.length,0);
});
test('A real citation cannot justify a fabricated numeric specification or compatibility assertion',async()=>{
 for(const text of ['最大带载999万点','该固件可以通用']){
  const f=fake([{action:'answer',claims:[{text,evidenceIds:['source']}],generalAdvice:[],question:''}]);
  const r=await createEvidenceExpert(f).answer({message:'R512规格书',route:{intent:'resources',simpleResource:true},execute:async()=>({evidence:[{evidenceId:'source',name:'R512规格书',text:'R512原始资料，适用关系未确认'}]})});assert.equal(r.status,'unavailable');assert.ok(['expert-unsupported-number','expert-unconfirmed-compatibility'].includes(r.error));
 }
});
test('A supplied model identifier in a caution is not mistaken for an invented numeric specification',async()=>{
 const f=fake([{action:'search',query:'C16L闪烁',kind:'cases'},{action:'finish'},{action:'answer',claims:[{text:'该经验不能直接认定HD-C16L的当前原因。',evidenceIds:['source']}],generalAdvice:[],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'C16L闪烁',route:{intent:'aftersales',models:['HD-C16L']},execute:async()=>({evidence:[{evidenceId:'source',name:'历史经验',text:'排线检查的历史记录'}]})});assert.equal(r.status,'answer');
});
test('A copied known citation hash is rendered as a source name and does not count as an invented parameter',async()=>{
 for(const invented of [false,true]){const id='case-0123456789abcdef01234567',f=fake([{action:'answer',claims:[{text:'案例0123456789abcdef01234567：历史检查记录'+(invented?'，最大999万点':''),evidenceIds:[id]}],generalAdvice:[],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'资料',route:{simpleResource:true},execute:async()=>({evidence:[{evidenceId:id,name:'历史案例',text:'历史检查记录'}]})});
 if(invented)assert.equal(r.error,'expert-unsupported-number');else{assert.equal(r.status,'answer');assert.ok(!r.reply.includes('0123456789abcdef'));assert.match(r.reply,/历史案例/);}
 }
});
test('Compatibility denials pass while affirmative claims in later clauses still require confirmation',async()=>{
 for(const [text,allowed] of [['当前资料不能确认R512与R512S固件可以通用。',true],['不支持直接互刷。',true],['历史案例未找到明确说明R512与R512S固件通用性的记录。',true],['当前不能确认，但固件可以通用。',false],['固件可以通用，但没有资料确认。',false]]){
  const f=fake([{action:'answer',claims:[{text,evidenceIds:['source']}],generalAdvice:[],question:''}]);
  const r=await createEvidenceExpert(f).answer({message:'R512和R512S固件',route:{intent:'resources',simpleResource:true,models:['HD-R512','HD-R512S']},execute:async()=>({evidence:[{evidenceId:'source',name:'固件目录',text:'R512 R512S 固件候选，兼容关系未确认'}]})});
  assert.equal(r.status,allowed?'answer':'unavailable',text);if(!allowed)assert.equal(r.error,'expert-unconfirmed-compatibility');
 }
});
test('A legacy analyze action transitions to final answer without enabling Thinking',async()=>{
 const f=fake([{action:'analyze',reason:'对照分支'},{action:'answer',claims:[],generalAdvice:['核对现场。'],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'复杂LED问题'});
 assert.equal(r.status,'answer');assert.deepEqual(f.calls.map(c=>c.max_tokens),[512,8192]);assert.ok(f.calls.every(c=>!c.chat_template_kwargs.enable_thinking));
});
test('A complete original read skips finish confirmation but still permits necessary supplementary evidence',async()=>{
 const f=fake([{action:'search',query:'故障',kind:'cases'},{action:'read',blockId:7},{action:'search',query:'版本边界',kind:'text',reason:'核对原文未覆盖的版本条件'},{action:'answer',claims:[{text:'原文检查记录',evidenceIds:['source']}],generalAdvice:[],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'故障及版本条件',execute:async name=>({evidence:[{evidenceId:'source',blockId:7,text:'原文检查记录',readPerformed:name==='read_document'}]})});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,4);assert.equal(f.calls[2].max_tokens,8192);
 assert.ok(f.calls[2].response_format.schema.oneOf.some(s=>s.properties.action.const==='search'));
 assert.equal(r.modelCalls[2].action.action,'search');
});
test('A retrieval model filter is not proof that a generic manual specifies this model',async()=>{
 const f=fake([{action:'answer',claims:[{text:'HD-A5L每口655360点。',evidenceIds:['manual']}],generalAdvice:[],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'A5L带载',route:{models:['HD-A5L'],simpleResource:true},execute:async()=>({evidence:[{evidenceId:'manual',name:'软件通用手册',text:'每个网口最大带载655360点',readPerformed:true,scope:{requestedModels:['HD-A5L'],mentionedModels:[]}}]})});
 assert.equal(r.error,'expert-model-scope-unverified');assert.equal(r.status,'unavailable');
});
test('A product pixel limit cannot bypass citation and applicability checks through general advice',async()=>{
 const f=fake([{action:'answer',claims:[],generalAdvice:['A5L单网口按655360点处理。'],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'A5L带载',route:{models:['HD-A5L']}});
 assert.equal(r.error,'expert-ungrounded-product-claim');assert.equal(r.status,'unavailable');
});
test('An explicit single-model capacity question reuses product retrieval without a model planning round',async()=>{
 const f=fake([{action:'answer',claims:[{text:'HD-A5L控制范围130万像素。',evidenceIds:['product']}],generalAdvice:[],question:''}]);let tools=0;
 const r=await createEvidenceExpert(f).answer({message:'A5L带载多少',route:{models:['HD-A5L']},execute:async(name,args)=>{
  tools++;assert.equal(name,'search_evidence');assert.equal(args.kind,'products');assert.equal(f.calls.length,0);
  return {evidence:[{evidenceId:'product',name:'HD-A5L产品索引',modelIds:['HD-A5L'],text:'HD-A5L控制范围130万像素。'}]};
 }});
 assert.equal(r.status,'answer');assert.equal(tools,1);assert.equal(r.modelCallCount,1);assert.equal(f.calls[0].max_tokens,8192);assert.equal(r.claims[0].evidenceIds[0],'product');
});
test('Only explicit simple resources can preload evidence; candidate preparation does not remove search',async()=>{
 const f=fake([{action:'answer',claims:[{text:'历史记录提供排线检查经验，不能直接认定当前原因。',evidenceIds:['source']}],generalAdvice:['已换过排线仍固定异常，下一步记录对应接口接触情况，逐项验证。'],question:'接收卡与芯片型号是什么？'}]);let retrieves=0;
 const r=await createEvidenceExpert(f).answer({message:'C16L局部异常，换过排线无变化',route:{intent:'resources',simpleResource:true,models:['HD-C16L']},sessionState:{facts:{knownNormal:['其他区域正常']}},execute:async(name,args)=>{assert.equal(f.calls.length,0);assert.equal(name,'search_evidence');assert.equal(args.kind,'resources');retrieves++;return {evidence:[{evidenceId:'source',name:'现场案例索引',locator:{paragraph:12},text:'排线检查的历史经验'}]};}});
 assert.equal(r.status,'answer');assert.equal(retrieves,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].chat_template_kwargs.enable_thinking,false);const input=JSON.parse(f.calls[0].messages[1].content);assert.equal(input.preparedEvidence.evidence.length,1);assert.deepEqual(input.facts.knownNormal,['其他区域正常']);assert.match(r.reply,/段 12/);assert.equal(r.modelCalls[0].purpose,'final-answer');
 assert.ok(f.calls[0].response_format.schema.oneOf.some(s=>s.properties.action.const==='search'));assert.ok(f.calls[0].response_format.schema.oneOf.some(s=>s.properties.action.const==='answer'));assert.equal(f.calls[0].max_tokens,8192);
});
test('Additional original reading is allowed only when needed; valid fenced JSON never causes regeneration',async()=>{
 const f=fake([{action:'read',blockId:7},'```json\n'+JSON.stringify({action:'answer',claims:[{text:'原文检查记录',evidenceIds:['block-8']}],generalAdvice:[],question:''})+'\n```']);const seen=[];
 const r=await createEvidenceExpert(f).answer({message:'C16L参数',route:{intent:'resources',simpleResource:true},execute:async(name)=>{seen.push(name);return name==='search_evidence'?{evidence:[{evidenceId:'block-7',blockId:7,name:'产品原文',text:'有待阅读全文'}]}:{evidence:[{evidenceId:'block-8',blockId:8,name:'产品原文',text:'原文检查记录'}]};}});
 assert.equal(r.status,'answer');assert.deepEqual(seen,['search_evidence','read_document']);assert.equal(f.calls.length,2);assert.equal(r.modelCalls.length,2);
});
test('Expert routing preserves context without treating an unresolved followup as social or forcing fault search',()=>{
 const state={messages:[{role:'user',content:'C16L升级后闪烁'}]};
 const followup=expertIntent('还是这样',lookup,state);assert.equal(followup.intent,'technical');assert.equal(followup.decisionAuthority,'bonsai');assert.equal(followup.simpleResource,false);assert.deepEqual(followup.contextModels,['HD-C16L']);
 const doc=expertIntent('C16L说明书，不是故障排查',lookup,state);assert.equal(doc.intent,'resources');assert.equal(doc.simpleResource,true);
 assert.equal(expertIntent('C16L升级后闪烁',lookup,state).simpleResource,false);
});
test('Bonsai can select cases, supplement with text, then read an authorized passage and answer',async()=>{
 const f=fake([{action:'search',query:'C16L升级后闪烁',kind:'cases'},{action:'search',query:'DCLK 相位',kind:'text',reason:'案例缺少时钟原文条件'},{action:'read',blockId:7},{action:'answer',claims:[{text:'原文记录了时钟核查条件',evidenceIds:['block-8']}],generalAdvice:['先核对升级前后版本，再验证现场。'],question:''}]);const seen=[];
 const r=await createEvidenceExpert(f).answer({message:'还是这样',route:expertIntent('还是这样',lookup,{messages:[{role:'user',content:'C16L升级后闪烁'}]}),sessionState:{messages:[{role:'user',content:'C16L升级后闪烁'}]},execute:async(name,args)=>{seen.push([name,args.kind]);return name==='read_document'?{evidence:[{evidenceId:'block-8',name:'时钟原文',text:'原文记录了时钟核查条件'}]}:args.kind==='text'?{evidence:[{evidenceId:'block-7',blockId:7,name:'时钟原文',text:'时钟条件摘要'}]}:{evidence:[{evidenceId:'case-source',name:'案例',text:'历史闪烁记录'}]};}});
 assert.equal(r.status,'answer');assert.deepEqual(seen,[['search_evidence','cases'],['search_evidence','text'],['read_document',undefined]]);assert.equal(r.toolCallCount,3);assert.equal(r.modelCallCount,4);assert.match(f.calls[0].messages[1].content,/C16L升级后闪烁/);assert.ok(f.calls[1].response_format.schema.oneOf.some(s=>s.properties.action.const==='search'));
});
test('Identical tool queries reuse evidence while changed model suffixes remain distinct',async()=>{
 const f=fake([{action:'search',query:'R512 固件',kind:'files'},{action:'search',query:'r512   固件',kind:'files',reason:'重复候选核对'},{action:'search',query:'R512S 固件',kind:'files',reason:'另一准确型号'},{action:'answer',claims:[],generalAdvice:['两种型号必须分别核对硬件，当前不能确认兼容。'],question:''}]);let reads=0;
 const r=await createEvidenceExpert(f).answer({message:'比较两卡',route:{intent:'technical'},execute:async()=>{reads++;return {evidence:[]};}});assert.equal(r.status,'answer');assert.equal(reads,2);assert.equal(r.toolCallCount,2);assert.equal(r.toolRequestCount,3);assert.equal(r.toolTrace[1].cached,true);
});
