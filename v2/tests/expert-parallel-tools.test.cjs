'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const batch=require('../model-adapter/parallel-tools.cjs');
const search=query=>({action:'search',query,kind:'text',delivery:'review',problemDomain:'unspecified',goals:[query],concepts:[query]});
const done={action:'answer',claims:[],generalAdvice:['已完成所需查询。']};
function fixture(actions,extra={}){const requests=[];return {requests,expert:createEvidenceExpert({...extra,transport:async(url,opt)=>{
 if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic',owned_by:'ninfer'}]})};
 if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
 if(url.pathname==='/tokenize')return {ok:false};
 requests.push(JSON.parse(opt.body));assert(actions.length,'unexpected model retry');return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(actions.shift())}}],usage:{prompt_tokens:40,completion_tokens:30}})};
 }})};}
test('independent model-selected searches overlap and consume their real tool budget',async()=>{
 const f=fixture([{action:'parallel',tasks:[search('甲资料'),search('乙资料')]},done]);let release;const barrier=new Promise(r=>release=r),started=[];
 const r=await f.expert.answer({message:'分别查两项资料',execute:async(_name,args)=>{started.push(args.query);if(started.length===2)release();await barrier;return {evidence:[{evidenceId:args.query,name:args.query,text:'合成来源',readPerformed:true}]};}});
 assert.equal(started.length,2);assert.equal(r.modelCallCount,2);assert.equal(r.toolCallCount,2);assert(r.toolTrace.every(t=>t.purpose==='model-requested-parallel-evidence'));
 assert(f.requests[0].response_format.json_schema.schema.anyOf.some(c=>c.properties?.action?.const==='parallel'));
 assert(!JSON.stringify(f.requests[0].response_format).includes('"oneOf"'),'ninfer must receive compatible unions at every nesting level');
});
test('an explicit single query keeps one tool and one model call',async()=>{
 const f=fixture([{action:'quick',query:'甲文件',delivery:'if_complete'}]);let count=0;
 const r=await f.expert.answer({message:'给甲文件',execute:async()=>{count++;return {evidence:[],directAnswer:{status:'answer',answerBasis:'file-registry-columns',reply:'甲文件',results:[{resourceOnly:true,name:'甲.pdf',download:'/a'}]}};}});
 assert.equal(count,1);assert.equal(r.modelCallCount,1);
});
test('complete independent tool answers deliver without an extra model review',async()=>{
 const f=fixture([{action:'parallel',tasks:[{action:'quick',query:'甲文件',delivery:'if_complete'},{action:'quick',query:'乙文件',delivery:'if_complete'}]}]);
 const r=await f.expert.answer({message:'甲乙两份文件',execute:async(_n,args)=>({evidence:[],directAnswer:{status:'answer',answerBasis:'file-registry-columns',reply:args.query,results:[{resourceOnly:true,name:args.query,download:'/'+encodeURIComponent(args.query)}]}})});
 assert.equal(r.modelCallCount,1);assert.equal(r.results.length,2);
});
test('a found file and an explicit registry miss finish together without redundant analysis',async()=>{
 const f=fixture([{action:'parallel',tasks:[{action:'quick',query:'甲文件',delivery:'if_complete'},{action:'quick',query:'乙文件',delivery:'if_complete'}]}]);let partial=0;
 const r=await f.expert.answer({message:'甲乙两份文件',onPartialResult:()=>partial++,execute:async(_n,args)=>({evidence:[],directAnswer:args.query==='甲文件'?{status:'answer',answerBasis:'file-registry-columns',reply:'已找到甲',results:[{resourceOnly:true,name:'甲文件',download:'/a'}]}:{status:'not-found',answerBasis:'file-registry-columns',reply:'未找到乙对应文件',results:[]}})});
 assert.equal(r.modelCallCount,1);assert.equal(r.results.length,1);assert.equal(partial,1);assert(r.reply.includes('未找到乙'));assert(r.pendingRequests.some(x=>x.query==='乙文件'));
});
test('a finished file is delivered before a slow failed sibling and retained in final output',async()=>{
 const f=fixture([{action:'parallel',tasks:[{action:'quick',query:'甲文件',delivery:'if_complete'},search('乙记录')]},done]);let release,early=false;const barrier=new Promise(r=>release=r);
 const pending=f.expert.answer({message:'两项独立信息',onPartialResult:r=>{assert.equal(r.results[0].download,'/a');early=true;release();},execute:async(name)=>{if(name==='quick_answer')return {evidence:[],directAnswer:{status:'answer',answerBasis:'file-registry-columns',reply:'甲文件',results:[{resourceOnly:true,name:'甲.pdf',download:'/a'}]}};await barrier;assert(early);throw Error('synthetic-source-unavailable');}});
 const r=await pending;assert(early);assert(r.results.some(e=>e.download==='/a'));assert(r.toolTrace.some(t=>t.error==='synthetic-source-unavailable'));
});
test('unsafe, duplicate, dependent and over-budget batches are rejected before execution',()=>{
 for(const tasks of [[search('甲')],[search('甲'),{action:'calculate',userQuotes:['客户条件']}],[search('甲'),search('甲')],[search('甲'),{action:'read',blockId:99}]])assert.throws(()=>batch.prepare(tasks,3,[]),/expert-invalid-parallel/);
 assert.throws(()=>batch.prepare([search('甲'),search('乙')],1,[]),/expert-invalid-parallel/);
});
test('cancelled batches do not publish late results',async()=>{
 const controller=new AbortController();let late=false;
 await assert.rejects(()=>batch.execute([search('甲'),search('乙')],async()=>{controller.abort();return {};},{signal:controller.signal,onResult:()=>late=true}),/abort/i);assert.equal(late,false);
});
test('HTTP publishes a completed file before the final answer without changing its source link',async()=>{
 const {createServer}=require('../adapters/http/server.cjs');let release;const barrier=new Promise(r=>release=r);
 const file={resourceOnly:true,name:'合成文件.pdf',download:'/v2/offline/original/synthetic'};
 const offline=require('../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({expert:{answer:async({onPartialResult})=>{onPartialResult({results:[file]});await barrier;return {status:'answer',reply:'其余内容完成',results:[file]};}}});
 const server=createServer(undefined,{offlineKnowledge:offline});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({message:'合成资料',mode:'expert',sessionId:'parallel-http-test'})});
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='';while(!text.includes('"type":"partial"'))text+=decoder.decode((await reader.read()).value);
 const partial=text.split('\n').filter(Boolean).map(JSON.parse).find(e=>e.type==='partial');assert.equal(partial.data.results[0].download,file.download);assert.equal(partial.data.sessionId,'parallel-http-test');assert(!text.includes('"type":"final"'));release();while(true){const p=await reader.read();if(p.done)break;text+=decoder.decode(p.value);}assert(text.includes('"type":"final"'));
 }finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
