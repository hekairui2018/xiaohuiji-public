'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFirmwareScope,projectProductFirmware}=require('../domain/knowledge/firmware-scope.cjs');
const {createResourceService}=require('../domain/knowledge/resource-service.cjs');
const {formatResourceReply}=require('../adapters/http/resource-reply.cjs');
test('dialogue firmware replaces legacy URLs, retires non-registry rows and keeps firmware models independent from products',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-dialogue-firmware-'));
 try{
  const file=path.join(dir,'firmware.json');fs.writeFileSync(file,JSON.stringify({schemaVersion:'xhj-curated-firmware-1',items:[{kind:'firmware',name:'Z42_new.bin',sha256:'a'.repeat(64),models:['HD-Z42'],deviceModels:['Z42'],category:'receiver',size:10,versionNote:'synthetic source'}]}));
  const scope=createFirmwareScope({manifestFile:file});
  const projected=projectProductFirmware('HD-Z42',[{file:'Z42_old.bin',status:'uploaded',publicUrl:'https://example.aliyuncs.com/old'}],scope);
  assert.equal(projected[0].name,'Z42_new.bin');assert.equal(projected[1].status,'retired-not-current');assert.equal(projected[1].publicUrl,null);
  const evidence={chips:{data:{rows:[]}}},knowledge={products:()=>[],assets:()=>({videos:[],software:[],manuals:[],softwareCatalog:[]}),formalFirmware:()=>scope.dialogueItems(),findProducts:()=>[]};
  const service=createResourceService(knowledge,evidence),result=service.query('Z42 firmware');
  assert.equal(result.items.length,1);assert.match(result.items[0].publicUrl,/^\/v2\/curated-firmware\//);assert.doesNotMatch(formatResourceReply(result),/aliyuncs|old\.bin/);
  const missing=service.query('Z43 固件',{providedDevices:[{modelId:'HD-Z43'}]});assert.equal(formatResourceReply(missing),'该型号在当前正式固件清单中无对应固件。');assert.equal(missing.items.length,0);
  assert.equal(scope.resolve({sha256:'b'.repeat(64),name:'Z42_new.bin'}),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
