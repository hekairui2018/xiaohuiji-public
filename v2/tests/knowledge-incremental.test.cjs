'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),directory=path.join(root,'v2/data/knowledge-next'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'candidate-manifest.json')));
const before=JSON.parse(fs.readFileSync(path.join(directory,'knowledge-1947c84700cea779/index.json'))),after=JSON.parse(fs.readFileSync(path.join(directory,manifest.versionId,'index.json')));
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{auditKnowledge}=require('../acceptance/knowledge.cjs'),{enrich,saveCandidate}=require('../tools/enrich-existing-knowledge.cjs');
const knowledge=loadKnowledge(directory,{manifestFile:'candidate-manifest.json'});
test('Incremental candidate keeps every previous source association and all parameter/workflow values',()=>{
 for(const [i,p] of after.products.entries()){
  const old=before.products[i];assert.deepEqual(p.parameters,old.parameters);assert.deepEqual(p.aliases,old.aliases);
  for(const ref of old.sourceReferences)assert.ok(p.sourceReferences.some(r=>JSON.stringify(r)===JSON.stringify(ref)));
  for(const [j,c]of old.claims.entries())for(const ref of c.sourceReferences||[])assert.ok(p.claims[j].sourceReferences.some(r=>JSON.stringify(r)===JSON.stringify(ref)));
 }
 for(const [i,c]of after.cases.entries())for(const key of ['stableId','sourceExcerpt','checks','workflow','scope','historicalSolution'])assert.deepEqual(c[key],before.cases[i][key]);
 assert.deepEqual(after.parameterConflicts,before.parameterConflicts);assert.deepEqual(after.rejectedDocuments,before.rejectedDocuments);
 assert.equal(manifest.activated,false);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'v2/data/knowledge/active-manifest.json'))).versionId,manifest.baseVersion);
});
test('Word paragraph citations resolve by locator and partial checks never become fully verified records',()=>{
 const c=after.cases.find(c=>c.legacyId==='AS-0306'),ref=c.sourceReferences.find(r=>r.supportedField==='checks');assert.equal(ref.page,null);assert.match(ref.locator,/word\/document.xml paragraphs \d+-\d+/);assert.equal(ref.verificationStatus,'reference_only');assert.equal(c.verificationStatus,'reference_only');
 const receipt=auditKnowledge(knowledge,root,{directory,manifestFile:'candidate-manifest.json'});assert.equal(receipt.automaticPassed,true);
 const cases=knowledge.cases(),fake=cases.find(c=>c.legacyId==='AS-0306');fake.sourceReferences.filter(r=>r.supportedField==='checks').forEach(r=>r.locator='word/document.xml paragraphs 99999-99999');
 assert.equal(auditKnowledge({...knowledge,cases:()=>cases},root,{directory,manifestFile:'candidate-manifest.json'}).automaticPassed,false);
 const promoted=knowledge.cases();promoted.find(c=>c.legacyId==='AS-0306').verificationStatus='verified_by_case';assert.equal(auditKnowledge({...knowledge,cases:()=>promoted},root,{directory,manifestFile:'candidate-manifest.json'}).automaticPassed,false);
});
test('Current batch evidence is additive and reapplication creates no new associations',()=>{
 const file='v2/data/evidence/knowledge-source-batch-20261014-stage13.json',bytes=fs.readFileSync(path.join(root,file)),evidence=JSON.parse(bytes),ref={file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const repeated=enrich(after,evidence,ref);assert.deepEqual(repeated.next,after);assert.ok(Object.values(repeated.counts).every(n=>n===0));
 assert.ok(after.products.flatMap(p=>p.claims).filter(c=>c.verificationStatus==='verified').length>before.products.flatMap(p=>p.claims).filter(c=>c.verificationStatus==='verified').length);
 const originalManifest=fs.readFileSync(path.join(directory,'candidate-manifest.json'));assert.throws(()=>saveCandidate(root),/append explicit incremental evidence/);assert.deepEqual(fs.readFileSync(path.join(directory,'candidate-manifest.json')),originalManifest);
});
