'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {identifyDocument}=require('../domain/knowledge/document-catalog.cjs');
const {selectDocumentVersions}=require('../domain/knowledge/document-versions.cjs');
const {attachLocalSoftware}=require('../domain/knowledge/media-catalog.cjs');
test('Certificate role overrides misleading embedded specification headings',()=>{
 const d=identifyDocument({name:'Radio Certificate.pdf',documentIntro:'PRODUCT SPECIFICATION\nHD-X9',documentMetadata:{certificate:true,kind:'other'}});assert.equal(d.kind,'other');
});
test('Conflicting original cover model is held as pending instead of being attached to either product',()=>{
 const d=identifyDocument({name:'X9说明书.pdf',documentMetadata:{kind:'manual',coverModels:['X9L'],classificationStatus:'original-title-confirmed'}},[{modelId:'HD-X9'},{modelId:'HD-X9L'}]);assert.equal(d.kind,'pending');assert.deepEqual(d.modelIds,[]);assert.equal(d.associationStatus,'model-conflict');
});
test('Original versions participate, renamed covers share family only in identical model/hardware scope',()=>{
 const meta={title:'产品使用说明书',coverModels:['X9'],scopeEvidence:['硬件版本E1'],version:'V1.0'};
 const docs=[{name:'旧中文说明.pdf',documentMetadata:meta},{name:'新的中文说明.pdf',documentMetadata:{...meta,version:'V2.0'}},{name:'另一硬件说明.pdf',documentMetadata:{...meta,scopeEvidence:['硬件版本E2'],version:'V1.0'}},{name:'未识别中文说明.pdf'},{name:'冲突说明V3.0.pdf',documentMetadata:{...meta,version:'V2.0'}}];
 const result=selectDocumentVersions(docs);assert.equal(result.withheld.length,1);assert.equal(result.withheld[0].name,docs[0].name);assert.ok(result.selected.some(x=>x.name===docs[2].name));assert.ok(result.selected.filter(x=>x.versionSelection==='version-unknown').length>=2);
});
test('A missing DOCX reference does not reappear when an identical named PDF has cover metadata',()=>{
 const result=selectDocumentVersions([{name:'X9说明V1.0.docx'},{name:'X9说明V1.0.pdf',documentMetadata:{title:'产品说明书',coverModels:['X9'],version:'V1.0',scopeEvidence:[]}}]);assert.equal(result.selected.length,1);assert.equal(result.selected[0].name,'X9说明V1.0.pdf');
});
test('Hardware tags in names remain distinct even when cached cover title/model are identical',()=>{
 const meta={title:'产品说明书',coverModels:['X9'],scopeEvidence:[]};const rows=selectDocumentVersions([{name:'X9 E1说明V1.0.pdf',documentMetadata:{...meta,version:'V1.0'}},{name:'X9 E2说明V2.0.pdf',documentMetadata:{...meta,version:'V2.0'}}]);assert.equal(rows.selected.length,2);assert.equal(rows.withheld.length,0);
});
test('Registered installer uses local identity; ambiguous hashes retain cloud fallback without guessing',()=>{
 const input=()=>({software:{items:[{name:'Tool',file:'下载Tool.exe',hasDownloader:true,downloadUrl:'https://example.com/original.exe'}]}}),r={name:'下载tool.exe',sha256:'a'.repeat(64),resourceType:'software',locationId:9,resourceId:'r',versionId:'v'};
 const local=attachLocalSoftware(input(),[r]).software.items[0];assert.equal(local.sourceMode,'local');assert.equal(local.downloadUrl,'/v2/offline/file?id=9&download=1');assert.equal(local.resourceVersionId,'v');const conflict=attachLocalSoftware(input(),[r,{...r,sha256:'b'.repeat(64)}]).software.items[0];assert.equal(conflict.downloadUrl,'https://example.com/original.exe');assert.equal(conflict.localUnavailableReason,'same-name-content-conflict');
});
test('Shared originals retain multiple product associations but one file count',async()=>{
 const {createQuickService}=require('../adapters/http/quick-service.cjs');
 const products=['X1','X2'].map(displayName=>({displayName,modelId:'HD-'+displayName,documents:[{name:'X1 X2操作说明.pdf',kind:'manual'}]}));
 const app={quickResources:()=>({}),quickSearch:()=>({records:[]}),quickBrowse:()=>products};
 const quick=createQuickService(app,{resolveDocuments:async docs=>docs.map(()=>({url:'/v2/offline/file?id=1',available:true,sha256:'a'.repeat(64)}))});const docs=(await quick.docs('manual')).docs;assert.equal(docs.total,2);assert.equal(docs.associationCount,2);assert.equal(docs.uniqueFileCount,1);assert.equal(docs.uniqueAvailableFileCount,1);
});
