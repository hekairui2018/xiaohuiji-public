'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {separateProductReferences,separateCatalogReferences}=require('../domain/knowledge/available-documents.cjs');
const old={name:'X9规格书V1.0.pdf',available:false,unavailableReason:'original-not-registered',fileId:'old',documentVersion:'V1.0'},current={name:'X9规格书V2.0.pdf',available:true,url:'/real',fileId:'new',documentVersion:'V2.0'};
test('Current product links use existing originals while missing reference evidence stays separate',()=>{
 const p=separateProductReferences({docGroups:[{key:'spec',label:'规格书',items:[old,current]}]});assert.deepEqual(p.specFiles,[current.name]);assert.deepEqual(p.specLinks,['/real']);assert.equal(p.docGroups[0].items[0],current);assert.equal(p.unavailableResources[0].fileId,'old');assert.equal(p.unavailableResources[0].documentVersion,'V1.0');
});
test('Catalogue isolates missing originals without discarding unknown versions, hardware variants or outage records',()=>{
 const unknown={...current,fileId:'unknown',documentVersion:null},hardware={...current,fileId:'hw2',name:'X9 E2规格书V1.0.pdf'},outage={...old,unavailableReason:'resource-service-unavailable'},conflict={...old,unavailableReason:'same-name-content-conflict'};
 const source=[{key:'spec',products:[{model:'X9',items:[old,current,unknown,hardware,outage,conflict]}]}];const result=separateCatalogReferences(source);assert.equal(result.groups[0].fileCount,5);assert.equal(result.unavailableRecords.length,1);assert.equal(source[0].products[0].items.length,6);assert.ok(result.groups[0].products[0].items.includes(unknown));assert.ok(result.groups[0].products[0].items.includes(outage));assert.ok(result.groups[0].products[0].items.includes(conflict));
});
