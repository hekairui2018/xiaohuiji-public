'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {plan,write}=require('../tools/public-release-manifest.cjs');
test('Release management follows existing registered categories and never adds unapproved files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-release-'));
 try{
  const file=path.join(root,'allow.json'),objects=[{name:'A5规格书.pdf',key:'official-files/A5规格书.pdf'},{name:'A5说明书.pdf',key:'official-files/A5说明书.pdf'}];
  fs.writeFileSync(file,JSON.stringify({schemaVersion:'v2-public-cloud-1',objects}));
  const products=[{modelId:'HD-A5',documents:[{name:objects[0].name,kind:'spec'},{name:objects[1].name,kind:'manual'},{name:'内部资料.pdf',kind:'spec'}]}];
  const p=plan({allowlistFile:file,products,visibleNames:new Set([objects[0].name])});
  assert.equal(p.total,2);assert.deepEqual(p.counts,{spec:1,manual:1,software:0,video:0,firmware:0});
  assert.equal(Object.keys(p.files).length,6);assert.ok(!JSON.stringify(p.files).includes('内部资料.pdf'));assert.ok(p.files['说明书/发布清单.csv'].includes('不等于已失效'));
  const out=path.join(root,'out');assert.equal(write(p,out).applied,false);assert.equal(fs.existsSync(out),false);
  const before=fs.readFileSync(file);write(p,out,{apply:true});assert.deepEqual(fs.readFileSync(file),before);
  write(p,out,{apply:true});assert.equal(fs.readdirSync(path.join(out,'备份')).length,1);
  fs.appendFileSync(path.join(out,'规格书/发布清单.csv'),'manual edit');assert.throws(()=>write(p,out,{apply:true}),/refusing overwrite/);
  assert.throws(()=>plan({allowlistFile:file,products:[]}),/Missing or conflicting/);
  assert.throws(()=>plan({allowlistFile:file,products:[...products,{documents:[{name:objects[0].name,kind:'manual'}]}]}),/conflicting/);
  fs.writeFileSync(file,JSON.stringify({schemaVersion:'v2-public-cloud-1',objects:[objects[0],objects[0]]}));assert.throws(()=>plan({allowlistFile:file,products}),/duplicate/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
