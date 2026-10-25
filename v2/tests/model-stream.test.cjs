'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {modelStream,answerText}=require('../model-adapter/model-stream.cjs');
test('Only answer text escapes the stream, with partial JSON and Unicode escapes handled',()=>{
 assert.equal(answerText('{"action":"answer","claims":[{"text":"灰度\\u7b'),'灰度');
 assert.equal(answerText('{"action":"answer","claims":[{"text":"灰度\\u7b49级","evidenceIds":["s1"]}]}'),'灰度等级');
 assert.equal(answerText('{"action":"clarify","question":"请提供型号"}'),'请提供型号');
 assert.equal(answerText('{"action":"search","text":"DO_NOT_SHOW"}'),'');
 const seen=[],stream=modelStream(t=>seen.push(t));
 stream.push('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE_REASONING'}}]})+'\n\n');
 stream.push('data: '+JSON.stringify({choices:[{delta:{content:'正文'}}]})+'\n\n');
 stream.push('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{completion_tokens:2}})+'\n\ndata: [DONE]\n\n');
 assert.deepEqual(seen,['正文']);assert.equal(stream.finish().usage.completion_tokens,2);
 assert.throws(()=>modelStream().finish(),/incomplete/);
});
test('Local transport delivers content before upstream completion, including split UTF-8 bytes',async()=>{
 let callbackSeen=false;
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});const bytes=Buffer.from('data: '+JSON.stringify({choices:[{delta:{content:'灰度'}}]})+'\n\n');for(const b of bytes)res.write(Buffer.from([b]));setTimeout(()=>{assert.equal(callbackSeen,true);res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');},80);});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{const response=await require('../model-adapter/local-model-transport.cjs').localModelTransport(new URL('http://127.0.0.1:'+server.address().port),{onContentDelta:text=>{assert.equal(text,'灰度');callbackSeen=true;}});assert.equal((await response.json()).choices[0].message.content,'灰度');}finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
});
test('Streaming still makes one generation and validates the final cited answer',async()=>{
 const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');let calls=0;const seen=[];
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'qwen3.8-synthetic'}]})};if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};if(url.pathname==='/tokenize')return {ok:false};
  const body=JSON.parse(options.body);assert.equal(body.stream,true);assert.equal(body.response_format,undefined);calls++;
  const text=JSON.stringify({action:'answer',claims:[{text:'支持256级灰度。',evidenceIds:['s1']}]});options.onContentDelta(text.slice(0,text.indexOf('256')));options.onContentDelta(text);
  return {ok:true,json:async()=>({choices:[{message:{content:text},finish_reason:'stop'}]})};
 }});
 const result=await expert.answer({message:'灰度',route:{intent:'technical'},preparedEvidence:[{evidenceId:'original',text:'支持256级灰度。',readPerformed:true}],onAnswerDelta:text=>seen.push(text)});
 assert.equal(result.status,'answer');assert.equal(calls,1);assert.equal(seen.at(-1),'支持256级灰度。');assert.deepEqual(result.claims[0].evidenceIds,['original']);assert.ok(seen.every(t=>!t.includes('evidenceIds')));
});
