'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs');
const {loadDataset}=require('../adapters/data/load-dataset.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createAcceptance}=require('../acceptance/index.cjs');
const {auditSsm}=require('../acceptance/ssm.cjs');
const {exportSsm}=require('../domain/ordering/output/ssm-export.cjs');
const {loadSsmShell}=require('../adapters/data/load-ssm-shell.cjs');
const {requirement}=require('../tools/run-acceptance.cjs');
const dataset=loadDataset(),knowledge=loadKnowledge(),app=createApp({dataset,knowledge}),audits=createAcceptance({dataset,knowledge});
test('Automatic ordering checks detect BOM, topology, counts, identities and geometry independently of a true validation flag',async()=>{
 const result=await app.dialogue(requirement(dataset.modules().find(m=>m.id===10),10,10));assert.ok(audits.ordering(result).automaticPassed);assert.equal(audits.ordering(result).status,'pending_manual');
 for(const mutate of [r=>r.bom[0].quantity++,r=>r.topology.receivers.pop(),r=>r.plan.cells[1].id=r.plan.cells[0].id,r=>r.plan.controller.totalPoints++,r=>r.plan.module.interface='HUB12',r=>r.plan.ports[0].id=999]){const corrupted=structuredClone(result);mutate(corrupted);assert.equal(corrupted.validation.passed,true);assert.equal(audits.ordering(corrupted).automaticPassed,false);}
});
test('The runtime does not publish an injected ready plan with wrong BOM',async()=>{
 const demand=requirement(dataset.modules().find(m=>m.id===10),10,10),result=await app.dialogue(demand);result.bom[1].quantity++;
 const wrong=createApp({dataset,knowledge,handlers:{ordering:()=>result}});await assert.rejects(wrong.dialogue(demand),/Automatic ordering acceptance/);
});
test('Diagnosis checks reject missing steps, invented steps, unconfirmed scopes and unsupported conclusions',async()=>{
 const c=knowledge.cases().find(c=>c.legacyId==='AS-0029'),demand={schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]]};
 const result=await app.dialogue(demand);assert.ok(audits.aftersales(result,demand).automaticPassed);
 for(const mutate of [r=>r.diagnosis.checks.splice(1,1),r=>r.diagnosis.checks.push({checkId:'made-up',text:'任意升级固件即可修复'}),r=>r.diagnosis.state='execute-checks',r=>r.diagnosis.conclusion={kind:'confirmed-cause',text:'已确认故障原因'}]){const corrupted=structuredClone(result);mutate(corrupted);assert.equal(audits.aftersales(corrupted,demand).automaticPassed,false);}
 const bypass=structuredClone(result);bypass.status='ready';bypass.diagnosis.state='user-reported-resolution';bypass.diagnosis.conclusion={kind:'customer-observation'};assert.equal(audits.aftersales(bypass,{...demand,observations:[{checkId:c.stableId+'-scope',result:'pass'},{checkId:c.stableId+'-resolution',result:'pass'}]}).automaticPassed,false);
});
test('SSM checks reject wrong DeviceID, CRC, missing grid and fabricated hardware validation',async()=>{
 const result=await app.dialogue(requirement(dataset.modules().find(m=>m.id===9),10,8)),shell=loadSsmShell(),exported=exportSsm(result,shell);assert.ok(auditSsm(exported,result,shell).automaticPassed);
 for(const mutate of [r=>r.xml=r.xml.replace('DeviceID="-39"','DeviceID="999"'),r=>r.xml=r.xml.replace(/(<Packet[^>]*Value=")([A-Za-z0-9])/,'$1A'),r=>r.gridXml='bad',r=>r.metadata.hardwareDownloadVerified=true]){const bad=structuredClone(exported);mutate(bad);assert.equal(auditSsm(bad,result,shell).automaticPassed,false);}
});
