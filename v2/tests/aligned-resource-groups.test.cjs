'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {alignedResourceGroups}=require('../domain/knowledge/aligned-resource-groups.cjs');
const {browseGroup}=require('../domain/knowledge/source-classification.cjs');
const item={name:'original V1.pdf',fileId:'one',url:'/preview/one',downloadUrl:'/download/one',documentVersion:'V1'};
const product=(model,items=[item])=>({model,label:model,items,count:items.length});
const reference=(model,label)=>({displayName:model,documents:[{kind:'spec',sourceGroup:browseGroup(label)}]});
test('Manuals follow confirmed specification ownership ahead of old folder grouping; all other files remain selectable',()=>{
 const source=[{key:'accessory',label:'配件',products:[product('HD-E63')]},{key:'old-fullcolor',label:'全彩',products:[product('HD-A7'),product('HD-C16L')]},{key:'cloud',label:'云平台',products:[product('软件与云'),product('UNKNOWN')]}];
 const original=JSON.stringify(source),rows=alignedResourceGroups(source,[reference('HD-E63','单双色产品'),reference('HD-C16L','C系列-异步发送卡')]);
 assert.deepEqual(rows.map(g=>g.key),['player','cd-control','mono','other']);assert.equal(rows.find(g=>g.key==='mono').products[0].model,'HD-E63');assert.equal(rows.at(-1).products.length,2);
 assert.equal(JSON.stringify(source),original);for(const g of rows)for(const p of g.products)assert.deepEqual(p.items[0],{...item,associatedModels:[]});
});
test('Firmware variants are never filtered by browse grouping; ambiguous unrecognized models stay in other',()=>{
 const variants=[{...item,name:'R708_HW1_V1.bin',fileId:'hw1'},{...item,name:'R708_HW2_V2.bin',fileId:'hw2'}];
 const rows=alignedResourceGroups([{key:'other',label:'固件',products:[product('HD-R708',variants),product('HD-X99')]}],[]);
 assert.deepEqual(rows.map(g=>g.key),['receiver','other']);assert.deepEqual(rows[0].products[0].items.map(i=>i.fileId),['hw1','hw2']);assert.equal(rows[1].products[0].model,'HD-X99');
});

test('B/C/D firmware belongs to its product family even without a specification or full-color folder label',()=>{
 const models=['HD-B6L','HD-C08L','HD-C15','HD-C16','HD-C16L','HD-C35','HD-D16','HD-C08'];
 const rows=alignedResourceGroups([{key:'other',label:'固件',products:models.map(m=>product(m))}],[reference('HD-C08','配件')]);
 assert.deepEqual(rows.map(g=>g.label),['B系列-广告机专用','C、D系列-全彩控制卡','配件']);
 assert.deepEqual(rows[1].products.map(p=>p.model),models.slice(1,-1));
 assert.equal(rows[2].products[0].model,'HD-C08');
});
