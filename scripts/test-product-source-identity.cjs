'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {documentBelongs}=require('../backend/model-identity.cjs');
const {createProductData,loadProductData}=require('../backend/product-data.cjs');
const features=require('../backend/product-features.cjs');
for(const [name,yes,no] of [
 ['A3','HD-A3规格书.pdf','HD-A3L规格书.pdf'],
 ['VP620A','HD-VP620A Specification v1.2.pdf','HD-VP620规格书.pdf'],
 ['R5S','R5S规格书.pdf','R5s Plus规格书.pdf'],
 ['DCS4000','DCS4000规格书.pdf','DCS4000 Pro规格书.pdf'],
 ['R512','HD-R512规格书.pdf','HD-R512T规格书.pdf']
])test('Separate source identity '+name,()=>{assert.equal(documentBelongs(yes,name),true);assert.equal(documentBelongs(no,name),false);});
test('Joint manual supports both named models',()=>{for(const m of ['VP630','VP830'])assert.ok(documentBelongs('HD-VP630 & VP830使用说明书.pdf',m));});
test('Ambiguous aliases stay ambiguous; hardware revisions remain distinct',()=>{
 const d=createProductData([{product:'HD-X1',aliases:['one']},{product:'HD-X1V2',aliases:['one']}],[]);
 assert.equal(d.resolveModel('one'),null);assert.equal(d.resolveModel('HD-X1V2'),'HD-X1V2');
});
test('No mutation and no invention when foreign-only source has anonymous parameters',()=>{
 const source={product:'HD-A3',keyParameters:{interfaces:'USB3.0',support:'A3 支持网线?A3L 支持Wi-Fi'},specificationFiles:['HD-A3L规格书.pdf']};const copy=JSON.stringify(source);
 const d=createProductData([{product:'HD-A3'},{product:'HD-A3L'}],[source]);
 assert.equal(JSON.stringify(source),copy);assert.equal(d.specs['HD-A3'].keyParameters.interfaces,'');
 assert.equal(d.specs['HD-A3'].keyParameters.support,'A3 支持网线');
});
test('Internal A3 facts retain its own operation and exclude A3L claims',()=>{
 const d=loadProductData();assert.equal(d.specs['HD-A3'].specificationFiles.length,0);
 const text=JSON.stringify(features.inspectContext('HD-A3'));assert.doesNotMatch(text,/A3L/);
 assert.match(text,/A3.*LAN IN/);assert.match(features.buildProductFeatures('HD-A3').load,/65万/);
});
test('A3L own documents and VP620A shared manual preserved',()=>{
 const d=loadProductData();assert.ok(d.specs['HD-A3L'].specificationFiles.length);
 assert.ok(d.specs['HD-VP620A'].specificationFiles.some(f=>f.includes('VP820A & VP620A')));
 assert.ok(!d.specs['HD-VP620A'].specificationFiles.includes('HD-VP620规格书 v2.1.pdf'));
});
