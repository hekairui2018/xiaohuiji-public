'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),file='v2/data/evidence/knowledge-source-batch-20261014-stage14.json',bytes=fs.readFileSync(path.join(root,file)),evidence=JSON.parse(bytes),reference={file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
// Freeze this batch's before/after fixtures so later candidate batches do not change its expectations.
const manifest={parentVersion:'knowledge-94ddd89b754efade',versionId:'knowledge-fc9f11a1e72de750',baseVersion:'knowledge-9109bc3cd2171530',associationCounts:{products:27,documents:22,claims:85,cases:45,firmware:22,software:3,officialDocuments:19,engineeringDocuments:0,trainingDocuments:3,projectDocuments:0,unknownFirmware:22,aiSummary:0}},base=JSON.parse(fs.readFileSync(path.join(root,'v2/data/knowledge-next',manifest.parentVersion,'index.json'))),after=JSON.parse(fs.readFileSync(path.join(root,'v2/data/knowledge-next',manifest.versionId,'index.json')));
const {enrich}=require('../tools/enrich-existing-knowledge.cjs'),{coverage}=require('../tools/report-knowledge-evidence.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{auditKnowledge}=require('../acceptance/knowledge.cjs');
test('Expanded evidence is deterministic, additive and preserves parameters, case procedures, original versions and active knowledge',()=>{
 const result=enrich(base,evidence,reference);assert.deepEqual(result.next,after);assert.deepEqual(result.counts,manifest.associationCounts);
 assert.deepEqual(enrich(after,evidence,reference).next,after);assert.ok(Object.values(enrich(after,evidence,reference).counts).every(n=>n===0));
 assert.equal(result.counts.products,27);assert.equal(result.counts.documents,22);assert.equal(result.counts.cases,45);
 for(const [i,p]of after.products.entries()){assert.deepEqual(p.parameters,base.products[i].parameters);assert.deepEqual(p.aliases,base.products[i].aliases);assert.deepEqual(p.claims.map(c=>c.text),base.products[i].claims.map(c=>c.text));}
 for(const [i,c]of after.cases.entries())for(const key of ['modelIds','scope','phenomenon','checks','historicalSolution','workflow'])assert.deepEqual(c[key],base.cases[i][key]);
 assert.equal(loadKnowledge().version,manifest.baseVersion);
});
test('Training and project sources associate exact models while missing model/chip/software/firmware scope blocks whole-case verification',()=>{
 const ppts=evidence.documents.filter(d=>d.sourceType==='training');assert.equal(ppts.length,3);
 for(const type of ['training','project']){
  const bundle={documents:ppts.map(d=>({...d,sourceType:type})),firmware:[],casePriority:[]};const result=enrich(base,bundle,reference);
  assert.ok(result.counts[type+'Documents']>0);assert.equal(result.counts.claims,0);assert.deepEqual(result.next.products.map(p=>p.parameters),base.products.map(p=>p.parameters));
 }
 const original=enrich(base,evidence,reference).next.cases.find(c=>evidence.casePriority.includes(c.legacyId)&&c.verificationStatus==='verified_by_case');assert.ok(original);
 for(const [field,value]of [['modelIds','HD-UNSEEN999'],['chips','UNSEEN_CHIP999'],['softwareVersions','V999.999'],['firmwareVersions','V999.998']]){
  const changed=structuredClone(base),c=changed.cases.find(c=>c.stableId===original.stableId);
  if(field==='modelIds')c.modelIds.push(value);else c.scope[field].push(value);
  const next=enrich(changed,evidence,reference).next.cases.find(c=>c.stableId===original.stableId);assert.equal(next.verificationStatus,'reference_only');
 }
});
test('Software provenance requires original key, filename and size; bytes never establish installer equivalence or compatibility',()=>{
 const directory=path.join(root,'v2/data/knowledge-next'),knowledge=loadKnowledge(directory,{manifestFile:'candidate-manifest.json'});
 const receipt=auditKnowledge(knowledge,root,{directory,manifestFile:'candidate-manifest.json'});assert.equal(receipt.automaticPassed,true);assert.ok(receipt.checks.some(c=>c.id.startsWith('asset-citation-policy:')));
 // Exercise the same validator with one pinned bundle rather than repeatedly parsing all legacy sources.
 const auditAssets=assets=>{const r=require('../acceptance/report.cjs').report('asset-proof');require('../domain/knowledge/original-provenance.cjs').auditOriginalProvenance([],[],new Map([[file,evidence]]),r,assets);return r.finish().automaticPassed;};
 for(const key of ['originalSha256','sourceType','verificationStatus']){
  const assets=structuredClone(after.assets),asset=assets.manuals.find(a=>a.sourceReferences?.some(r=>r.originalSha256));assert.ok(asset.sourceReference);
  asset.sourceReferences.filter(r=>r.originalSha256).forEach(r=>r[key]=key==='originalSha256'?'0'.repeat(64):key==='sourceType'?'official':'verified');
  assert.equal(auditAssets(assets),false);
 }
 for(const key of ['resourceKey','file','sizeBytes']){
  const wrong=structuredClone(evidence);for(const raw of wrong.software)raw[key]=key==='sizeBytes'?raw[key]+1:'unrelated';assert.equal(enrich(base,wrong,reference).counts.software,0);
 }
 for(const change of [a=>a.sourceType='official',a=>a.verificationStatus='verified',a=>a.sourceReference={...a.sourceReference,originalSha256:'0'.repeat(64)}]){
  const assets=structuredClone(after.assets);change(assets.manuals.find(a=>a.sourceReferences?.some(r=>r.originalSha256)));assert.equal(auditAssets(assets),false);
 }
});
test('Coverage distinguishes missing fields, whole-value support and historical-source status without inventing comparison conclusions',()=>{
 const sources=new Map(after.sources.filter(s=>s.file.endsWith('.json')).map(s=>[s.file,JSON.parse(fs.readFileSync(path.join(root,s.file),'utf8').replace(/^\uFEFF/,''))]));
 const report=coverage(base,after,sources);assert.equal(report.delta.products,manifest.associationCounts.products);assert.equal(report.delta.documents,manifest.associationCounts.documents);
 assert.equal(report.verifiedClaims,263);assert.equal(report.delta.newlyVerifiedClaims,64);assert.equal(report.caseVerification.verified,36);assert.equal(report.caseVerification.reference_only,14);
 assert.equal(report.parameterCoverage.length,312);assert.equal(report.missingFieldCounts.absent+report.missingFieldCounts.wholeValueUnverified,report.missingFields.length);
 assert.equal(report.activationAssessment.ready,false);assert.equal(report.modelGroups.A3_A4_A4L.length,4);
 assert.ok(report.modelGroups.A3_A4_A4L.every(p=>p.firmwareFiles.every(f=>f.compatibilityVerified===false)));
});
