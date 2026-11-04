'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const business=require('../domain/knowledge/business-language.cjs'),{planResourceQuery:plan}=require('../domain/knowledge/resource-query.cjs'),{createSectionAnswers}=require('../adapters/http/section-answers.cjs');
test('confirmed cloud aliases share identity without rewriting filenames or ambiguous signage',()=>{
 for(const s of ['云信发','小灰云信发','小灰云信息发布系统'])assert.equal(business.canonicalBusinessText(s),'小灰云');
 assert.equal(business.canonicalBusinessText('云信发介绍.pdf'),'云信发介绍.pdf');assert.equal(business.canonicalBusinessText('信发改单机'),'信发改单机');
 assert.equal(business.canonicalBusinessText('小灰云星空'),'小灰云星空');
});
test('file intent and software identity survive informal introduction wording',()=>{
 for(const q of ['发一下小灰云信发的介绍文档','云信发资料','云平台得资料']){const p=plan(q);assert.equal(p.answerNeed,'resource');assert.deepEqual(p.software,['小灰云']);assert.equal(p.query,'小灰云 说明书');}
 assert.notEqual(plan('小灰云介绍').answerNeed,'resource');
});
test('retrieval relations preserve technical fields and never equate candidate identities',()=>{
 const p=plan('华杰室内P3芯片9937、译码9736提供一个参数');assert(p.categories.includes('module-config'));assert(p.query.includes('9937')&&p.query.includes('9736'));
 assert(business.relationsFor('三信号上屏，共开窗3个').some(r=>r.id==='simultaneous-windows'));
 assert(business.relationsFor('RF模块').length===0);
 const candidates=business.identityCandidates('3566BOX E63-24-00688',['HD-3566S-BOX','HD-E63','HD-3566MV']);assert.equal(candidates.length,2);assert(candidates.every(c=>c.confirmed===false));assert.deepEqual(candidates[0].candidates,['HD-3566S-BOX']);
});
test('same quick tool returns cloud files and excludes unrelated platform parameters',async()=>{
 let calls=0;const service=createSectionAnswers({registry:async q=>{calls++;assert.equal(q,'小灰云 说明书');return {results:[{name:'小灰云信息发布使用说明书.pdf',kind:'manual',resourceOnly:true,download:'/manual'},{name:'RK3588规格书.pdf',kind:'spec',resourceOnly:true,download:'/wrong'}]};},knowledge:async()=>{throw Error('must not search platform parameters');}});
 const r=await service.answer('发一下云信发介绍文档');assert.equal(calls,1);assert.equal(r.results.length,1);assert.equal(r.modelCallCount,0);assert.equal(r.results[0].download,'/manual');
});
