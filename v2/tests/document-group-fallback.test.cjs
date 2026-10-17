'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {augmentProducts}=require('../domain/knowledge/local-resource-catalog.cjs');
const {attachMissingSourceGroups}=require('../domain/knowledge/document-group-fallback.cjs');
const {sourceClassification}=require('../domain/knowledge/source-classification.cjs');
test('Communication module part codes and revisions never become Huidu hardware associations',()=>{
 const rows=augmentProducts([{modelId:'HD-C08',documents:[]}],[{name:'C08.00.0031-Vendor_LTE模块硬件使用指南.pdf',folders:['4G模块规格书'],locationId:1,sha256:'a'.repeat(64)}]);
 assert.equal(rows[0].documents.length,0);const part=rows.find(p=>p.displayName==='通讯模块及天线');assert.ok(part);assert.equal(part.modelId,null);assert.equal(part.documents[0].displayCategory,'accessory');assert.equal(part.documents[0].sha256,'a'.repeat(64));assert.equal(part.documents[0].associationStatus,'component-source-directory-not-product-identity');
 const battery=augmentProducts([],[{name:'F01.03.0254 CR2032电池规格书.pdf',folders:['产品型号电池一览表'],sha256:'b'.repeat(64)}]);assert.equal(battery[0].modelId,null);assert.equal(battery[0].displayName,'电池');assert.equal(battery[0].documents[0].displayCategory,'accessory');
});
test('Directory spreadsheets referencing specifications are other materials, not specifications themselves',()=>{
 const r={name:'资料使用说明.xlsx',documentMetadata:{kind:'spec',evidence:[{locator:{cells:[{value:'资料名称'},{value:'资料分类'},{value:'资料内容'}]}}]}};assert.equal(sourceClassification(r).kind,'other');const rows=augmentProducts([],[r]);assert.equal(rows[0].documents[0].kind,'other');
});
test('Old records recover category from exact originals or one confirmed product directory without changing scope',()=>{
 const rows=[{modelId:'HD-X9',documents:[{name:'X9规格书 V1.pdf',kind:'spec',applicability:'unchanged'},{name:'X9规格书 V2.pdf',kind:'spec',sha256:'a'.repeat(64)}]}];
 attachMissingSourceGroups(rows,[{name:'X9规格书 V2.pdf',sha256:'a'.repeat(64),folders:['产品规格书（LED）','VP系列-处理器']}]);assert.ok(rows[0].documents.every(d=>d.displayCategory==='processor'));assert.equal(rows[0].documents[0].applicability,'unchanged');assert.equal(rows[0].documents[0].url,undefined);
 const uncertain=[{documents:[{kind:'spec'},{kind:'spec',displayCategory:'receiver',sourceGroup:{key:'receiver',label:'接收卡'}},{kind:'spec',displayCategory:'player',sourceGroup:{key:'player',label:'播放盒'}}]}];attachMissingSourceGroups(uncertain,[]);assert.equal(uncertain[0].documents[0].displayCategory,undefined);
});
test('User-confirmed AI digital interaction category is browsed under LCD without inventing source domain',()=>{
 const r=sourceClassification({name:'OLED产品规格书.pdf',folders:['售前资料','2-解决方案','6-全域AI数字交互解决方案','3-产品规格书']});assert.equal(r.browseGroup.key,'lcd');assert.equal(r.browseGroup.label,'LCD');assert.equal(r.domain,null);
});
