'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createEvidenceExpert} = require('../model-adapter/evidence-expert.cjs');
const {createSectionTools} = require('../adapters/http/section-tools.cjs');
const {delegatedQuickResult} = require('../model-adapter/quick-delegation.cjs');
const {numericFileDelivery} = require('../domain/knowledge/numeric-file-delivery.cjs');

function fixture(actions) {
  const requests = [];
  const expert = createEvidenceExpert({maxModelCalls:5,thinkingEnabled:true,transport:async(url,options)=>{
    if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic',owned_by:'ninfer'}]})};
    if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
    if(url.pathname==='/tokenize')return {ok:false};
    const req=JSON.parse(options.body);requests.push(req);assert(actions.length,'unexpected second model call');
    assert.equal(req.chat_template_kwargs.enable_thinking,true);
    return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(actions.shift())}}],usage:{prompt_tokens:40,completion_tokens:30}})};
  }});
  return {expert,requests};
}
const final = {action:'answer',claims:[{text:'原文确认的说明',evidenceIds:['s1']}],generalAdvice:[]};
const evidence = [{evidenceId:'original',name:'合成说明书',text:'原文确认的说明',readPerformed:true}];
const file = (model,language='中文') => ({name:model+'规格书 '+language+'.pdf',kind:'spec',models:[model],resourceOnly:true,download:'/v2/file/'+model,documentLanguage:language});

test('model delegates complex natural language to a complete quick answer in one thinking call',async()=>{
  const f=fixture([{action:'quick',query:'X100 输入电压',delivery:'if_complete'}]);
  const answer={status:'answer',answerBasis:'source-cell-values',reply:'输入电压：12V\n来源：产品速查表',results:[{name:'产品速查表',models:['HD-X100'],text:'输入电压：12V'}]};
  const tools=createSectionTools({resourceAnswer:async q=>{assert.equal(q,'X100 输入电压');return answer;}});
  const r=await f.expert.answer({message:'我手边这台X100，客户一直说的是接它供电的电源，并不是视频接口，帮我确认该看哪个输入电压参数。',execute:tools.execute});
  assert.equal(r.status,'answer');assert.equal(r.reply,answer.reply);assert.equal(r.modelCallCount,1);assert.equal(r.toolCallCount,1);
  assert.equal(r.delegatedTo,'model-delegated-quick-completion');assert.equal(r.actualMode,'expert');
});

test('partial quick evidence returns to the model rather than being promoted to a complete answer',async()=>{
  const f=fixture([{action:'quick',query:'X100 设置',delivery:'if_complete'},final]);
  const r=await f.expert.answer({message:'X100设置相关说明',execute:async()=>({evidence,directAnswer:{status:'partial',answerBasis:'sections-sql-bm25-vector',reply:'只有部分步骤',results:[]}})});
  assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.notEqual(r.reply,'只有部分步骤');
});

test('the model can explicitly request review even for an exact downloadable file',async()=>{
  const f=fixture([{action:'quick',query:'X100规格书',delivery:'review'},{action:'deliver',evidenceIds:['s1']}]);
  const tools=createSectionTools({resourceAnswer:async()=>({status:'answer',answerBasis:'file-registry-columns',reply:'文件已找到',results:[file('HD-X100')]})});
  const r=await f.expert.answer({message:'X100规格书',execute:tools.execute});
  assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.equal(r.results.length,1);
});

test('model-selected labelled numeric candidate delivers only that model and preserves language constraints',async()=>{
  const queries=[];
  const tools=createSectionTools({modelCatalog:async()=>[{models:['HD-KV410']},{models:['HD-VP410H']}],resourceAnswer:async q=>{
    queries.push(q);const model=q.split(' ')[0];return {status:'answer',results:[file(model,'英文'),file('HD-UNRELATED','英文')]};
  }});
  const f=fixture([{action:'quick',query:'410 规格书 英文',delivery:'if_complete',candidatePolicy:'labelled_best'}]);
  const r=await f.expert.answer({message:'客户只记得410，要英文规格书，给个可能的型号让我核对。',execute:tools.execute});
  assert.equal(r.modelCallCount,1);assert.equal(r.status,'answer');assert.equal(r.candidateDelivery.identityConfirmed,false);
  assert.match(r.reply,/您说的是 KV410/);assert(r.results.every(row=>row.models.includes('HD-KV410')));
  assert(!r.reply.includes('VP410H'));assert(queries.every(q=>q.endsWith('规格书 英文')));
  assert(r.toolTrace[0].notice.candidateModels.includes('HD-VP410H'));
  assert.deepEqual(r.modelSuggestion,{input:'410',candidates:['KV410','VP410H'],identityConfirmed:false});
});

