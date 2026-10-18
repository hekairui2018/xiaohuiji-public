'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs'),{formatReply}=require('../adapters/http/dialogue-service.cjs');
const knowledge=loadKnowledge(path.resolve(__dirname,'../data/knowledge-next'),{manifestFile:'candidate-manifest.json'}),app=createApp({knowledge});
const {createAftersalesService}=require('../domain/aftersales/service.cjs');
test('Candidate A4L isolates A6L text without editing the original record',async()=>{
 const original=knowledge.findProducts('A4L')[0];assert.match(original.parameters.load,/A6L/);
 const projected=app.quickLookup({modelId:'A4L'}).records[0];assert.doesNotMatch(JSON.stringify(projected.claims),/A6L/);assert.doesNotMatch(projected.parameters.load,/A6L/);assert.ok(projected.withheldClaims.length);
 assert.equal(knowledge.findProducts('A4L')[0].parameters.load,original.parameters.load);
 const reply=formatReply(await app.dialogue('A4L参数'));assert.doesNotMatch(reply,/A6L/);assert.match(reply,/资料版次：V1.3/);assert.equal(projected.parameters.resolution,'16384 / 8192');
});
test('Document version selects literal values and source; unsupported version cannot fall back to a default',async()=>{
 for(const [version,height]of [['V1.0',4096],['V1.3',8192]]){
  const r=await app.dialogue('A4L '+version+' 最大垂直高度是多少');assert.equal(r.status,'ready');const p=r.knowledge.records[0];
  assert.equal(p.selectedDocumentVersion,version);assert.equal(p.parameters.resolution,'16384 / '+height);assert.ok(p.parameterEvidence.load.every(ref=>ref.documentVersion===version&&ref.originalSha256));
  assert.equal(p.parameters.interfaces,undefined);assert.equal(app.quickLookup({modelId:'A4L',documentVersion:version}).records[0].parameters.resolution,'16384 / '+height);
  const reply=formatReply(r);assert.match(reply,new RegExp(String(height)));assert.match(reply,/参数来源/);assert.match(reply,/不是硬件版本/);
 }
 const unknown=await app.dialogue('A4L V9.9 最大垂直高度');assert.equal(unknown.status,'needs_input');assert.deepEqual(unknown.knowledge.records[0].parameters,{});assert.doesNotMatch(formatReply(unknown),/8192|4096/);
});
test('Explicit canonical identity takes priority over another product alias',()=>{
 for(const id of ['A3','A4','A4L','A6L','VP620','VP620A','R512','R512T']){const rows=knowledge.findProducts(id);assert.equal(rows.length,1);assert.equal(rows[0].modelId,'HD-'+id);}
});
test('Colliding aliases remain ambiguous while an explicit model cannot be stolen by an alias',()=>{
 const root=path.resolve(__dirname,'../../tmp/v2-stage16/alias-fixture'),version='knowledge-0000000000000016';fs.mkdirSync(path.join(root,version),{recursive:true});
 const bytes=Buffer.from(JSON.stringify({schemaVersion:'2.0',products:[{modelId:'HD-A4L',aliases:['A4L','Q99']},{modelId:'HD-A6L',aliases:['A4L','Q99']}],cases:[],sources:[]}));
 fs.writeFileSync(path.join(root,version,'index.json'),bytes);fs.writeFileSync(path.join(root,'candidate-manifest.json'),JSON.stringify({versionId:version,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),counts:{}}));
 const k=loadKnowledge(root,{manifestFile:'candidate-manifest.json'});assert.deepEqual(k.findProducts('A4L').map(p=>p.modelId),['HD-A4L']);assert.equal(k.findProducts('Q99').length,2);
});
test('AS0306 consumes the audited module conditions, preserves reference-only and asks before execution',async()=>{
 const c=knowledge.cases().find(c=>c.legacyId==='AS-0306');
 const input={schemaVersion:'2.0',operation:'aftersales',symptoms:['屏幕上固定位置有闪屏和闪点现象']};
 const r=await app.dialogue(input),d=r.diagnosis;assert.equal(d.activeCaseId,c.stableId);assert.equal(d.state,'confirm-scope');
 const scope=d.checks[0].scope;assert.deepEqual(scope.chips,['LS9932','LS9708P']);assert.deepEqual(scope.scans,['64S']);assert.deepEqual(scope.pitches,['P2.5']);assert.match(scope.additionalConditions.join(' '),/三色合一/);
 assert.equal(d.verificationStatus,'reference_only');assert.equal(d.historicalSolution,null);assert.equal(d.conclusion,null);assert.ok(d.sourceReferences.some(r=>r.originalSha256&&r.locator.includes('1266')));
 const reply=formatReply(r);assert.match(reply,/LS9932/);assert.match(reply,/不能.*已验证方案/);assert.doesNotMatch(reply,/V25\.70\.96/);
 const unknown=await app.dialogue({...input,observations:[{checkId:c.stableId+'-scope',result:'unknown'}]});assert.equal(unknown.diagnosis.state,'confirm-scope');
 const rejected=await app.dialogue({...input,observations:[{checkId:c.stableId+'-scope',result:'fail'}]});assert.notEqual(rejected.diagnosis.activeCaseId,c.stableId);assert.equal(rejected.diagnosis.conclusion,null);
 assert.deepEqual(knowledge.cases().find(x=>x.stableId===c.stableId).scope,c.scope);
});
test('Reference-only source cannot authorize a step absent from the cited excerpt',()=>{
 const c=knowledge.cases().find(c=>c.legacyId==='AS-0306');c.checks.push({checkId:'unsupported-firmware-action',text:'升级为任意通用固件'});
 const service=createAftersalesService({cases:()=>[c]});const r=service({symptoms:['屏幕上固定位置有闪屏和闪点现象']});
 assert.equal(r.status,'needs_input');assert.equal(r.diagnosis.state,'insufficient-executable-evidence');assert.equal(r.diagnosis.conclusion,null);assert.equal(r.diagnosis.candidates[0].verificationStatus,'reference_only');
});
