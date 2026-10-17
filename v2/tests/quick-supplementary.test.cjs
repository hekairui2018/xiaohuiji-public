'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectQuickDocuments}=require('../domain/knowledge/quick-document-policy.cjs');
const {createQuickService}=require('../adapters/http/quick-service.cjs');
test('Local guides move to other; English specifications and user manuals remain in their roles',()=>{
 const source=[['X9 Specification V1.0.pdf','spec'],['X9 User Manual V1.0.pdf','manual'],['X9 Operation Guide V1.0.pdf','manual'],['X9操作指南V1.0.pdf','manual'],['X9说明书.docx','manual']].map(([name,kind])=>({name,kind}));
 const rows=selectQuickDocuments(source,{local:true}).selected;
 assert.deepEqual(rows.map(r=>r.kind),['spec','manual','other','other']);
 assert.equal(source[2].kind,'manual');
 assert.equal(selectQuickDocuments(source).selected.length,2);
});
test('Signed folder originals retain separate identities, download links and do not supersede unsigned manuals',async()=>{
 const metadata={title:'X9 User Manual',coverModels:['HD-X9'],version:'V1.0'};
 const products=[{modelId:'HD-X9',displayName:'X9',documents:[],firmware:[]}];
 const resources=[
  {name:'X9 User Manual.pdf',sha256:'a'.repeat(64),locationId:1,folders:['使用说明'],documentMetadata:metadata,availabilityState:'present'},
  {name:'X9 User Manual.pdf',sha256:'b'.repeat(64),locationId:2,folders:['使用说明','签章'],documentMetadata:{...metadata,version:'V3.0'},availabilityState:'present'},
  {name:'X9 Operation Guide V1.0.pdf',sha256:'c'.repeat(64),locationId:3,folders:['使用说明'],availabilityState:'present'}];
 const app={quickResources:()=>({}),quickSearch:()=>({records:products}),quickBrowse:()=>products,chipLookup:()=>null};
 const quick=createQuickService(app,{localCatalog:async()=>resources,resolveDocuments:async docs=>docs.map(d=>{assert.notEqual(d.documentEdition,'signed');return {available:true,url:'/v2/offline/preview?id='+d.sourceLocationId};})});
 const view=(await quick.search('X9')).results[0];
 assert.equal(view.docGroups.find(g=>g.key==='manual').items.length,1);
 const other=view.docGroups.find(g=>g.key==='other').items;assert.equal(other.length,2);
 const signed=other.find(d=>d.documentEdition==='signed');assert.ok(signed.available);assert.equal(signed.downloadUrl,'/v2/offline/file?id=2&download=1');assert.equal(signed.sha256,'b'.repeat(64));
 const browse=(await quick.docs('other',{websiteOnly:true})).docs;assert.equal(browse.uniqueFileCount,2);assert.equal(browse.items.find(d=>d.documentEdition==='signed').url,'/v2/offline/preview?id=2');
 assert.equal((await quick.docs('manual',{websiteOnly:true})).docs.uniqueFileCount,1);
 assert.equal(resources[1].documentMetadata.version,'V3.0');
});

test('Same-named signed originals with different content keep their exact location links',()=>{
 const {augmentProducts}=require('../domain/knowledge/local-resource-catalog.cjs');
 const resources=['a','b'].map((h,i)=>({name:'X9说明书.pdf',locationId:i+1,sha256:h.repeat(64),folders:['使用说明','签章'],availabilityState:'present'}));
 const docs=augmentProducts([{modelId:'HD-X9',documents:[]}],resources,{includeSigned:true})[0].documents;
 assert.equal(docs.length,2);assert.equal(docs[0].url,'/v2/offline/preview?id=1');assert.equal(docs[1].url,'/v2/offline/preview?id=2');
});
