'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {identifyDocument}=require('../domain/knowledge/document-catalog.cjs');
const {augmentProducts}=require('../domain/knowledge/local-resource-catalog.cjs');
const {selectDocumentVersions}=require('../domain/knowledge/document-versions.cjs');
test('Cached cover and explicit document title correct folder mismatch without inventing model conflicts',()=>{
 const folders=['产品规格书（LED）','矩阵'];
 assert.equal(identifyDocument({name:'HD-PS08说明书V1.1.pdf',folders,documentMetadata:{kind:'manual',coverModels:['PS08']}}).kind,'manual');
 assert.equal(identifyDocument({name:'HD-C08L Specification V1.1.pdf',folders,documentMetadata:{kind:'manual',coverModels:['C08L']}}).kind,'spec');
 assert.equal(identifyDocument({name:'HD-S208传感器规格书 V2.0.pdf',documentMetadata:{kind:'spec',coverModels:['S208HD-S208']}}).modelIds[0],'HD-S208');
 assert.equal(identifyDocument({name:'HD-AP0x0x规格书V1.1.pdf',documentMetadata:{kind:'spec',coverModels:['AP0808','AP1616']}}).kind,'spec');
 assert.equal(identifyDocument({name:'C1 Cloud使用手册 V1.0.pdf',documentMetadata:{kind:'manual',coverModels:['MS1000-2U']}}).kind,'manual');
 for(const name of ['CR UL测试.pdf','电池ROHS.pdf','灰度国高证书.pdf','互联网云平台管理方案V3.1.pptx'])assert.equal(identifyDocument({name,documentMetadata:{coverModels:['UNRELATED99']}}).kind,'other');
 assert.equal(require('../domain/knowledge/source-classification.cjs').sourceClassification({name:'352C升级.mp4',folders:['操作说明','LCD']}).kind,'video');
 assert.equal(identifyDocument({name:'352C升级.mp4',folders:['操作说明','LCD']}),null);
});
test('Numeric LCD models and English latest PDF are included without aliasing suffixes or languages',()=>{
 const rows=augmentProducts([{modelId:'HD-3566S',documents:[]},{modelId:'HD-3566P',documents:[]}],[{name:'3566S系统操作手册.docx',sha256:'a'.repeat(64)},{name:'3566P User Manual V1.0.pdf'},{name:'3566P User Manual V2.0.pdf'},{name:'3566P User Manual V2.0.docx'}]);
 assert.equal(rows[0].documents.length,1);const docs=selectDocumentVersions(rows[1].documents).selected;assert.deepEqual(docs.map(x=>x.name),['3566P User Manual V2.0.pdf']);
 assert.equal(identifyDocument({name:'X9 Specification_V1.3.pdf'}).kind,'spec');
});
test('Multiple named models stay explicit, unassigned and software manuals are not discarded',()=>{
 const products=[{modelId:'HD-X1',documents:[]},{modelId:'HD-X1L',documents:[]},{modelId:'HD-X2',documents:[]}];
 assert.deepEqual(identifyDocument({name:'X1 X2使用说明书.pdf'},products).modelIds,['HD-X1','HD-X2']);
 assert.equal(identifyDocument({name:'LCDPlayer操作说明.docx'},products).collection,'软件 · APP · 云平台');
 const rows=augmentProducts(products,[{name:'接线操作手册.doc',sha256:'b'.repeat(64)}]);assert.ok(rows.some(p=>p.documentCategory==='unassigned-documents'&&p.documents.length===1));
});
test('Original cover classification requires a title, not a passing mention or release notes',()=>{
 assert.equal(identifyDocument({name:'X9.pdf',documentIntro:'故障处理时应当阅读产品规格书。'}),null);
 assert.equal(identifyDocument({name:'更新说明.txt'}),null);
 const doc=identifyDocument({name:'资料.pdf',documentIntro:'PRODUCT SPECIFICATION\nHD-X9\nV1.0'});assert.equal(doc.kind,'spec');assert.deepEqual(doc.modelIds,['HD-X9']);
});
test('Same-name different contents remain distinct; neutral editions and identical copies do not hide standard sources',()=>{
 const product={modelId:'HD-X9',documents:[{name:'X9操作说明.docx',kind:'manual'}]},resources=[{name:'X9操作说明.docx',sha256:'a'.repeat(64),folders:['中性']},{name:'X9操作说明.docx',sha256:'b'.repeat(64),folders:['软件A']},{name:'X9操作说明.docx',sha256:'c'.repeat(64),folders:['软件B']},{name:'X9操作说明.docx',sha256:'b'.repeat(64),folders:['重复副本']}];
 const rows=augmentProducts([product],resources)[0].documents;assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.sha256),['b'.repeat(64),'c'.repeat(64)]);assert.ok(rows.every(x=>x.displayQualifier));assert.equal(product.documents[0].sha256,undefined);
});
test('Plural English specification names share a version family, and exact duplicate downloads are deduplicated',()=>{
 const result=selectDocumentVersions([{name:'X9 Specifications V1.0.docx'},{name:'X9 Specification V2.0.pdf'},{name:'X9 Specification V2.0 (2).pdf',sha256:'c'.repeat(64)},{name:'X9 Specification V2.0 (3).pdf',sha256:'c'.repeat(64)}]);
 assert.ok(!result.selected.some(d=>/V1.0/.test(d.name)));assert.equal(result.duplicateAlternatives.length,1);
});
test('Legacy other-document labels are corrected by explicit manual titles without changing source objects',()=>{
 const original={modelId:'HD-X9',documents:[{name:'X9 Instruction Manual V1.0.pdf',kind:'other'}]};const rows=augmentProducts([original],[{name:'X9 Instruction Manual V1.0.pdf',sha256:'d'.repeat(64)}]);assert.equal(rows[0].documents[0].kind,'manual');assert.equal(original.documents[0].kind,'other');
});
test('Multiple version tokens are ambiguous, never used to merge hardware/software conditions',()=>{
 const rows=selectDocumentVersions([{name:'X9 硬件V1.0 使用说明V2.0.pdf'},{name:'X9 硬件V2.0 使用说明V2.1.pdf'}]).selected;assert.equal(rows.length,2);assert.ok(rows.every(x=>x.versionSelection==='version-unknown'));
});
