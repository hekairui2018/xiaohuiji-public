'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createResourceService}=require('../domain/knowledge/resource-service.cjs');
const {loadResourceEvidence}=require('../adapters/data/load-resource-evidence.cjs');
const {createFirmwareScope}=require('../domain/knowledge/firmware-scope.cjs');
const scope=createFirmwareScope({manifestFile:path.join(__dirname,'../data/catalog/generated/curated-local-firmware.json')});
const service=createResourceService({products:()=>[],assets:()=>({}),formalFirmware:()=>scope.dialogueItems()},loadResourceEvidence());
test('common and special chip families restore model tail guidance with registry-only downloads',()=>{
 for(const chip of ['FM6363','ICN2065']){
  const r=service.chipLookup(chip);
  assert(r.view.primary.facts.some(f=>f.label==='接收卡固件尾缀'&&f.text.includes('R712')));
  assert(r.view.primary.facts.some(f=>f.label==='异步卡固件尾缀'&&f.text.includes('C16L')));
  assert(r.files.length>0);
  for(const f of r.files){assert(scope.has({sha256:f.sha256}));assert.match(f.publicUrl,/^\/v2\/curated-firmware\//);}
 }
});
test('an exact receiver restricts downloads and a decoder never receives driver firmware',()=>{
 const r=service.chipLookup('FM6363 R712',[{modelId:'HD-R712'}]);
 assert(r.files.length>0);assert(r.files.every(f=>f.models.includes('R712')));
 assert(r.view.primary.facts.find(f=>f.label==='接收卡固件尾缀').text.includes('01.30'));
 const decoder=service.chipLookup('5958');assert.equal(decoder.files.length,0);
 assert(!decoder.view.primary.facts.some(f=>/尾缀/.test(f.label)));
});
test('chip browsing merges equal series codes and includes C08L in the shared asynchronous suffix group',()=>{
 const facts=service.chipLookup('FM6363').view.primary.facts;
 const receivers=facts.find(f=>f.label==='接收卡固件尾缀').text;
 assert(receivers.includes('00.xx'));assert(receivers.includes('01.xx'));assert(!receivers.includes('01.30'));
 const asynchronous=facts.find(f=>f.label==='异步卡固件尾缀').text.split('\n');
 assert.equal(asynchronous.filter(x=>x.endsWith('：70')).length,1);
 assert(asynchronous.find(x=>x.endsWith('：70')).includes('C08L'));
});
