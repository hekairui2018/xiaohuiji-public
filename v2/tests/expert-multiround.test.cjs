'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
function model(actions){let calls=0;return {calls:()=>calls,transport:async(url,options)=>{
 if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic',owned_by:'ninfer'}]})};
 if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:16384}})};
 // This suite verifies tool sequencing; exercise the server-tokenizer path.
 // Capacity and tokenizer failures have their own context-budget tests.
 if(url.pathname==='/tokenize')return {ok:true,json:async()=>({tokens:Array(1024).fill(1)})};
 const body=JSON.parse(options.body);assert.equal(body.chat_template_kwargs.enable_thinking,true);calls++;assert(actions.length,'Must stop after a final answer');return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(actions.shift()),reasoning_content:'比较当前证据'}}],usage:{prompt_tokens:120,completion_tokens:50,completion_tokens_details:{reasoning_tokens:10}}})};
 }};}
test('Enabled expert can search, read original evidence and answer across model rounds with Thinking',async()=>{
 const fake=model([{action:'search',kind:'text',query:'设备状态核对',goals:['查原始状态说明'],concepts:['设备状态']},{action:'read',blockId:7},{action:'answer',claims:[{text:'原文确认的处理方式',evidenceIds:['s1']}],generalAdvice:[],question:''}]),tools=[];
 const expert=createEvidenceExpert({...fake,maxModelCalls:12,maxToolCalls:8,thinkingEnabled:true});
 const result=await expert.answer({message:'查明设备状态后给出处理建议',sessionState:{},execute:async(name)=>{tools.push(name);return {evidence:[{evidenceId:'block-7',blockId:7,name:'测试原件',text:'原文确认的处理方式',readAvailable:name==='search_evidence',readPerformed:name==='read_document'}]};}});
 assert.equal(result.status,'answer',JSON.stringify({error:result.error,calls:result.modelCallCount,tools}));assert.equal(result.modelCallCount,3);assert.equal(fake.calls(),3);assert.deepEqual(tools,['search_evidence','read_document']);assert(result.modelCalls.every(c=>c.thinkingEnabled===true));
});
test('A full expert budget still stops after one sufficient answer rather than filling all rounds',async()=>{
 const fake=model([{action:'answer',claims:[{text:'已有原文足够回答',evidenceIds:['known']}],generalAdvice:[]}]);
 const result=await createEvidenceExpert({...fake,maxModelCalls:12,maxToolCalls:8,thinkingEnabled:true}).answer({message:'核对当前资料',preparedEvidence:[{evidenceId:'known',name:'测试原件',text:'已有原文足够回答',readPerformed:true}],execute:async()=>{throw Error('Unnecessary tool');}});
 assert.equal(result.status,'answer');assert.equal(result.modelCallCount,1);assert.equal(fake.calls(),1);
});
test('Social model fallback keeps plain text instead of inheriting relaxed technical JSON instructions',async()=>{
 let calls=0;
 const transport=async(url,options)=>{if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic',owned_by:'ninfer'}]})};if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:16384}})};if(url.pathname==='/tokenize')return {ok:false};const body=JSON.parse(options.body);assert.equal(body.chat_template_kwargs.enable_thinking,false);assert(!body.response_format);assert(!body.messages[0].content.includes('输出一种协议动作'));calls++;return {ok:true,status:200,json:async()=>({choices:[{message:{content:'你好！请告诉我设备型号或问题。'},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:12}})};};
 const r=await createEvidenceExpert({transport,maxModelCalls:12,thinkingEnabled:true,relaxedAnswers:true}).answer({message:'你好',route:{intent:'social'},execute:async()=>{throw Error('Greeting must not search');}});
 assert.equal(r.status,'answer');assert.equal(r.reply,'你好！请告诉我设备型号或问题。');assert.equal(calls,1);
});
