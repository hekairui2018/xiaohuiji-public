'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sourceHistory}=require('../domain/knowledge/source-history.cjs');
const {materialInfo}=require('../domain/knowledge/other-material-groups.cjs');
const {selectFirmwareVersions}=require('../domain/knowledge/firmware-versions.cjs');
const {selectQuickDocuments}=require('../domain/knowledge/quick-document-policy.cjs');
test('Explicit registered archive folders include numbered historical solutions and discontinued firmware',()=>{
 for(const dir of ['1-2025历史资料','已停产旧卡固件','旧款发送卡固件','旧版本','R7xx接收卡V24只支持亮度亮暗线固件（老版本）'])assert(sourceHistory({folders:['资料',dir]}).archived,dir);
 const result=materialInfo({name:'控制方案.docx'},[{folders:['售前资料','1-2025历史资料']}]);assert.equal(result.materialProperty,'history');assert.equal(result.historyStatus,'archived-not-automatically-invalid');
});
test('Filename age, website absence and ambiguous directory words do not imply historical status',()=>{
 for(const r of [{name:'旧参数2021.docx'},{name:'文档.pdf',onWebsite:false},{folders:['历史资料整理方法']},{sourceDirectory:'G盘 / 产品型号电池一览表'}])assert.equal(sourceHistory(r).archived,false);
});
test('Archived other documents survive website-format filtering locally without changing specification or manual roles',()=>{
 const archive={name:'控制方案V0.1.docx',kind:'other',sourceDirectory:'G盘 / 售前资料 / 1-2025历史资料',resourceVersionId:'original-a'};
 const active={name:'普通方案.docx',kind:'other',sourceDirectory:'G盘 / 售前资料'};
 const rows=selectQuickDocuments([archive,active],{local:true,websiteOnly:true}).selected;assert.equal(rows.length,1);assert.equal(rows[0].resourceVersionId,'original-a');assert.equal(rows[0].kind,'other');
 assert.equal(selectQuickDocuments([archive],{local:false,websiteOnly:true}).selected.length,0);
});
test('An archived binary with a higher version cannot hide the current source binary',()=>{
 const current={file:'R712_FPGA_V25.13.99.30.bin',sourceDirectory:'G盘 / 接收卡固件 / R712',sha256:'a'.repeat(64),publicUrl:'/file?id=1'};
 const archive={file:'R712_FPGA_V99.13.99.30.bin',sourceDirectory:'G盘 / 已停产旧卡固件',sha256:'b'.repeat(64),publicUrl:'/file?id=2'};
 const result=selectFirmwareVersions([current,archive]);assert.equal(result.selected.length,1);assert.equal(result.selected[0].sha256,current.sha256);assert.equal(result.withheld[0].sha256,archive.sha256);assert.equal(result.withheld[0].publicUrl,archive.publicUrl);assert.equal(result.withheld[0].historyBasis,'registered-archive-directory');
});
test('Archive status never grants internal access or changes signature and manufacturer attributes',()=>{
 const r={name:'盖章方案.docx',folders:['私密','1-2025历史资料']};const result=materialInfo(r,[r]);assert.equal(result.materialProperty,'internal');assert(result.materialProperties.includes('history'));assert(result.accessRestricted);
});
