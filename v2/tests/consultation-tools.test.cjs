'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {consultationPlan}=require('../domain/knowledge/consultation-plan.cjs');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const packet=()=>({version:1,question:{text:'怎样导出配置',intent:'operation',models:['HD-X1'],software:[],confirmed:{},assumptions:[],missing:[]},outcome:'not-retrieved',gaps:[{code:'no-qualified-evidence'}],evidence:[]});
function fixture(actions,execute,captured=[]){let i=0;return createEvidenceExpert({autoReadCandidates:1,maxAnswerRepairs:0,transport:async (url,request)=>{if(url.pathname==='/v1/chat/completions')captured.push(JSON.parse(request.body));return {ok:true,status:200,json:async()=>url.pathname==='/v1/models'?{data:[{id:'synthetic-business-tools'}]}:url.pathname==='/props'?{default_generation_settings:{n_ctx:131072}}:url.pathname==='/tokenize'?{tokens:[1]}:{choices:[{message:{content:JSON.stringify(actions[Math.min(i++,actions.length-1)])},finish_reason:'stop'}]}};}}).answer({message:'怎样导出配置',route:{intent:'operation',models:['HD-X1']},responsePlan:{purpose:'operation',evidencePacket:packet(),businessPlan:{supplementalSearch:{enabled:true,maxSearches:2,goals:['导出步骤']}}},execute});}
test('Business plans expose calculation and diagnosis capabilities, but missing identity does not permit a guessed device search',()=>{
 const p=packet();const plan=consultationPlan({intent:'operation',models:['HD-X1'],original:'怎样导出配置'},p);
 assert.equal(plan.supplementalSearch.enabled,true);assert.ok(plan.capabilities.some(x=>x.action==='calculate'));assert.ok(plan.capabilities.some(x=>x.action==='diagnose'));
 assert.equal(consultationPlan({unknownModels:['HD-UNKNOWN']},p).supplementalSearch.enabled,false);
 assert.equal(consultationPlan({}, {...p,outcome:'needs-input'}).supplementalSearch.enabled,false);
});
test('A missing first-pass paragraph can be found by a model-selected task expression and read before answering',async()=>{
 const calls=[],captured=[],body='打开配置菜单，选择保存到文件，完成后核对文件存在。';
 const r=await fixture([{action:'search',kind:'text',query:'X1 保存配置 文件',concepts:['保存配置'],models:['HD-X1'],goals:['导出配置步骤']},{action:'answer',claims:[{text:'在配置菜单选择保存到文件，完成后检查文件。',evidenceIds:['new-source'],sourceExcerpt:body}],generalAdvice:[],question:''}],async(name,args)=>{
  calls.push({name,args});return name==='search_evidence'?{evidence:[{evidenceId:'new-source',name:'X1操作手册.pdf',text:'保存配置',blockId:456,readAvailable:true,readPerformed:false,modelIds:['HD-X1']}]}:{evidence:[{evidenceId:'new-source',name:'X1操作手册.pdf',text:body,blockId:456,readAvailable:false,readPerformed:true,nextOffset:null,modelIds:['HD-X1'],knowledgeUnit:{complete:true}}]};
 },captured);
 assert.equal(captured[1].messages.length,2,'Read evidence is sent once without duplicate tool transcripts');assert.equal(r.status,'answer');assert.deepEqual(calls.map(c=>c.name),['search_evidence','read_document']);assert.equal(r.modelCallCount,2);assert.equal(r.supplementalSearchCount,1);assert.equal(r.evidenceOutcome,'answerable');assert.doesNotMatch(r.reply,/尚未取得足以回答/);
});
test('Two targeted searches are the maximum even if the model keeps changing its wording',async()=>{
 const search=n=>({action:'search',kind:'text',query:'导出'+n,concepts:['导出'],goals:['配置'],reason:'补查保存配置的入口'});let calls=0;
 const r=await fixture([search(1),search(2),search(3)],async()=>{calls++;return {evidence:[]};});
 assert.equal(calls,2);assert.equal(r.status,'unavailable');assert.equal(r.error,'expert-tool-limit');
});
