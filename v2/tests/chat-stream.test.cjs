'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function readResponse(){const scope={window:{},TextDecoder};vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/chat-controller.js'),'utf8'),scope);return scope.window.ChatController.readResponse;}
test('Browser receives growing text before final data; interrupted streams do not become answers',async()=>{
 let finish;const early=[],consume=readResponse();
 const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'text',text:'灰度'})+'\n'));finish=()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'final',data:{reply:'灰度等级'}})+'\n'));controller.close();};}}),{headers:{'Content-Type':'application/x-ndjson'}});
 const pending=consume(response,text=>early.push(text));await new Promise(done=>setImmediate(done));assert.deepEqual(early,['灰度']);finish();assert.equal((await pending).reply,'灰度等级');
 await assert.rejects(()=>consume(new Response('{"type":"text","text":"partial"}\n',{headers:{'Content-Type':'application/x-ndjson'}})),/回复中断/);
});
for(const publicView of [false,true])test((publicView?'Public':'Local')+' HTTP endpoint streams and completes using its existing final response',async()=>{
 const {createServer}=require('../adapters/http/server.cjs');
 const expert={answer:async({onAnswerDelta})=>{assert.equal(typeof onAnswerDelta,'function');onAnswerDelta('合成正文');await new Promise(done=>setTimeout(done,30));return {status:'answer',actualMode:'expert',reply:'合成正文已完成',results:[],modelCallCount:1};}};
 const options=publicView?{accessGuard:req=>{req.v2Public=true;return true;},publicCatalog:{transform:x=>x},publicChat:{answer:async(_input,{onAnswerDelta})=>{const result=await expert.answer({onAnswerDelta});return {code:200,body:result};}}}:{offlineKnowledge:require('../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({expert})};
 const server=createServer(undefined,options);await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({message:'合成显示测试',mode:'expert'})});assert.match(response.headers.get('content-type'),/ndjson/);const seen=[];const result=await readResponse()(response,text=>seen.push(text));assert.deepEqual(seen,['合成正文']);assert.equal(result.reply,'合成正文已完成');}finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
});
