'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('http');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
test('expert interprets a file question before any retrieval and may request the authorized file tool',async()=>{
 let expertCalls=0,searchCalls=0;
 const api=createOfflineKnowledge({resourceAnswer:async()=>{throw Error('must not directly answer for expert');},resourceSearch:async query=>{searchCalls++;assert.equal(query,'LS1234S 配置文件');return {results:[{name:'LS1234S_64S.ssr',kind:'module-config',resourceOnly:true,download:'/authorized/config'}]};},expert:{answer:async({execute,preparedEvidence})=>{
  expertCalls++;assert.equal(searchCalls,0);assert.equal(preparedEvidence.length,0);
  const found=await execute('search_evidence',{kind:'files',query:'LS1234S 配置文件'});assert.equal(found.evidence[0].download,'/authorized/config');assert.equal(found.evidence[0].sourceKind,'registered-resource-metadata');
  return {status:'answer',reply:'这是配置文件候选，扫描等条件仍需核对。',modelCallCount:2};
 }}});
 const server=http.createServer((req,res)=>api.handle(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'expert',sessionId:'autonomy-file',message:'LS1234S芯片配置文件'})});const body=await response.json();assert.equal(response.status,200);assert.match(body.reply,/配置文件候选/);assert.equal(expertCalls,1);assert.equal(searchCalls,1);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('a model answer returns immediately without mandatory retrieval or historical-case review',async()=>{
 let generations=0,tools=0;
 const expert=createEvidenceExpert({relaxedAnswers:true,transport:async url=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
  generations++;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({action:'answer',claims:[],generalAdvice:['先区分测试画面与实际播放是否相同，再决定检查方向。'],question:''})},finish_reason:'stop'}]})};
 }});
 const result=await expert.answer({message:'测试正常但节目显示不同，怎样判断？',execute:async()=>{tools++;throw Error('unnecessary retrieval');},preparedEvidence:[{evidenceId:'historical',name:'synthetic',text:'历史更换参数',readPerformed:true,caseSemantics:{historyOnly:true,operationClasses:['configuration-write']}}]});
 assert.equal(result.status,'answer');assert.equal(generations,1);assert.equal(tools,0);
});
test('expert chooses quick as a tool and receives its result before answering',async()=>{
 let calls=0,quick=0;
 const expert=createEvidenceExpert({relaxedAnswers:true,transport:async(url,options)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
  const body=JSON.parse(options.body);if(calls===1)assert.match(JSON.stringify(body.messages),/authorized\/manual/);
  const output=calls++===0?{action:'quick',query:'X123说明书'}:{action:'answer',claims:[{text:'找到X123说明书。',evidenceIds:['s1']}],generalAdvice:[]};
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]})};
 }});
 const answer=await expert.answer({message:'给我X123说明书',route:{intent:'technical',hintIntent:'resources',simpleResource:true},execute:async(name,args)=>{assert.equal(name,'quick_answer');assert.equal(calls,1);assert.equal(args.query,'X123说明书');quick++;return {notice:{reply:'文件链接 /authorized/manual'},evidence:[{evidenceId:'manual',name:'X123说明书.pdf',text:'文件登记',download:'/authorized/manual',sourceKind:'registered-resource-metadata'}]};}});
 assert.equal(answer.status,'answer');assert.equal(quick,1);assert.equal(calls,2);assert.equal(answer.actualMode,'expert');assert.equal(answer.results[0].download,'/authorized/manual');
});
test('following a quick tool call the next customer turn still reaches the expert with isolated history',async()=>{
 let calls=0,quick=0;
 const api=createOfflineKnowledge({resourceAnswer:async()=>{quick++;return {status:'answer',reply:'候选手册',results:[{name:'X123说明书.pdf',resourceOnly:true,download:'/manual'}]};},expert:{answer:async({message,sessionState,execute})=>{
  calls++;if(message==='给我X123说明书'){await execute('quick_answer',{query:message});return {status:'answer',actualMode:'expert',reply:'候选手册在这里。',modelCallCount:2};}
  if(message==='这个操作要先断电吗'){assert(sessionState.messages.some(m=>m.role==='user'&&m.content==='给我X123说明书'));assert(sessionState.messages.some(m=>m.role==='assistant'&&m.content==='候选手册在这里。'));return {status:'answer',actualMode:'expert',reply:'需要先确认你指的是哪一步操作。',modelCallCount:1};}
  assert(!sessionState.messages.some(m=>m.content==='给我X123说明书'));return {status:'answer',actualMode:'expert',reply:'另一个独立会话。',modelCallCount:1};
 }}});
 const server=http.createServer((req,res)=>api.handle(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const [sessionId,message]of [['expert-multi','给我X123说明书'],['expert-multi','这个操作要先断电吗'],['expert-other','你好，解释下接口']]){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'expert',sessionId,message})});const body=await r.json();assert.equal(r.status,200);assert.equal(body.actualMode,'expert');}assert.equal(calls,3);assert.equal(quick,1);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('no-result searches finish with an explicit gap instead of a repeated-tool failure',async()=>{
 let round=0,tools=0;
 const expert=createEvidenceExpert({relaxedAnswers:true,transport:async(url,options)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
  const payload=JSON.parse(options.body),output=round++<2?{action:'quick',query:'X999说明书'}:{action:'answer',claims:[],generalAdvice:['本次目录检索没有找到X999说明书，不能用其他型号代替。']};
  if(round===3)assert(!JSON.stringify(payload.response_format).includes('quick'));
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]})};
 }});
 const result=await expert.answer({message:'X999说明书',execute:async()=>{tools++;return {evidence:[],notice:{status:'not-found'}};}});
 assert.equal(result.status,'answer');assert.equal(round,3);assert.equal(tools,1);assert(!result.error);assert.match(result.reply,/没有找到/);
});
test('missing retrieval dependency is reported to the expert as unavailable, not a missing file or exception',async()=>{
 const api=createOfflineKnowledge({resourceAnswer:async()=>null,resourceSearch:async()=>null,expert:{answer:async({execute})=>{
  const quick=await execute('quick_answer',{query:'X123说明书'}),files=await execute('search_evidence',{kind:'files',query:'X123说明书'});
  assert.equal(quick.notice.status,'unavailable');assert.equal(quick.directAnswer,null);assert.equal(files.notice.status,'unavailable');
  return {status:'answer',actualMode:'expert',reply:'资料服务暂不可用，不能判断文件是否存在。'};
 }}});
 const server=http.createServer((req,res)=>api.handle(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'expert',sessionId:'missing-dependency',message:'X123说明书'})});assert.equal(response.status,200);assert.equal((await response.json()).status,'answer');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('file search uses expert-selected structured models even when the query contains only a category',async()=>{
 const searches=[];
 const api=createOfflineKnowledge({resourceSearch:async(query,options)=>{searches.push(query);assert.equal(options.allowModelSuggestion,false);return {results:[0,1,2].map(i=>({name:query.split(' ')[0]+'.'+i+'.pdf',resourceOnly:true,download:'/file'+i}))};},expert:{answer:async({execute})=>{
  const result=await execute('search_evidence',{kind:'files',query:'12网口处理器规格书',models:['HD-X100','HD-X200']});assert.equal(result.evidence.length,4);assert(result.evidence.some(x=>x.name.startsWith('HD-X100')));assert(result.evidence.some(x=>x.name.startsWith('HD-X200')));return {status:'answer',actualMode:'expert',reply:'两份规格书'};
 }}});
 const server=http.createServer((req,res)=>api.handle(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'expert',sessionId:'structured-model-files',message:'12网口处理器规格书'})});assert.equal(response.status,200);assert.equal((await response.json()).status,'answer');assert.deepEqual(searches,['HD-X100 12网口处理器规格书','HD-X200 12网口处理器规格书']);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('file tools can resolve parameter-only requirements through source product discovery',async()=>{
 let tools=0;
 const api=createOfflineKnowledge({resourceSearch:async()=>({results:[]}),expertMaterials:{evidence:()=>[{evidenceId:'discovery',sourceKind:'structured-product-discovery',modelIds:['HD-X100'],text:'X100:12网口，来源D2'}]},expert:{answer:async({execute})=>{
  const result=await execute('search_evidence',{kind:'resources',query:'12网口处理器规格书'});tools++;assert.equal(result.evidence[0].sourceKind,'structured-product-discovery');assert.equal(result.notice.status,'model-candidates');return {status:'answer',actualMode:'expert',reply:'继续查X100规格书'};
 }}});
 const server=http.createServer((req,res)=>api.handle(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'expert',sessionId:'discover-files',message:'12网口处理器规格书'})});assert.equal(response.status,200);assert.equal((await response.json()).status,'answer');assert.equal(tools,1);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('ninfer final streaming keeps the answer-only schema after empty tool results',async()=>{
 let round=0,streamed=false;
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'bonsai',owned_by:'ninfer'}]})};
  const payload=JSON.parse(options.body);round++;
  if(round===3){assert.equal(payload.stream,true);assert.equal(payload.response_format.type,'json_schema');const choices=payload.response_format.json_schema.schema.anyOf;assert.deepEqual(choices.map(x=>x.properties.action.const),['answer','clarify']);streamed=true;}
  const output=round<3?{action:'quick',query:'X999说明书'}:{action:'answer',claims:[{text:'当前目录未检索到对应说明书。',evidenceIds:[]}],generalAdvice:[],question:''};
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]})};
 }});
 const result=await expert.answer({message:'X999说明书',onAnswerDelta:()=>{},execute:async()=>({evidence:[],notice:{status:'not-found'}})});
 assert.equal(result.status,'answer');assert.equal(streamed,true);
});
function scriptedExpert(actions){let rounds=0;return {get rounds(){return rounds;},expert:createEvidenceExpert({relaxedAnswers:true,transport:async url=>{
 if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
 if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
 if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
 const action=actions[rounds++];if(!action)throw Error('unnecessary model round');return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(action)},finish_reason:'stop'}]})};
 }})};}
