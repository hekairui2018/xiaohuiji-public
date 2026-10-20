'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {augmentProducts}=require('../domain/knowledge/local-resource-catalog.cjs');
const model={modelId:'HD-R712',displayName:'R712',documents:[],firmware:[]};
const name='R712_FPGA_V25.07.97.30_E1.bin';
function binary(hash,id){return {name,sha256:hash.repeat(64),locationId:id,versionId:'v-'+id,
  resourceId:'resource-'+id,resourceType:'firmware',folders:['固件','R712'],
  availabilityState:'present',sizeBytes:128};}
test('Different content with the same firmware filename is not silently dropped',()=>{
 const products=augmentProducts([model],[binary('a',11),binary('b',12)]);
 const records=products.find(p=>p.modelId==='HD-R712').firmware;
 assert.equal(records.length,2);
 assert.deepEqual(new Set(records.map(r=>r.sha256)),new Set(['a'.repeat(64),'b'.repeat(64)]));
 assert.ok(records.every(r=>r.sameNameDifferentContent===true));
 assert.ok(records.every(r=>r.associationStatus==='filename-candidate'));
 assert.ok(records.every(r=>r.resourceOnly===true));
 assert.deepEqual(new Set(records.map(r=>r.publicUrl)),new Set(['/v2/offline/file?id=11','/v2/offline/file?id=12']));
});
test('Same content under duplicate folders stays one firmware item',()=>{
 const records=augmentProducts([model],[binary('a',11),binary('a',12)]).find(p=>p.modelId==='HD-R712').firmware;
 assert.equal(records.length,1);
 assert.equal(records[0].sha256,'a'.repeat(64));
 assert.notEqual(records[0].sameNameDifferentContent,true);
});
