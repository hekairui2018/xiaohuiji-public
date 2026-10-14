'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {receiverLoadEvidence}=require('../backend/product-parameters.cjs');
const features=require('../backend/product-features.cjs');
const {createSpecCatalog}=require('../backend/product-documents.cjs');
test('R712 presentation preserves both independently sourced chip conditions',()=>{
 const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../tmp/business-evidence-20261013/local-specifications.json'),'utf8'));
 const pdf=source.documents.find(d=>d.file==='HD-R712规格书 V3.1.pdf');assert.ok(pdf?.sha256);
 const text=pdf.pages.map(p=>p.text).join(' ').replace(/\s/g,'');
 assert.match(text,/128\*1024/);assert.match(text,/256\*1024/);
 for(const load of [features.buildProductFeatures('HD-R712').load,createSpecCatalog().extractSpecParams('HD-R712')['带载']]){
  assert.match(load,/262,144/);assert.match(load,/512×512/);assert.match(load,/常规芯片128×1024/);assert.match(load,/PWM芯片256×1024/);
 }
});
test('Contradictory maximum cannot become a confirmed conditional capacity',()=>{
 assert.equal(receiverLoadEvidence({load:'Maximum loading capacity: 262,143 pixels (512*512)?conventional chip 128*1024 pixels, PWM chip 256*1024pixels'}),null);
});
test('Incomplete conditions do not invent a PWM or conventional limit',()=>{
 assert.equal(receiverLoadEvidence({load:'Maximum loading capacity: 262,144 pixels (512*512)'}),null);
});