test('candidate choice delivery never claims a selected model is confirmed',()=>{
  const r=numericFileDelivery({candidates:['HD-X100','HD-Y100'],rows:[file('HD-X100'),file('HD-Y100')],policy:'show_choices',query:'100规格书'});
  assert.equal(r.candidateDelivery.selectedModel,null);assert.match(r.reply,/多个登记型号/);
  assert(delegatedQuickResult({action:'quick',delivery:'if_complete'},r).allowed);
  const mixed=numericFileDelivery({candidates:['HD-X100'],rows:[file('HD-X100'),file('HD-Y100')],policy:'labelled_best',query:'100规格书'});
  assert(mixed.results.every(row=>row.models.includes('HD-X100')));
  assert(!delegatedQuickResult({action:'quick',delivery:'if_complete'},mixed,{models:['HD-Y100']}).allowed);
});

test('unknown, conflicted, missing, approximate and arbitrary answers cannot terminate delegation',()=>{
  const action={action:'quick',delivery:'if_complete'};
  for(const change of [{status:'partial'},{status:'not-found'},{status:'clarify'},{status:'unavailable'},{answerBasis:'untrusted-custom-answer'},{conflict:true},{approximate:true},{complete:false},{results:[{unknown:true}]}]){
    assert.equal(delegatedQuickResult(action,{status:'answer',answerBasis:'sections-sql-bm25-vector',reply:'候选原文',results:[],...change}).allowed,false,JSON.stringify(change));
  }
  assert.equal(delegatedQuickResult({action:'search',delivery:'if_complete'},{status:'answer',reply:'原文',answerBasis:'sections-sql-bm25-vector'}).allowed,false);
});

test('a numeric parameter request is not silently changed into a specification download',async()=>{
  const queries=[];
  const tools=createSectionTools({modelCatalog:async()=>{throw Error('must not discover file candidates');},resourceAnswer:async q=>{queries.push(q);return {status:'partial',reply:'型号需核对',results:[]};}});
  const r=await tools.execute('quick_answer',{query:'410带载多少',delivery:'if_complete'});
  assert.deepEqual(queries,['410带载多少']);assert.equal(r.directAnswer.status,'partial');
});

test('delegation retains explicit model identity constraints',()=>{
 const action={action:'quick',delivery:'if_complete'};
 const r={status:'answer',answerBasis:'file-registry-columns',reply:'文件',results:[file('HD-Y100')]};
 assert(!delegatedQuickResult(action,r,{models:['HD-X100']}).allowed);
 assert(!delegatedQuickResult(action,{...r,results:[{...file('HD-X100'),queryMatch:{exact:false}}]}).allowed);
 assert(delegatedQuickResult(action,{...r,results:[file('HD-X100')]},{models:['HD-X100']}).allowed);
});

test('changing candidate policy does not replay a cached result with the previous policy',async()=>{
 const f=fixture([{action:'quick',query:'100规格书',delivery:'review',candidatePolicy:'show_choices'},
  {action:'quick',query:'100规格书',delivery:'if_complete',candidatePolicy:'labelled_best'}]);
 const tools=createSectionTools({modelCatalog:async()=>[{models:['HD-X100']},{models:['HD-Y100']}],resourceAnswer:async q=>({status:'answer',results:[file(q.match(/HD-[A-Z0-9]+/)[0])]})});
 const r=await f.expert.answer({message:'100规格书',execute:tools.execute});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.equal(r.toolCallCount,2);
 assert.equal(r.candidateDelivery.policy,'labelled_best');assert.equal(r.results.length,1);
});

