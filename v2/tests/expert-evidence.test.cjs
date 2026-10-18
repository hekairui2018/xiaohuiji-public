'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createExpertEvidence}=require('../adapters/http/expert-evidence.cjs');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
test('Expert case reading stays in one record, preserves the late result and checks exact suffixes',async()=>{
 const raw={stableId:'one',modelIds:['R512'],sourceExcerpt:'现象：模组闪烁\n'+'排查原文。'.repeat(1400)+'\n处理结果：更换排线后恢复',historicalSolution:'更换排线后恢复',scope:{chips:['ICN2038S']},sourceReference:{file:'cases.csv',locator:'第2行'}};
 const other={...raw,stableId:'two',modelIds:['R512S']};
 const tools=createExpertEvidence({request:async()=>({results:[]}),searchCases:()=>({results:[{id:'one'},{id:'two'}]}),caseMap:new Map([['one',raw],['two',other]]),clean:String,location:x=>x});
 const result=await tools.search({query:'模组 闪烁',kind:'cases',concepts:['模组','闪烁'],models:['R512']});assert.equal(result.evidence.length,1);
 let text='',offset=0;do{const page=await tools.read({blockId:result.evidence[0].blockId,offset});text+=page.evidence[0].text;offset=page.notice.nextOffset;}while(offset!==null);
 assert.match(text,/处理结果：更换排线后恢复/);assert.equal(await tools.read({blockId:7}),null);
 assert.equal((await tools.search({query:'模组 闪烁',kind:'cases',concepts:['模组','闪烁'],models:['R512'],chips:['LS9931']})).evidence.length,0);
});
test('Two original cases in one parsed block have distinct authorized handles and exact read anchors',async()=>{
 const calls=[];const tools=createExpertEvidence({caseMap:new Map(),searchCases:()=>({results:[]}),clean:String,location:x=>x,request:async url=>{calls.push(url);return url.startsWith('/proximity/search')?{results:[10,300].map(readAnchor=>({sha256:'a'.repeat(64),blockId:2,name:'cases.docx',readAnchor,text:'原文模组闪烁',proximity:{matchedConcepts:2,spanChars:4},locations:[{id:4}]}))}:{blocks:[{text:'最终解决结果',locator:{paragraph:3}}],nextOffset:null,totalChars:7,boundary:'explicit-case-marker'};}});
 const result=await tools.search({kind:'text',query:'模组 闪烁',concepts:['模组','闪烁']});assert.notEqual(result.evidence[0].blockId,result.evidence[1].blockId);
 await tools.read({blockId:result.evidence[1].blockId});assert.match(calls.at(-1),/anchor=300/);
 await assert.rejects(()=>tools.read({blockId:result.evidence[0].blockId,offset:-1}),/invalid-tool/);
});
test('Model sees read text beyond 1000 characters, pagination and original positions without bypassing citation checks',async()=>{
 let round=0;const actions=[{action:'search',kind:'cases',query:'模组 闪烁',concepts:['模组','闪烁'],goals:['核对处理结果']},{action:'read',blockId:2},{action:'answer',claims:[{text:'历史案例记录最终换线恢复',evidenceIds:['read-case']}],generalAdvice:[],question:''}];
 const expert=createEvidenceExpert({transport:async(url,options)=>{if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};const payload=JSON.parse(options.body);if(round===2)assert.match(JSON.stringify(payload.messages),/最终换线恢复/);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(actions[round++])},finish_reason:'stop'}]})};}});
 const r=await expert.answer({message:'模组闪烁',route:{intent:'expert'},execute:async name=>({evidence:[{evidenceId:name==='read_document'?'read-case':'case-a',blockId:2,name:'案例汇总',text:name==='read_document'?'原文。'.repeat(500)+'最终换线恢复':'模组闪烁',readPerformed:name==='read_document',proximity:{hits:[{blockId:10,charStart:4}]}}]})});
 assert.equal(r.status,'answer');assert.equal(r.toolTrace[1].evidenceLocations[0].readPerformed,true);assert.match(r.reply,/最终换线恢复/);
});

test('Actual HTTP expert executor dispatches its authorized proximity read instead of the legacy block map',async()=>{
 const http=require('node:http'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
 const index=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.startsWith('/proximity/search')?{results:[{sha256:'a'.repeat(64),blockId:10,readAnchor:0,name:'cases.docx',text:'模组闪烁',locator:{paragraph:1},proximity:{matchedConcepts:2,spanChars:4,hits:[{blockId:10}]},locations:[{id:2}]}]}:{blocks:[{blockId:10,text:'处理结果：换线恢复',locator:{paragraph:2}}],nextOffset:null,totalChars:10,boundary:'explicit-case-marker'}));});
 await new Promise(r=>index.listen(0,'127.0.0.1',r));
 const api=createOfflineKnowledge({resourceBase:'http://127.0.0.1:'+index.address().port,expert:{answer:async({execute})=>{const found=await execute('search_evidence',{kind:'text',query:'模组 闪烁',concepts:['模组','闪烁']});const read=await execute('read_document',{blockId:found.evidence[0].blockId});assert.match(read.evidence[0].text,/换线恢复/);assert.equal(read.evidence[0].readPerformed,true);await assert.rejects(()=>execute('read_document',{blockId:9999}),/invalid-tool/);return {status:'answer',reply:'read verified'};}}});
 const server=http.createServer((req,res)=>api.handle(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const result=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'expert',sessionId:'synthetic-proximity-http',message:'模组闪烁'})}).then(r=>r.json());assert.equal(result.reply,'read verified');}finally{server.closeAllConnections();index.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>index.close(r))]);}
});

test('Discarded candidates never authorize a guessed read handle',async()=>{
 const tools=createExpertEvidence({caseMap:new Map(),searchCases:()=>({results:[]}),clean:String,location:x=>x,request:async()=>({results:Array.from({length:6},(_,i)=>({sha256:String(i),blockId:i+10,readAnchor:0,name:'cases.docx',text:'模组闪烁',proximity:{matchedConcepts:2,spanChars:i+1,hits:[]},locations:[]}))})});
 const r=await tools.search({kind:'text',query:'模组 闪烁',concepts:['模组','闪烁']});assert.equal(r.evidence.length,4);
 assert.equal(await tools.read({blockId:1_000_000_006}),null);assert.equal(await tools.read({blockId:15}),null);
});

test('General advice cannot bypass original-reading requirements by quoting company cases or tuning thresholds',async()=>{
 for(const advice of ['公司案例中通讯脉宽不低于7','通讯脉宽不低于7']){const expert=createEvidenceExpert({transport:async url=>url.pathname==='/props'?{ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})}:url.pathname==='/tokenize'?{ok:false,json:async()=>({})}:url.pathname==='/v1/models'?{ok:true,json:async()=>({data:[{id:'synthetic'}]})}:{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({action:'answer',claims:[],generalAdvice:[advice],question:''})},finish_reason:'stop'}]})}});const r=await expert.answer({message:'闪烁',execute:async()=>({evidence:[]})});assert.match(r.error,/expert-(uncited-company-claim|ungrounded-setting)/);assert.equal(r.status,'unavailable');}
});
