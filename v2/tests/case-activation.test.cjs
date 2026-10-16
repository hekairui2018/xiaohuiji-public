'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs'),{createServer}=require('../adapters/http/server.cjs');
const {createRestrictedAftersales}=require('../domain/aftersales/restricted-service.cjs');
const knowledge=loadKnowledge(path.resolve(__dirname,'../data/knowledge-next'),{manifestFile:'candidate-manifest.json'}),app=createApp({knowledge});
test('Current complete source inventory produces no guessed enabled case and preserves 2231 originals',()=>{
 const p=app.caseActivation();assert.equal(p.total,2231);assert.equal(p.counts.enabled,0);assert.equal(p.counts.notEnabled,2231);assert.equal(p.counts.referenceHelpers,2);assert.equal(p.counts.internalOnly,2229);assert.equal(knowledge.cases().length,2231);assert.ok(p.rows.every(r=>r.requiredFollowup.length));
});
test('Reference-only is retrieval and follow-up only even if the caller invents completed observations',async()=>{
 const c=knowledge.cases().find(c=>c.legacyId==='AS-0306'),input={schemaVersion:'2.0',operation:'aftersales',symptoms:['屏幕上固定位置有闪屏和闪点现象'],observations:[{checkId:c.stableId+'-scope',result:'pass'},...c.checks.map(ch=>({checkId:ch.checkId,result:'pass'})),{checkId:c.stableId+'-resolution',result:'pass'}]};
 const r=await app.customerDialogue(input);assert.equal(r.status,'needs_input');assert.equal(r.diagnosis.conclusion,null);assert.equal(r.diagnosis.historicalSolution,null);assert.deepEqual(r.diagnosis.checks,[]);assert.equal(r.diagnosis.activeCaseId,undefined);assert.ok(r.diagnosis.candidates.every(c=>c.verificationStatus==='reference_only'));assert.ok(!JSON.stringify(r).includes('V25.70.96'));
 const natural=await app.customerDialogue('屏幕上固定位置有闪屏和闪点现象');assert.equal(natural.operation,'aftersales');assert.equal(natural.status,'needs_input');assert.deepEqual(natural.diagnosis.checks,[]);
});
test('Unknown or incomplete verified records are internal and never returned to customer HTTP',async()=>{
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{for(const route of ['/v2/dialogue','/api/ai/chat']){const input=route==='/api/ai/chat'?{message:'C16L 换LED模组后右边几排颜色不正常闪烁，HDPlayer能找到设备且发送成功，如何排查？'}:{schemaVersion:'2.0',operation:'aftersales',symptoms:['R712黑屏'],providedDevices:[{modelId:'R712'}]};const body=await fetch(base+route,{method:'POST',body:JSON.stringify(input)}).then(r=>r.json()),r=body.result||body;assert.equal(r.status,'needs_input');assert.equal(r.diagnosis.conclusion,null);assert.ok(r.diagnosis.candidates.every(c=>c.verificationStatus==='reference_only'));assert.equal(r.diagnosis.activeCaseId,undefined);}
  const p=await fetch(base+'/api/search?q=R712').then(r=>r.json());assert.equal(p.results[0].name,'HD-R712');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('Reference similarity never overrides a matching explicitly enabled verified case',()=>{
 const records=knowledge.cases(),verified=structuredClone(records.find(c=>c.legacyId==='AS-0223')),ref=structuredClone(records.find(c=>c.legacyId==='AS-0306'));ref.phenomenon='测试颜色异常';verified.phenomenon='颜色异常';verified.terms=['颜色异常'];ref.terms=['颜色异常'];
 const k={version:'fixture',cases:()=>[ref,verified]},service=createRestrictedAftersales(k,{knowledgeVersion:'fixture',enabledIds:[verified.stableId],referenceHelperIds:[ref.stableId]});const r=service({symptoms:['测试颜色异常']});assert.equal(r.diagnosis.activeCaseId,verified.stableId);assert.ok(r.diagnosis.candidates.every(c=>c.caseId!==ref.stableId));
 assert.throws(()=>createRestrictedAftersales(k,{knowledgeVersion:'other'}),/version mismatch/);
});