test('a model-reviewed delivery containing two candidates does not label both as one model',async()=>{
 const f=fixture([{action:'quick',query:'100规格书',delivery:'review'}, {action:'deliver',evidenceIds:['s1','s2']}]);
 const tools=createSectionTools({modelCatalog:async()=>[{models:['HD-X100']},{models:['HD-Y100']}],resourceAnswer:async q=>({status:'answer',results:[file(q.match(/HD-[A-Z0-9]+/)[0])]})});
 const r=await f.expert.answer({message:'100规格书',execute:tools.execute});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.equal(r.results.length,2);
 assert.match(r.reply,/多个登记型号/);assert(!r.reply.includes('您说的是 X100'));
});

test('model-selected file search shares the same first-round completion protocol',async()=>{
 const f=fixture([{action:'search',kind:'resources',query:'100规格书',delivery:'if_complete',candidatePolicy:'labelled_best',goals:['文件'],concepts:['规格书']}]);
 const tools=createSectionTools({modelCatalog:async()=>[{models:['HD-X100']},{models:['HD-Y100']}],resourceAnswer:async q=>({status:'answer',results:[file(q.match(/HD-[A-Z0-9]+/)[0])]})});
 const r=await f.expert.answer({message:'100规格书',execute:tools.execute});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,1);assert.equal(r.results.length,1);
 assert.equal(r.completionDecision.action,'search');assert.match(r.reply,/您说的是 X100/);
});

test('searching raw source evidence cannot be mistaken for a completed quick-mode answer',async()=>{
 const f=fixture([{action:'search',kind:'text',query:'现场原文',delivery:'if_complete',goals:['原文'],concepts:['现场']},final]);
 const r=await f.expert.answer({message:'结合现场原文分析',execute:async()=>({evidence})});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.notEqual(r.delegatedTo,'model-delegated-quick-completion');
});

test('a model-selected parameter search can delegate the complete quick policy rather than forcing table analysis',async()=>{
 const f=fixture([{action:'search',kind:'products',query:'输入电压',models:['HD-X100'],delivery:'if_complete',goals:['参数'],concepts:['输入电压']}]);
 const tools=createSectionTools({resourceAnswer:async q=>({status:'answer',answerBasis:'parameter-source-cell',reply:'输入电压：12V',queryPlan:{models:['HD-X100']},results:[{name:'原表',models:['HD-X100'],value:'12V',text:'输入电压：12V',parameter:'输入电压',locator:{row:2}}]}),expertMaterials:{evidence:()=>{throw Error('Complete quick answer must not trigger extra table analysis');}}});
 const r=await f.expert.answer({message:'X100输入电压是多少',execute:tools.execute});
 assert.equal(r.status,'answer');assert.equal(r.reply,'输入电压：12V');assert.equal(r.modelCallCount,1);
});

test('a partial delegated parameter search still exposes the requested original table for model review',async()=>{
 const f=fixture([{action:'search',kind:'products',query:'参数原文',delivery:'if_complete',goals:['参数'],concepts:['参数']},final]);
 const tools=createSectionTools({resourceAnswer:async()=>({status:'partial',answerBasis:'parameter-source-cell',reply:'部分参数待核对',results:[]}),expertMaterials:{evidence:()=>evidence}});
 const r=await f.expert.answer({message:'查参数原文并说明缺口',execute:tools.execute});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);
});

test('search cache distinguishes raw review from model-delegated quick completion',async()=>{
 const common={action:'search',kind:'products',query:'输入电压',goals:['参数'],concepts:['输入电压']};
 const f=fixture([{...common,delivery:'review'},{...common,delivery:'if_complete'}]);
 const tools=createSectionTools({resourceAnswer:async()=>({status:'answer',answerBasis:'parameter-source-cell',reply:'12V',results:[{name:'原表',text:'12V',models:['HD-X100'],parameter:'输入电压',value:'12V',locator:{row:1}}]}),expertMaterials:{evidence:()=>evidence}});
 const r=await f.expert.answer({message:'查输入电压',execute:tools.execute});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.equal(r.toolCallCount,2);assert.equal(r.reply,'12V');
});
