'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {specificationGroups}=require('../domain/knowledge/specification-groups.cjs');
const {browseGroup}=require('../domain/knowledge/source-classification.cjs');
function group(label,model){const c=browseGroup(label);return {...c,products:[{model,items:[{fileId:model,name:model+'.pdf',url:'/original/'+model}]}]};}
test('Specification presentation merges C/D, places T immediately after VP and retains every original',()=>{
 const source=['D系列-小屏控制卡','T系列-同步发送','C系列-异步发送卡','VP系列-处理器','A系列-播放盒','K系列-接收卡'].map((label,i)=>group(label,'X'+i));source.unshift({key:'unassigned-documents',label:'分类待确认',products:[{model:'unknown',items:[]}]});
 const unchanged=JSON.stringify(source),result=specificationGroups(source);
 assert.deepEqual(result.map(g=>g.label),['接收卡（K、R系列）','全彩播放盒（A、H系列）','C、D系列-全彩控制卡','VP系列-处理器','T系列-同步发送','分类待确认']);
 assert.equal(result.find(g=>g.key==='cd-control').count,2);
 assert.deepEqual(result.flatMap(g=>g.products.flatMap(p=>p.items.map(d=>d.url))).sort(),source.flatMap(g=>g.products.flatMap(p=>p.items.map(d=>d.url))).sort());assert.equal(JSON.stringify(source),unchanged);
});
test('Shared C/D original is counted once per model; distinct same-named originals remain separate',()=>{
 const c=group('C系列-异步发送卡','X1'),d=group('D系列-小屏控制卡','X1');d.products[0].items.push({fileId:'different-content',name:'X1.pdf',url:'/different'});
 const result=specificationGroups([c,d])[0];assert.equal(result.count,1);assert.equal(result.fileCount,2);assert.equal(result.products[0].items[1].url,'/different');
});

test('User-confirmed VP8000M browse placement stays with matrix equipment and retains file identity',()=>{
 const p=group('VP系列-处理器','HD-VP8000M');const result=specificationGroups([p]);assert.match(result[0].label,/矩阵/);assert.equal(result[0].products[0].items[0].url,'/original/HD-VP8000M');
});
