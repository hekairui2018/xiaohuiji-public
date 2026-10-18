'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/product-resources.js'),'utf8'),context);const rows=context.window.ProductResources.documentRows;
test('Shared H20/H16 manuals pair Chinese and English before the additional Chinese-folder copy',()=>{
 const cn={name:'HD-H20、H16用户手册V1.0.pdf',documentLanguage:'zh'},extra={name:'HD-H20、H16 User manaualV1.0.pdf',clean:'HD-H20、H16 User manaualV1.0 · 全彩 / 中文'},en={name:'HD-H20、H16 user manaualV1.0.pdf',clean:'HD-H20、H16 user manaualV1.0 · 全彩 / 英文'};
 const result=rows([cn,extra,en]);assert.equal(result[0].zh,cn);assert.equal(result[0].other,en);assert.equal(result[1].zh,extra);assert.equal(result.flatMap(r=>[r.zh,r.other]).filter(Boolean).length,3);
});
test('Bilingual software pairing preserves original objects, versions and unmatched files',()=>{
 const cn={name:'屏掌控标准版（全彩）操作说明V5.2.pdf',url:'/cn'},en={name:'Screen Control Standard Edition (Full Color) Operating Instructions V5.2.pdf',url:'/en'},different={name:'Screen Control Standard Edition (Full Color) Operating Instructions V5.1.pdf'},unknown={name:'cloud setting-1.pdf'};
 const result=rows([unknown,en,different,cn]);assert.equal(result.length,2);assert.equal(result[0].zh,cn);assert.equal(result[0].other,en);assert.equal(result.flatMap(r=>[r.zh,r.other]).filter(Boolean).length,4);assert.equal(cn.url,'/cn');assert.equal(en.url,'/en');
});
test('Conflicting versions and duplicate translations remain separate files in compact layout',()=>{
 const cn={name:'小灰云信息发布系统使用说明书(LCD)V5.3.pdf'},en={name:'LCD display information management platform instructionV5.3.pdf'};
 assert.equal(rows([cn,en])[0].other,en);
 const duplicate=rows([cn,en,{...en,url:'/different'}]);assert.equal(duplicate.flatMap(r=>[r.zh,r.other]).filter(Boolean).length,3);
 assert.equal(rows([{...cn,versionStatus:'conflict'},en]).flatMap(r=>[r.zh,r.other]).filter(Boolean).length,2);
});

test('Two same-language originals share one line and additional originals wrap in pairs',()=>{
 const items=[{name:'CR1220电池规格书V3.0.pdf',fileId:'a'},{name:'CR2032电池规格书V3.0.pdf',fileId:'b'},{name:'第三份规格书.pdf',fileId:'c'}];const result=rows(items);assert.equal(result.length,2);assert.equal(result[0].zh,items[0]);assert.equal(result[0].other,items[1]);assert.equal(result[1].zh,items[2]);assert.equal(result[1].other,null);
});

test('Preview and download use independent existing routes and unsupported formats never act as previews',()=>{
 const {previewTarget,downloadTarget}=context.window.ProductResources;
 const item={name:'X9.pdf',url:'/v2/offline/file?id=7',available:true};assert.equal(previewTarget(item).url,'/v2/offline/preview?id=7');assert.equal(downloadTarget(item),'/v2/offline/file?id=7&download=1');
 assert.equal(previewTarget({...item,name:'X9.xlsx'}).url,'/v2/offline/preview?id=7');assert.equal(previewTarget({...item,name:'X9.bin'}).url,null);assert.match(previewTarget({...item,name:'X9.bin'}).reason,/不支持/);
 assert.equal(previewTarget({name:'X9.docx',url:'https://example.com/X9.docx'}).url,null);assert.equal(previewTarget({...item,available:false}).url,null);assert.equal(downloadTarget({...item,url:'/v2/offline/preview?id=7'}),'/v2/offline/file?id=7&download=1');
});