test('expert can delegate direct quick delivery in one model call without changing conversation mode',async()=>{
 const scripted=scriptedExpert([{action:'quick',query:'X123说明书',respondDirectly:true}]);
 const result=await scripted.expert.answer({message:'X123说明书',execute:async()=>({evidence:[{evidenceId:'file',name:'X123.pdf',text:'登记',download:'/file'}],directAnswer:{status:'answer',reply:'找到X123.pdf',results:[{name:'X123.pdf',download:'/file'}]}})});
 assert.equal(scripted.rounds,1);assert.equal(result.modelCallCount,1);assert.equal(result.actualMode,'expert');assert.equal(result.delegatedTo,'quick');assert.equal(result.results[0].download,'/file');
});
test('expert can deliver already located cards without another search or rewritten answer',async()=>{
 const scripted=scriptedExpert([{action:'deliver',evidenceIds:['s1']}]);let tools=0;
 const result=await scripted.expert.answer({message:'把已找到的文件发我',preparedEvidence:[{evidenceId:'file',name:'X123.pdf',text:'文件登记',download:'/file',readPerformed:true}],execute:async()=>{tools++;throw Error('unnecessary search');}});
 assert.equal(result.status,'answer');assert.equal(result.results[0].download,'/file');assert.equal(result.delegatedTo,'file-delivery');assert.equal(scripted.rounds,1);assert.equal(tools,0);
 const invalid=scriptedExpert([{action:'deliver',evidenceIds:['s999']}]);const rejected=await invalid.expert.answer({message:'给文件',preparedEvidence:[{evidenceId:'file',name:'X123.pdf',text:'登记',download:'/file',readPerformed:true}]});assert.equal(rejected.status,'unavailable');assert.equal(rejected.error,'expert-invalid-citation');
});
test('actual adapter and HTTP session preserve expert ownership after direct quick delivery',async()=>{
 let generations=0,quick=0;
 const expert=createEvidenceExpert({relaxedAnswers:true,transport:async(url,options)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
  const input=JSON.parse(JSON.parse(options.body).messages[1].content);
  const output=generations++===0?{action:'quick',query:'X123说明书',respondDirectly:true}:{action:'answer',claims:[],generalAdvice:['你问的是X123手册里的操作，先确认具体步骤。']};
  if(generations===2){assert.equal(input.message,'这个操作需要断电吗');assert(input.history.some(m=>m.role==='user'&&m.content==='X123说明书'));assert(input.history.some(m=>m.role==='assistant'&&m.content==='已找到X123说明书'));}
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]})};
 }});
 const api=createOfflineKnowledge({expert,resourceAnswer:async()=>{quick++;return {status:'answer',reply:'已找到X123说明书',results:[{name:'X123.pdf',resourceOnly:true,download:'/manual'}]};}});
 const server=http.createServer((req,res)=>api.handle(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const [index,message]of ['X123说明书','这个操作需要断电吗'].entries()){
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'expert',sessionId:'direct-quick-stays-expert',message})});const body=await response.json();assert.equal(response.status,200);assert.equal(body.actualMode,'expert');assert.equal(body.modelCallCount,1);if(index===0){assert.equal(body.delegatedTo,'quick');assert.equal(body.results[0].download,'/manual');}else assert.match(body.reply,/X123手册/);
 }assert.equal(quick,1);assert.equal(generations,2);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
