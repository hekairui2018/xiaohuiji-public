'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectDocumentVersions}=require('../domain/knowledge/document-versions.cjs');
test('The same filename family keeps highest version when cover title language changes',()=>{
 const result=selectDocumentVersions([{name:'HD-PS08说明书V1.0.pdf',documentMetadata:{title:'产品手册',coverModels:['PS08'],version:'V1.0'}},{name:'HD-PS08说明书V1.1.pdf',documentMetadata:{title:'PRODUCT MANUAL',coverModels:['PS08'],version:'V1.1'}}]);assert.equal(result.selected.length,1);assert.equal(result.selected[0].documentVersion,'V1.1');assert.equal(result.withheld.length,1);
});
test('Adjacent and spaced versions select the highest document revision without merging other titles',()=>{
 const selected=selectDocumentVersions([{name:'互联网云平台管理方案V3.1.pptx'},{name:'互联网云平台管理方案V3.13-已修改.pptx'},{name:'H20 User manaualV1.0.pdf'},{name:'H20 User manaualV 1.1.pdf'}]);
 assert.deepEqual(selected.selected.map(d=>d.documentVersion),['V3.13','V1.1']);assert.equal(selected.withheld.length,2);
});
test('Document numeric versions select latest and prefer PDF while preserving languages, suffixes and hardware identities',()=>{
 const names=['A3L规格书 V1.9.pdf','A3L规格书 V1.10.pdf','A3L规格书 V1.10.docx','A3L Specification V1.0.pdf','A3规格书 V1.2.pdf','A3L E1规格书 V1.0.pdf','A3L E2规格书 V1.0.pdf','A3L规格书 V1.8_已签章.pdf','A3L说明书.pdf'];
 const docs=names.map(name=>({name})),r=selectDocumentVersions(docs);assert.equal(r.withheld.length,1);assert.equal(r.withheld[0].name,names[0]);assert.equal(r.selected.length,6);assert.equal(r.excludedSigned[0].name,names[7]);assert.equal(r.formatAlternatives[0].name,names[2]);assert.ok(r.selected.find(d=>d.name===names.at(-1)).versionSelection==='version-unknown');assert.deepEqual(selectDocumentVersions(docs,{includeHistory:true}).selected.map(d=>d.name),names);assert.equal(docs[0].versionSelection,undefined);
});
test('Signed copies stay in audit data but never displace unsigned website documents',()=>{
 const names=['X1规格书 V1.0.pdf','X1规格书 V3.0_已签章.pdf','X2说明书（盖章）.pdf','X3说明书_未签章.pdf'];
 const docs=names.map(name=>({name})),r=selectDocumentVersions(docs);
 assert.deepEqual(r.selected.map(d=>d.name),[names[0],names[3]]);
 assert.equal(r.excludedSigned.length,2);
 assert.equal(selectDocumentVersions(docs,{includeHistory:true}).selected.length,4);
});
test('An older PDF never hides a newer DOCX, and English PDF never hides Chinese DOCX',()=>{
 const r=selectDocumentVersions([{name:'Z9规格书 V1.0.pdf'},{name:'Z9规格书 V2.0.docx'},{name:'Z9 Specification V2.0.pdf'}]);assert.ok(r.selected.some(d=>d.name==='Z9规格书 V2.0.docx'));assert.equal(r.selected.length,2);
});
test('Local newer originals replace older branded presentation names without losing hardware suffixes',()=>{
 const r=selectDocumentVersions([{name:'HD-X9规格书_V1.0.pdf'},{name:'X9规格书_V2.0.pdf'},{name:'X9-TP规格书_V1.0.pdf'}]);
 assert.deepEqual(r.selected.map(d=>d.name),['X9规格书_V2.0.pdf','X9-TP规格书_V1.0.pdf']);assert.equal(r.withheld.length,1);
});
test('A latest file with no link never silently falls back to an older download',()=>{
 const r=selectDocumentVersions([{name:'Z9规格书 V1.0.pdf',url:'/old.pdf'},{name:'Z9规格书 V2.0.pdf',url:null}]);assert.equal(r.selected.length,1);assert.equal(r.selected[0].url,null);assert.equal(r.selected[0].documentVersion,'V2.0');
});
