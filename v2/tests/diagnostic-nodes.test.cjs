'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createApp}=require('../app/bootstrap.cjs');
const {createDialogueService}=require('../adapters/http/dialogue-service.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge}),cases=knowledge.cases();
test('All derived nodes preserve complete original procedure text and stable source spans',()=>{
 for(const c of cases)for(const original of c.checks){const nodes=c.workflow.nodes.filter(n=>n.parentCheckId===original.checkId);
  assert.equal(nodes.map(n=>n.text).join(''),original.text,c.legacyId);for(const n of nodes)assert.equal(original.text.slice(n.sourceSpan.start,n.sourceSpan.end),n.text);
 }assert.ok(cases.filter(c=>c.workflow.nodes.length>1).length>50);
});
test('Real unsuccessful EDID checks progress separately and do not become successful repair claims',async()=>{
 const c=cases.find(c=>c.legacyId==='AS-0029');assert.equal(c.workflow.nodes.length,2);assert.ok(c.workflow.nodes.every(n=>n.historicalResult==='fail'));
 const demand={schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]],providedDevices:c.modelIds.map(modelId=>({modelId})),observations:[{checkId:c.stableId+'-scope',result:'pass'}]};
 let r=await app.dialogue(demand);assert.equal(r.diagnosis.activeCaseId,c.stableId);assert.equal(r.diagnosis.activeCheckId,c.workflow.nodes[0].checkId);
 demand.observations.push({checkId:c.workflow.nodes[0].checkId,result:'completed'});r=await app.dialogue(demand);assert.equal(r.diagnosis.state,'observe-step-result');assert.equal(r.diagnosis.activeCheckId,c.workflow.nodes[0].checkId);
 demand.observations.at(-1).result='fail';r=await app.dialogue(demand);assert.equal(r.diagnosis.activeCheckId,c.workflow.nodes[1].checkId);assert.equal(r.diagnosis.conclusion,null);
 demand.observations.push({checkId:c.workflow.nodes[1].checkId,result:'fail'});r=await app.dialogue(demand);assert.equal(r.diagnosis.state,'verify-phenomenon');assert.equal(r.status,'needs_input');
});
test('An unexpectedly positive result verifies the actual symptom before further historical actions',async()=>{
 const c=cases.find(c=>c.legacyId==='AS-0029');const r=await app.dialogue({schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]],observations:[{checkId:c.stableId+'-scope',result:'pass'},{checkId:c.workflow.nodes[0].checkId,result:'pass'}]});
 assert.equal(r.diagnosis.state,'verify-phenomenon');assert.equal(r.diagnosis.conclusion,null);assert.equal(r.diagnosis.workflowPath.length,1);
});
test('Explicit conditional source steps require their own confirmed conditions',async()=>{
 const c=cases.find(c=>c.recordType==='case'&&c.workflow.nodes[0]?.requiresConditionConfirmation);const r=await app.dialogue({schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]],providedDevices:c.modelIds.map(modelId=>({modelId})),observations:[{checkId:c.stableId+'-scope',result:'pass'}]});
 assert.equal(r.diagnosis.activeCaseId,c.stableId);assert.equal(r.diagnosis.state,'confirm-step-condition');assert.equal(r.diagnosis.conclusion,null);
});
test('Natural-language completion acknowledges only the active EDID step; results remain separate',async()=>{
 const c=cases.find(c=>c.legacyId==='AS-0029'),chat=createDialogueService(app),sessionId='real-edid';let r=await chat({sessionId,demand:{schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]],providedDevices:c.modelIds.map(modelId=>({modelId}))}});
 r=await chat({sessionId,message:'条件一致'});assert.equal(r.result.diagnosis.activeCheckId,c.workflow.nodes[0].checkId);
 r=await chat({sessionId,message:'已完成排查'});assert.equal(r.result.diagnosis.state,'observe-step-result');assert.equal(r.result.diagnosis.workflowPath.length,1);
 r=await chat({sessionId,message:'无效果'});assert.equal(r.result.diagnosis.activeCheckId,c.workflow.nodes[1].checkId);assert.equal(r.result.diagnosis.conclusion,null);
});
