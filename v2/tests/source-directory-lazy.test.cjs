'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {directoryItems,createDirectoryIndex,directoryPage}=require('../domain/knowledge/source-directory.cjs');
const {fileType}=require('../frontend/source-directory-browser.js');
const row=(name,id,folders=['软件'])=>({name,locationId:id,versionId:'v-'+id,sourceDrive:'G:',folders,availabilityState:'present',searchContent:'file-metadata-only'});
test('Root returns direct first-level folders only, without G wrapper or descendant file data',()=>{
 const index=createDirectoryIndex(directoryItems([row('内部.pdf',1,['产品资料','深层']),row('软件.exe',2,['软件'])]));const docs=directoryPage(index);
 assert.equal(docs.directoryTree,undefined);assert.deepEqual(docs.directoryPage.entries.map(r=>r.label),['软件','产品资料']);assert(docs.directoryPage.entries.every(r=>r.type==='directory'&&!r.children&&!r.items&&!r.name));assert(!JSON.stringify(docs).includes('内部.pdf'));
 const product=docs.directoryPage.entries[1];const child=directoryPage(index,{directory:product.id});assert.equal(child.directoryPage.entries[0].label,'深层');assert.equal(child.directoryPage.entries[0].type,'directory');
});
test('A thousand files use exact server-side batches of 50 with no missing or duplicate original',()=>{
 const index=createDirectoryIndex(directoryItems(Array.from({length:1234},(_,i)=>row('文件'+i+'.pdf',i+1))));const folder=directoryPage(index).directoryPage.entries[0],ids=[];let offset=0,calls=0;
 do{const page=directoryPage(index,{directory:folder.id,offset}).directoryPage;assert(page.entries.length<=50);ids.push(...page.entries.map(r=>r.fileId));offset=page.pagination.nextOffset;calls++;}while(offset!==null);
 assert.equal(calls,25);assert.equal(ids.length,1234);assert.equal(new Set(ids).size,1234);
});
test('Directories precede files, type sort remains stable, and invalid IDs cannot be used as filesystem paths',()=>{
 const index=createDirectoryIndex(directoryItems([row('z.pdf',1),row('a.bin',2),row('b.docx',3),row('深层.txt',4,['软件','子目录'])]));const id=directoryPage(index).directoryPage.entries[0].id,entries=directoryPage(index,{directory:id,sort:'type'}).directoryPage.entries;
 assert.equal(entries[0].type,'directory');assert.deepEqual(entries.slice(1).map(r=>r.name),['a.bin','b.docx','z.pdf']);assert.throws(()=>directoryPage(index,{directory:'../../E:/'}),/invalid-directory/);assert.throws(()=>directoryPage(index,{directory:'f'.repeat(24)}),/directory-not-found/);
});
test('Search preserves original folder locator, metadata-only binaries and old document identities',()=>{
 const index=createDirectoryIndex(directoryItems([row('A5规格书V1.0.pdf',1,['产品资料','A5']),row('A5规格书V2.0.pdf',2,['产品资料','A5']),row('固件.img',3,['固件'])]));const page=directoryPage(index,{query:'A5'}).directoryPage;assert.equal(page.entries.length,3);assert.equal(page.entries[0].type,'directory');assert.equal(page.entries[0].label,'A5');assert.equal(page.entries.filter(r=>r.type==='file').length,2);assert(page.entries.filter(r=>r.type==='file').every(r=>index.nodes.has(r.directoryId)));assert(page.entries.some(r=>r.versionSelection==='historical'));assert.equal(directoryPage(index,{query:'固件.img'}).directoryPage.entries[0].searchContent,'file-metadata-only');
});
test('All requested extensions have local vector icon categories without implying firmware compatibility',()=>{
 for(const [names,type] of [[['a.pdf'],'pdf'],[['a.doc','a.docx'],'word'],[['a.xls','a.xlsx','a.csv'],'sheet'],[['a.ppt','a.pptx'],'slides'],[['a.txt','a.md'],'text'],[['a.jpg','a.png','a.webp'],'image'],[['a.mp4','a.mov','a.webm'],'video'],[['a.zip','a.rar','a.7z'],'archive'],[['a.exe','a.msi','a.apk','a.deb'],'package'],[['a.bin','a.img'],'binary'],[['a.ssr','a.ssx'],'config'],[['a.unknown'],'file']])for(const name of names)assert.equal(fileType(name)[0],type,name);
});

test('Directory search only uses folder and file names; supplied body evidence cannot change the results',()=>{
 const index=createDirectoryIndex(directoryItems([row('正常文件.pdf',1,['产品资料','命中目录'])]));
 const directory=directoryPage(index,{query:'命中目录'}).directoryPage.entries;assert.equal(directory.length,1);assert.equal(directory[0].type,'directory');
 const bodyOnly=directoryPage(index,{query:'仅在正文出现',evidence:[{versionId:'v-1'}]}).directoryPage;assert.equal(bodyOnly.entries.length,0);
});
