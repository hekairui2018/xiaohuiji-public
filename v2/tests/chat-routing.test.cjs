'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chatIntent}=require('../domain/parser/chat-intent.cjs');
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
function fake(outputs){const calls=[];return {calls,transport:async(url,init)=>{if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic-bonsai'}]})};calls.push(JSON.parse(init.body));const item=outputs.shift();return {ok:true,status:200,json:async()=>({choices:[{message:{content:typeof item==='string'?item:JSON.stringify(item)},finish_reason:'stop'}],usage:{completion_tokens:10}})};}};}
test('Expert social replies genuinely call the model, use plain text and never invoke retrieval',async()=>{
 const f=fake(['你好，需要我协助查什么资料？']);const r=await createEvidenceExpert(f).answer({message:'你好',route:{intent:'social'},execute:()=>{throw Error('must not search');}});assert.equal(r.status,'answer');assert.equal(f.calls.length,1);assert.equal(f.calls[0].response_format,undefined);assert.equal(r.toolTrace.length,0);
});
test('Expert validates structured tools and renders real names rather than internal citation IDs',async()=>{
 const f=fake([{action:'answer',claims:[{text:'找到对应规格书',evidenceIds:['file-synthetic-id']}],generalAdvice:[],question:''}]);const r=await createEvidenceExpert(f).answer({message:'C16L规格书',route:{intent:'resources'},execute:async()=>({evidence:[{evidenceId:'file-synthetic-id',name:'C16L规格书 V2.0.pdf',text:'说明原文件',download:'/synthetic-source'}]})});assert.equal(r.status,'answer');assert.ok(f.calls[0].response_format.schema);assert.match(r.reply,/C16L规格书 V2.0.pdf/);assert.ok(!r.reply.includes('file-synthetic-id'));assert.equal(r.results[0].download,'/synthetic-source');
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
  const r=await createEvidenceExpert(f).answer({message:'R512规格书',route:{intent:'resources'},execute:async()=>({evidence:[{evidenceId:'source',name:'R512规格书',text:'R512原始资料，适用关系未确认'}]})});assert.equal(r.status,'unavailable');assert.ok(['expert-unsupported-number','expert-unconfirmed-compatibility'].includes(r.error));
 }
});
test('A supplied model identifier in a caution is not mistaken for an invented numeric specification',async()=>{
 const f=fake([{action:'answer',claims:[{text:'该经验不能直接认定HD-C16L的当前原因。',evidenceIds:['source']}],generalAdvice:[],question:''}]);
 const r=await createEvidenceExpert(f).answer({message:'C16L闪烁',route:{intent:'aftersales',models:['HD-C16L']},execute:async()=>({evidence:[{evidenceId:'source',name:'历史经验',text:'排线检查的历史记录'}]})});assert.equal(r.status,'answer');
});
test('Thought budget exhaustion permits only one bounded model retry without thinking and preserves validation',async()=>{
 const calls=[];let count=0;const expert=createEvidenceExpert({transport:async(url,init)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
  const body=JSON.parse(init.body);calls.push(body);count++;
  return {ok:true,json:async()=>count===1?{choices:[{finish_reason:'length',message:{content:'',reasoning_content:'synthetic internal thought'}}],usage:{completion_tokens:1200}}:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'answer',claims:[],generalAdvice:['先核对现场条件，不认定具体原因。'],question:''})}}],usage:{completion_tokens:40}}};
 }});const r=await expert.answer({message:'复杂LED工程问题',route:{intent:'technical'}});
 assert.equal(r.status,'answer');assert.equal(calls.length,2);assert.equal(calls[0].chat_template_kwargs.reasoning_effort,'low');assert.equal(calls[1].chat_template_kwargs.enable_thinking,false);assert.ok(calls.every(c=>c.max_tokens<=1200));assert.equal(r.modelCalls[0].recovery,'retry-once-without-thinking');assert.equal(r.modelCalls[0].reasoningTokens,null);
});
test('Known technical requests prepare evidence before a single model call, keeping observations and source checks',async()=>{
 const f=fake([{action:'answer',claims:[{text:'历史记录提供排线检查经验，不能直接认定当前原因。',evidenceIds:['source']}],generalAdvice:['已换过排线仍固定异常，下一步记录对应接口接触情况，逐项验证。'],question:'接收卡与芯片型号是什么？'}]);let retrieves=0;
 const r=await createEvidenceExpert(f).answer({message:'C16L局部异常，换过排线无变化',route:{intent:'aftersales',models:['HD-C16L']},sessionState:{facts:{knownNormal:['其他区域正常']}},execute:async(name,args)=>{assert.equal(f.calls.length,0);assert.equal(name,'search_evidence');assert.equal(args.kind,'cases');retrieves++;return {evidence:[{evidenceId:'source',name:'现场案例索引',locator:{paragraph:12},text:'排线检查的历史经验'}]};}});
 assert.equal(r.status,'answer');assert.equal(retrieves,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].chat_template_kwargs.enable_thinking,false);const input=JSON.parse(f.calls[0].messages[1].content);assert.equal(input.preparedEvidence.evidence.length,1);assert.deepEqual(input.facts.knownNormal,['其他区域正常']);assert.match(r.reply,/段 12/);assert.equal(r.modelCalls[0].purpose,'grounded-analysis-with-prepared-evidence');
 const outputSchema=f.calls[0].response_format.schema;assert.equal(outputSchema.properties.generalAdvice.maxItems,3);assert.deepEqual(outputSchema.properties.claims.items.properties.evidenceIds.items.enum,['source']);
});
test('Additional original reading is allowed only when needed; valid fenced JSON never causes regeneration',async()=>{
 const f=fake([{action:'read',blockId:7},'```json\n'+JSON.stringify({action:'answer',claims:[{text:'原文检查记录',evidenceIds:['block-8']}],generalAdvice:[],question:''})+'\n```']);const seen=[];
 const r=await createEvidenceExpert(f).answer({message:'C16L参数',route:{intent:'product'},execute:async(name)=>{seen.push(name);return name==='search_evidence'?{evidence:[{evidenceId:'block-7',blockId:7,name:'产品原文',text:'有待阅读全文'}]}:{evidence:[{evidenceId:'block-8',blockId:8,name:'产品原文',text:'原文检查记录'}]};}});
 assert.equal(r.status,'answer');assert.deepEqual(seen,['search_evidence','read_document']);assert.equal(f.calls.length,2);assert.equal(r.modelCalls.length,2);
});
