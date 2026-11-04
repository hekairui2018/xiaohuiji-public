'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {createDocuments,fileReply}=require('./documents.cjs'),{render}=require('./core.cjs');
test('only registered exact public originals are sent; preserve same-name editions and refuse changed or escaping files',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wecom-documents-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'approved');await fs.mkdir(root);
 const items=[];for(const [i,brand]of ['品牌版','中性版'].entries()){const bytes=Buffer.from('original-'+i),relativePath=i+'.pdf';await fs.writeFile(path.join(root,relativePath),bytes);items.push({name:'产品.pdf',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,relativePath,kind:'spec',brand,language:'中文'});}
 const manifestFile=path.join(dir,'manifest.json');await fs.writeFile(manifestFile,JSON.stringify({schemaVersion:'xhj-curated-documents-1',items}));const d=createDocuments({rootDirectory:root,manifestFile});
 let found=await d.prepare([...items,items[0],{...items[0],sha256:'a'.repeat(64)}]);assert.equal(found.length,2);assert.equal(found[1].brand,'中性版');
 assert.equal((await d.prepare([{...items[0],accessRestricted:true}])).length,0);
 await fs.writeFile(path.join(root,'0.pdf'),'tampered');assert.equal((await d.prepare(items)).length,1);
 items[1].relativePath='../outside.pdf';await fs.writeFile(path.join(dir,'outside.pdf'),'original-1');await fs.writeFile(manifestFile,JSON.stringify({schemaVersion:'xhj-curated-documents-1',items}));assert.equal((await d.prepare(items)).length,0);
});
test('attachments retain editions and language, without duplicate plain file list',()=>{
 const files=[{name:'产品.pdf',brand:'品牌版',language:'中文'},{name:'产品.pdf',brand:'中性版',language:'中文'}];
 const text=fileReply({reply:'找到以下资料：\n产品.pdf\n同名文件包含不同版别，请选择。',bridgeMode:'expert'},files,render);
 assert.match(text,/品牌版 · 中文/);assert.match(text,/中性版 · 中文/);assert.doesNotMatch(text,/相关资料|同名文件包含/);assert.equal(text.split('产品.pdf').length-1,2);
});
test('unconfigured public document delivery stays closed',async()=>assert.deepEqual(await createDocuments().prepare([{name:'secret.pdf'}]),[]));
