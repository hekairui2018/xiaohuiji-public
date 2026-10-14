'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {buildKnowledge}=require('../tools/build-knowledge.cjs');
const {createApp}=require('../app/bootstrap.cjs');
const {documentBelongs}=require('../domain/identity/document-identity.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge});
const norm=x=>String(x).replace(/\s+/g,'').toLowerCase();
test('Complete original inventory and immutable source hashes retained',()=>{
 assert.equal(knowledge.counts.products,312);assert.equal(knowledge.counts.cases,2231);
 for(const s of knowledge.sources())assert.equal(crypto.createHash('sha256').update(fs.readFileSync(s.file)).digest('hex'),s.sha256);
 assert.deepEqual(buildKnowledge().cases.map(c=>c.stableId),knowledge.cases().map(c=>c.stableId));
});
test('Exact document identities retain suffix/plus boundaries and quarantine mixed files',()=>{
 assert.equal(documentBelongs('HD-A3L规格书.pdf','A3'),false);assert.equal(documentBelongs('HD-A3L_规格书.pdf','A3L'),true);
 assert.equal(documentBelongs('HD-A30+规格书.pdf','A30'),false);assert.equal(documentBelongs('HD-A30+规格书.pdf','A30+'),true);
 assert.equal(documentBelongs('HD-VP620A规格书.pdf','VP620'),false);
 for(const p of knowledge.products())for(const d of p.documents)assert.ok(documentBelongs(d.name,p.modelId));
 assert.ok(knowledge.audit().rejectedDocuments.length);assert.ok(knowledge.findProducts('A3')[0].documents.every(d=>!d.name.includes('A3L')));
});
test('Product facts, firmware and independent resources are real and never guessed compatibility',async()=>{
 const p=app.quickLookup({modelId:'R712'}).records[0];assert.ok(p.claims.some(c=>c.text.includes('262,144')));
 assert.ok(p.firmware.length);assert.ok(p.firmware.every(f=>f.card==='R712'&&f.sourceReference.sha256));
 assert.ok(app.quickResources().software.length);assert.ok(app.quickResources().manuals.length);assert.ok(app.quickResources().videos.length);
 assert.equal((await app.dialogue('CT800参数')).status,'ready');
});
test('Dialogue software and tutorial consultation queries shared knowledge without the quick business route',async()=>{
 const sw=await app.dialogue('HDSet软件下载');assert.equal(sw.status,'ready');assert.equal(sw.resources.kind,'software');assert.ok(sw.resources.items[0].download.publicUrl);
 const video=await app.dialogue('复位视频');assert.equal(video.status,'ready');assert.equal(video.resources.kind,'videos');assert.ok(video.resources.items.length);
});
test('Every executable check has separate original-record literal support',()=>{
 const sources=new Map();for(const c of knowledge.cases())if(c.checks.length){
  if(!sources.has(c.sourceReference.file))sources.set(c.sourceReference.file,JSON.parse(fs.readFileSync(c.sourceReference.file,'utf8')));
  const original=sources.get(c.sourceReference.file);const raw=[...(original.cases||[]),...(original.entries||[])].find(x=>x.id===c.originalId);assert.ok(raw);
  const text=[raw.troubleshooting,raw.solution,raw.sourceExcerpt,...Object.values(raw.rawFields||{})].filter(x=>typeof x==='string').join('\n');
  for(const check of c.checks)assert.ok(norm(text).includes(norm(check.text)),c.legacyId);
 }assert.ok(knowledge.counts.sourceSupportedChecks>500);
});
test('Diagnosis advances only from actual observations, similarity never proves a cause',async()=>{
 const c=knowledge.cases().find(c=>c.checks.length&&c.phenomenon.includes('水波纹'));
 const input={schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]]};
 let result=await app.dialogue(input);assert.equal(result.status,'needs_input');assert.equal(result.diagnosis.conclusion,null);assert.equal(result.diagnosis.state,'confirm-scope');
 const checks=result.diagnosis.checks;input.observations=checks.slice(0,-1).map(c=>({checkId:c.checkId,result:'pass'}));
 result=await app.dialogue(input);assert.equal(result.diagnosis.state,'verify-phenomenon');assert.equal(result.diagnosis.conclusion,null);
 input.observations.push({checkId:checks.at(-1).checkId,result:'pass'});result=await app.dialogue(input);assert.equal(result.diagnosis.state,'user-reported-resolution');assert.equal(result.diagnosis.conclusion.kind,'customer-observation');
});
test('Cross-model failures, rejected scopes, unknown and duplicate observations cannot confirm diagnosis',async()=>{
 const c=knowledge.cases().find(c=>c.checks.length&&c.modelIds.length===1&&c.phenomenon.length>12);
 const input={schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]],providedDevices:[{modelId:'ZZ9999'}]};
 const result=await app.dialogue(input);assert.ok(!result.diagnosis.candidates.some(x=>x.caseId===c.stableId));assert.equal(result.diagnosis.conclusion,null);
 const dup=await app.dialogue({...input,observations:[{checkId:'x',result:'pass'},{checkId:'x',result:'fail'}]});assert.equal(dup.status,'conflict');
});
test('Previously corrected relative-model and black-level domain errors stay corrected in v2',async()=>{
 for(const [short,long]of [['A3','HD-A3L'],['VP620','HD-VP620A'],['R512','HD-R512T']]){
  const r=await app.dialogue({schemaVersion:'2.0',operation:'aftersales',symptoms:[short+'黑屏'],providedDevices:[{modelId:short}]});
  assert.ok(r.diagnosis.candidates.every(x=>!knowledge.cases().find(c=>c.stableId===x.caseId).modelIds.includes(long)||knowledge.cases().find(c=>c.stableId===x.caseId).modelIds.includes('HD-'+short)));
 }
 const source=knowledge.cases().find(c=>c.legacyId==='AS-1325');assert.equal(source.domain,'display');
 const d=await app.dialogue('VP630黑电平异常');assert.equal(d.operation,'aftersales');assert.ok(d.diagnosis.classification.tags.includes('dark_level'));
});
test('Full corpus original-wording replay never declares a solved fault without observations',async()=>{
 let workflows=0;for(const c of knowledge.cases()){
  const result=await app.dialogue({schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]],providedDevices:c.modelIds.map(modelId=>({modelId}))});
  assert.notEqual(result.status,'ready');assert.equal(result.diagnosis.conclusion,null);if(result.diagnosis.checks?.length)workflows++;
 }assert.ok(workflows>500);console.log('2231 cases replayed; executable workflow coverage='+workflows+' (not accuracy)');
});
