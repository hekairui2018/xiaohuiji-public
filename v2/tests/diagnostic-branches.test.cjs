'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createAftersalesService}=require('../domain/aftersales/service.cjs'),{createDialogueService}=require('../adapters/http/dialogue-service.cjs');
const {createAftersalesAudit}=require('../acceptance/aftersales.cjs');
const knowledge=loadKnowledge(),app=createApp(),cases=knowledge.cases(),source=cases.find(c=>c.legacyId==='AS-0029'),audit=createAftersalesAudit(knowledge);
const input=()=>({schemaVersion:'2.0',operation:'aftersales',symptoms:[source.phenomenon.split('\n')[0]],providedDevices:source.modelIds.map(modelId=>({modelId}))});
test('Real unsuccessful EDID flow preserves observations and asks the next sourced case scope after unresolved feedback',async()=>{
 const d=input();let r=await app.dialogue(d);const id=r.diagnosis.activeCaseId;assert.equal(id,source.stableId);
 d.observations=[{checkId:id+'-scope',result:'pass'},...source.workflow.nodes.map(n=>({checkId:n.checkId,result:'fail'})),{checkId:id+'-resolution',result:'fail'}];
 r=await app.dialogue(d);assert.equal(r.status,'needs_input');assert.notEqual(r.diagnosis.activeCaseId,id);assert.equal(r.diagnosis.state,'confirm-scope');assert.equal(r.diagnosis.conclusion,null);assert.ok(r.diagnosis.branches.some(b=>b.caseId===id&&b.status==='phenomenon-persists'));assert.ok(audit(r,d).automaticPassed);
 const wrong=structuredClone(r);wrong.diagnosis.branches.find(b=>b.caseId===id).checkId='invented-condition';assert.equal(audit(wrong,d).automaticPassed,false);
});
test('Negative prerequisites on a genuine conditional case never loop into executing an inapplicable source step',()=>{
 const c=cases.find(c=>c.legacyId==='AS-0104'),service=createAftersalesService({cases:()=>[c]}),d={schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]],providedDevices:c.modelIds.map(modelId=>({modelId})),observations:[{checkId:c.stableId+'-scope',result:'pass'}]};
 let r=service(d);assert.equal(r.diagnosis.state,'confirm-step-condition');d.observations.push({checkId:r.diagnosis.activeCheckId,result:'fail'});r=service(d);assert.equal(r.diagnosis.state,'supported-branches-exhausted');assert.equal(r.diagnosis.conclusion,null);assert.equal(r.status,'needs_input');assert.ok(r.diagnosis.branches.some(b=>b.status==='step-condition-rejected'));assert.ok(audit(r,d).automaticPassed);
});
test('Exhausted sourced hypotheses ask for new conditions instead of silently repeating, solving or changing the fault cause',async()=>{
 const d=input(),first=await app.dialogue(d);d.observations=first.diagnosis.branches.map(b=>({checkId:b.caseId+'-scope',result:'fail'}));const r=await app.dialogue(d);assert.equal(r.diagnosis.state,'supported-branches-exhausted');assert.equal(r.diagnosis.conclusion,null);assert.ok(r.missing_parameters.length);assert.ok(audit(r,d).automaticPassed);
});
test('Real multiround feedback keeps diagnostic context; new stated conditions reset confirmations and retain history',async()=>{
 const chat=createDialogueService(app),sessionId='edid-continue';await chat({sessionId,demand:input()});await chat({sessionId,message:'条件一致'});await chat({sessionId,message:'无效果'});let r=await chat({sessionId,message:'无效果'});assert.equal(r.result.diagnosis.state,'verify-phenomenon');
 r=await chat({sessionId,message:'未解决'});assert.equal(r.result.operation,'aftersales');assert.equal(r.result.diagnosis.state,'confirm-scope');assert.equal(r.result.diagnosis.conclusion,null);assert.ok(r.result.normalizedDemand.observations.length>=4);
 r=await chat({sessionId,message:'补充现象：R712更换网线后黑屏'});assert.equal(r.result.operation,'aftersales');assert.equal(r.result.normalizedDemand.observations.length,0);assert.ok(r.result.normalizedDemand.provenance.diagnosticRounds[0].observations.length>=4);assert.ok(r.result.normalizedDemand.providedDevices.some(d=>d.modelId==='HD-R712'));assert.notEqual(r.result.status,'ready');
});
