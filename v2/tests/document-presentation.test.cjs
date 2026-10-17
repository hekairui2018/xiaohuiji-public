'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/product-resources.js'),'utf8'),context);const rows=context.window.ProductResources.documentRows;
test('Bilingual software pairing preserves original objects, versions and unmatched files',()=>{
 const cn={name:'屏掌控标准版（全彩）操作说明V5.2.pdf',url:'/cn'},en={name:'Screen Control Standard Edition (Full Color) Operating Instructions V5.2.pdf',url:'/en'},different={name:'Screen Control Standard Edition (Full Color) Operating Instructions V5.1.pdf'},unknown={name:'cloud setting-1.pdf'};
 const result=rows([unknown,en,different,cn]);assert.equal(result.length,3);assert.equal(result[0].zh,cn);assert.equal(result[0].other,en);assert.equal(result.flatMap(r=>[r.zh,r.other]).filter(Boolean).length,4);assert.equal(cn.url,'/cn');assert.equal(en.url,'/en');
});
test('Conflicting versions and ambiguous duplicate translations are never paired automatically',()=>{
 const cn={name:'小灰云信息发布系统使用说明书(LCD)V5.3.pdf'},en={name:'LCD display information management platform instructionV5.3.pdf'};
 assert.equal(rows([cn,en])[0].other,en);
 assert.equal(rows([cn,en,{...en,url:'/different'}]).filter(r=>r.zh&&r.other).length,0);
 assert.equal(rows([{...cn,versionStatus:'conflict'},en]).filter(r=>r.zh&&r.other).length,0);
});
