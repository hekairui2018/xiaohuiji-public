'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {modelId}=require('../domain/identity/model-id.cjs');
const {documentBelongs}=require('../domain/identity/document-identity.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const knowledge=loadKnowledge(),audit=require('../data/evidence/document-association-audit.json');
test('All 524 baseline links are accounted for with explicit evidence and unresolved decisions',()=>{
 assert.equal(audit.rows.length,524);assert.equal(new Set(audit.rows.map(x=>x.auditId)).size,524);
 assert.equal(audit.rows.filter(x=>x.decision==='restore-exact-identity-only').length,8);
 assert.ok(audit.rows.filter(x=>x.category==='other-exact-model').every(x=>!x.currentDocumentAttached));
});
test('Pro and Plus formatting is exact identity, never permission to attach the variant to a base model',()=>{
 for(const [file,variant,base]of [['HD-R5s Plus规格书 V1.0_已签章.pdf','R5SPLUS','R5S'],['HD-MS4000 Pro规格书_V1.3.pdf','MS4000PRO','MS4000'],['HD-DCS4000 Pro规格书 v1.0.pdf','DCS4000PRO','DCS4000']]){
  assert.equal(documentBelongs(file,variant),true);assert.equal(documentBelongs(file,base),false);assert.ok(knowledge.findProducts(variant)[0].documents.some(d=>d.name===file));
 }
 const evidence=require('../data/evidence/document-identity-pdf-audit.json');assert.equal(evidence.length,3);assert.ok(evidence.every(e=>e.pages[0].text.includes('Pro')||e.pages[0].text.includes('Plus')));
});
test('Numeric-leading real LCD models retain exact identities and original specification parameters',()=>{
 const originals=JSON.parse(fs.readFileSync('data/product-specs-index.json')).products;
 for(const model of ['133MC','3288S','3568S-BOX','40S']){assert.equal(modelId(model),'HD-'+model);const record=knowledge.findProducts(model)[0],source=originals.find(s=>s.product===record.displayName);assert.ok(source);assert.deepEqual(record.parameters,source.keyParameters);assert.ok(record.documents.length);}
 assert.notEqual(modelId('133M'),modelId('133MC'));assert.equal(modelId('63'),null);
});
test('Unparsed named resources no longer borrow each other’s null-key parameters',()=>{
 const originals=JSON.parse(fs.readFileSync('data/product-specs-index.json')).products;
 for(const p of knowledge.products().filter(p=>!p.modelId)){const own=originals.find(s=>s.product===p.displayName);assert.ok(own);assert.deepEqual(p.parameters,own.keyParameters);}
});
