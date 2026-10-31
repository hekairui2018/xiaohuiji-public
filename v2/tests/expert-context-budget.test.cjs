'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createExpertContext}=require('../model-adapter/expert-context.cjs');
const base=new URL('http://localhost');
const response=j=>({ok:true,json:async()=>j});
const props=()=>response({default_generation_settings:{n_ctx:16384}});
function fixture(transport){return createExpertContext({base,transport});}
function input(history=[]){return {message:'当前问题',facts:{model:'R712'},history};}
function messages(){return [{role:'system',content:'资料规则'},{role:'user',content:''},{role:'user',content:'当前证据保留'}];}

test('An expired expert deadline performs no capacity or tokenizer requests',async()=>{
 let calls=0;const context=fixture(async()=>{calls++;return props();});
 await assert.rejects(context.prepare(messages(),input(),null,512,{deadline:Date.now()-1}),/expert-timeout/);assert.equal(calls,0);
});

test('Capacity discovery shares the overall deadline and interrupts an unresponsive transport',async()=>{
 let observed;const context=fixture(async(_url,options)=>{observed=options.signal;return new Promise(()=>{});});
 // A referenced timer keeps this synthetic transport alive while AbortSignal's
 // own timer is unreferenced; real HTTP requests naturally keep the loop alive.
 const keepAlive=setTimeout(()=>{},1000);
 try{await assert.rejects(context.prepare(messages(),input(),null,512,{deadline:Date.now()+30}),/expert-timeout/);assert.equal(observed.aborted,true);}finally{clearTimeout(keepAlive);}
});

test('Caller cancellation interrupts tokenizer body reading without evicting history',async()=>{
 const controller=new AbortController(),history=[{role:'user',content:'已有条件'},{role:'assistant',content:'已有答复'}],data=input(history);
 let observed;const context=fixture(async(url,options)=>{if(url.pathname==='/props')return props();observed=options.signal;setTimeout(()=>controller.abort(),10);return {ok:true,json:()=>new Promise(()=>{})};});
 await assert.rejects(context.prepare(messages(),data,null,512,{signal:controller.signal}),error=>error.name==='AbortError');
 assert.equal(observed.aborted,true);assert.equal(data.history.length,2);
});

test('History eviction checks cancellation before requesting another tokenization',async()=>{
 const controller=new AbortController(),data=input(Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'历史'+i})));
 let tokenizations=0;const context=fixture(async(url)=>{if(url.pathname==='/props')return props();tokenizations++;if(tokenizations===2)controller.abort();return response({tokens:Array(16000).fill(1)});});
 await assert.rejects(context.prepare(messages(),data,null,512,{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(tokenizations,2);assert.equal(data.history.length,6);
});

test('The overall deadline is checked again after slow tokenizer work, without returning byte fallback',async()=>{
 let calls=0;const context=fixture(async url=>{if(url.pathname==='/props')return props();calls++;const until=Date.now()+35;while(Date.now()<until){}return response({tokens:[1]});});
 await assert.rejects(context.prepare(messages(),input(),null,512,{deadline:Date.now()+20}),/expert-timeout/);assert.equal(calls,1);
});

test('An unavailable tokenizer retains the conservative byte estimate when budget remains',async()=>{
 const context=fixture(async url=>url.pathname==='/props'?props():{ok:false,json:async()=>({})}),data=input([{role:'user',content:'已有条件'}]),conversation=messages();
 const result=await context.prepare(conversation,data,null,512,{deadline:Date.now()+1000});
 assert.equal(result.countMethod,'utf8-byte-upper-bound');assert.equal(result.droppedHistoryMessages,0);assert.equal(result.historyMessages,1);assert.equal(data.facts.model,'R712');assert.match(conversation[2].content,/当前证据/);
});
test('accumulated evidence is compacted before customer history at actual capacity pressure',async()=>{
 const context=fixture(async url=>url.pathname==='/props'?props():{ok:false,json:async()=>({})});
 const data=input([{role:'user',content:'客户已确认R712和芯片'}]);data.preparedEvidence={evidence:[{evidenceId:'s1',text:'开头条件'+'.'.repeat(15000)+'结尾结果',contextComplete:true,scope:{model:'R712'}},{evidenceId:'s2',text:'另一条事实'}]};
 const result=await context.prepare(messages(),data,null,4096);
 assert.equal(result.compactedEvidence,1);assert.equal(result.droppedHistoryMessages,0);assert.equal(data.preparedEvidence.evidence[0].contextComplete,false);assert.match(data.preparedEvidence.evidence[0].text,/开头条件/);assert.match(data.preparedEvidence.evidence[0].text,/结尾结果/);assert.equal(data.preparedEvidence.evidence[0].scope.model,'R712');
});
