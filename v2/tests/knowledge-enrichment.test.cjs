'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{auditKnowledge}=require('../acceptance/knowledge.cjs');
const {createApp}=require('../app/bootstrap.cjs'),{enrich}=require('../tools/enrich-existing-knowledge.cjs');
const root=path.resolve(__dirname,'../..'),directory=path.join(root,'v2/data/knowledge-next'),manifestFile='candidate-manifest.json';
const baseline=loadKnowledge(),candidate=loadKnowledge(directory,{manifestFile});
test('Candidate preserves original business fields and stable IDs, only evidence and documented empty case scope are added',()=>{
 assert.equal(candidate.counts.products,312);assert.equal(candidate.counts.cases,2231);assert.notEqual(candidate.version,baseline.version);
 const originalProducts=baseline.products(),originalCases=baseline.cases();
 for(const [i,p]of candidate.products().entries()){
  const before=originalProducts[i];for(const key of ['modelId','model','displayName','aliases','parameters'])assert.deepEqual(p[key],before[key]);
  assert.deepEqual(p.claims.map(c=>[c.claimId,c.field,c.text]),before.claims.map(c=>[c.claimId,c.field,c.text]));
  assert.deepEqual(p.firmware.map(f=>[f.file,f.card,f.variant,f.series,f.hwFromFile,f.publicUrl]),before.firmware.map(f=>[f.file,f.card,f.variant,f.series,f.hwFromFile,f.publicUrl]));
 }
 for(const [i,c]of candidate.cases().entries()){
  const before=originalCases[i];for(const key of ['stableId','legacyId','phenomenon','checks','workflow','historicalSolution','caseStatus','sourceReference'])assert.deepEqual(c[key],before[key]);
  if(c.legacyId!=='AS-0016')assert.deepEqual(c.scope,before.scope);else{assert.deepEqual(c.scope.scans,['4S']);assert.deepEqual(c.scope.chips,['FM6363','138']);}
 }
 assert.deepEqual(candidate.audit(),baseline.audit());assert.equal(loadKnowledge().version,baseline.version);
});
test('Candidate passes existing invariants plus original document/firmware/case provenance checks',()=>{
 const receipt=auditKnowledge(candidate,root,{directory,manifestFile});assert.equal(receipt.automaticPassed,true,JSON.stringify(receipt.checks.filter(c=>c.status==='failed')));
 assert.ok(receipt.checks.some(c=>c.id.startsWith('original-claim:')));
});
test('Forged model source, PPT applicability and firmware trust promotion are rejected without lowering original assertions',()=>{
 const mutate=change=>{const products=candidate.products();change(products);return {...candidate,products:()=>products};};
 for(const fake of [mutate(products=>{products.find(p=>p.modelId==='HD-R712').claims.find(c=>c.verificationStatus==='verified').sourceReferences.filter(r=>r.originalSha256).forEach(r=>r.originalSha256='0'.repeat(64));}),mutate(products=>{const d=products.find(p=>p.documents.some(d=>d.kind==='presentation')).documents.find(d=>d.kind==='presentation');d.sourceReferences.forEach(r=>r.page=9999);}),mutate(products=>{const f=products.flatMap(p=>p.firmware).find(f=>f.sourceReferences?.some(r=>r.originalSha256));f.sourceReferences.filter(r=>r.originalSha256).forEach(r=>{r.sourceType='official';r.verificationStatus='verified';});})])assert.equal(auditKnowledge(fake,root,{directory,manifestFile}).automaticPassed,false);
});
test('Additive enrichment is idempotent and AI summaries cannot replace official statements',()=>{
 const active=JSON.parse(fs.readFileSync(path.join(root,'v2/data/knowledge/active-manifest.json'))),base=JSON.parse(fs.readFileSync(path.join(root,'v2/data/knowledge',active.versionId,'index.json')));
 const sourceFile='v2/data/evidence/knowledge-source-batch-20261014.json',bytes=fs.readFileSync(path.join(root,sourceFile)),source={file:sourceFile,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')},evidence=JSON.parse(bytes);
 const first=enrich(base,evidence,source).next;assert.deepEqual(enrich(first,evidence,source).next,first);assert.deepEqual(base.products[0],JSON.parse(fs.readFileSync(path.join(root,'v2/data/knowledge',active.versionId,'index.json'))).products[0]);
 assert.ok(Object.values(enrich(first,evidence,source).counts).every(n=>n===0));
 const untrusted=structuredClone(evidence);for(const d of untrusted.documents.filter(d=>d.format==='.pdf')){d.sourceType='ai_summary';d.verificationStatus='reference_only';}
 const held=enrich(base,untrusted,source);assert.equal(held.counts.claims,0);assert.equal(held.counts.officialDocuments,0);assert.deepEqual(held.next.products.map(p=>p.claims),base.products.map(p=>p.claims));
 assert.throws(()=>loadKnowledge(directory,{manifestFile:'../active-manifest.json'}));
});
test('Candidate can run without AI and engineering document references do not decide ordering quantities',async()=>{
 const dataset=require('../adapters/data/load-dataset.cjs').loadDataset(),a=createApp({dataset,knowledge:baseline}),b=createApp({dataset,knowledge:candidate});
 const module=dataset.modules().find(m=>m.dotPitch.spacing===2.5&&m.interface==='HUB75'&&m.indoor),input=require('../tools/run-acceptance.cjs').requirement(module,10,10);
 const before=await a.dialogue(input),after=await b.dialogue(input);assert.equal(before.status,'ready');assert.equal(after.status,'ready');assert.deepEqual(after.plan,before.plan);assert.deepEqual(after.bom,before.bom);assert.equal(after.topologySvg,before.topologySvg);assert.equal(b.health().aiEnabled,false);
 const oldSsm=await a.exportSsm(input),newSsm=await b.exportSsm(input);assert.equal(newSsm.status,'ready');assert.equal(typeof newSsm.xml,'string');assert.equal(newSsm.xml,oldSsm.xml);
 assert.ok(b.resourceLookup('R712规格书').items.length);assert.equal(b.quickLookup({modelId:'A3'}).records.some(p=>p.modelId==='HD-A3L'),false);
});
