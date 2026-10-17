'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {identifyDocument}=require('../domain/knowledge/document-catalog.cjs');
const {browseGroup}=require('../domain/knowledge/source-classification.cjs');
const {createQuickService}=require('../adapters/http/quick-service.cjs');
const {operationVideos}=require('../domain/knowledge/video-purpose.cjs');
const {groupVideos}=require('../domain/knowledge/resource-categories.cjs');
test('Registered source roles beat filename hints; original content and format conflicts remain pending',()=>{
 const folder=['产品资料','产品规格书（LED）','C系列-异步发送卡'];
 assert.equal(identifyDocument({name:'X9使用说明.pdf',folders:folder}).kind,'spec');
 const conflict=identifyDocument({name:'X9.pdf',folders:folder,documentMetadata:{kind:'manual',coverModels:['X9']}});assert.equal(conflict.kind,'pending');assert.equal(conflict.classificationConflict,'source-folder-original-content-conflict');
 assert.equal(identifyDocument({name:'X9.exe',folders:folder}).kind,'pending');
 assert.equal(identifyDocument({name:'无版号.pdf',folders:folder}).modelIds.length,0);
 assert.equal(browseGroup('K系列-接收卡').key,browseGroup('R系列-接收卡').key);assert.equal(browseGroup('A系列-播放盒').key,browseGroup('H系列-多媒体播放盒').key);
 assert.notEqual(browseGroup('C系列-异步发送卡').key,browseGroup('D系列-小屏控制卡').key);
});
test('A newly registered catalogue row inherits source category without rebuilding products or parameters',async()=>{
 let resources=[];const products=[{modelId:'HD-X9',displayName:'X9',parameters:{load:'unchanged'},documents:[],firmware:[]}],app={quickResources:()=>({}),quickSearch:()=>({records:[]}),quickBrowse:()=>products};
 const quick=createQuickService(app,{localCatalog:async()=>resources});assert.equal((await quick.docs('manual',{view:'flat'})).docs.items.length,0);
 resources=[{name:'新增资料.pdf',folders:['产品资料','操作说明','文档','全彩'],sha256:'b'.repeat(64),resourceId:'r',versionId:'v',documentMetadata:{kind:'manual',coverModels:['X9']}}];
 const b=(await quick.docs('manual',{view:'flat'})).docs;assert.equal(b.groups[0].label,'全彩');assert.equal(b.items[0].resourceId,'r');assert.equal(b.items[0].documentVersion,null);assert.deepEqual(b.items[0].associatedModels,['HD-X9']);assert.equal(products[0].parameters.load,'unchanged');assert.equal(products[0].documents.length,0);
});
test('Flat source groups directly contain unique files and preserve model associations and unknown versions',async()=>{
 const p=['X1','X2'].map(m=>({modelId:'HD-'+m,displayName:m,documents:[],firmware:[]})),resources=['K系列-接收卡','R系列-接收卡'].map((f,i)=>({name:'X1 X2规格书.pdf',folders:['产品资料','产品规格书（LED）',f],sha256:'a'.repeat(64),locationId:i+1,resourceId:'r',versionId:'v',documentMetadata:{kind:'spec',coverModels:['X1','X2']}}));
 const app={quickResources:()=>({}),quickSearch:()=>({records:[]}),quickBrowse:()=>p},quick=createQuickService(app,{localCatalog:async()=>resources});
 const b=(await quick.docs('spec',{view:'flat'})).docs;assert.equal(b.groups.length,1);assert.equal(b.groups[0].key,'receiver');assert.equal(b.groups[0].items.length,1);assert.equal(b.groups[0].products,undefined);assert.equal(b.items[0].associatedModels.length,2);assert.equal(b.items[0].versionStatus,'unknown');assert.equal(b.pagination.total,1);
 const page=(await quick.docs('spec',{view:'flat',limit:1})).docs;assert.equal(page.items.length,1);assert.equal(page.pagination.nextOffset,null);
});
test('Operating-video folders determine browse class; promotional and training videos stay out of the operation list',()=>{
 const videos=[{name:'参数.mp4'},{name:'功能.mp4'},{name:'入门.mp4'},{name:'LCD 操作.mp4'}],resources=[{name:'参数.mp4',folders:['产品资料','操作视频','LED']},{name:'功能.mp4',folders:['产品资料','产品宣传视频']},{name:'入门.mp4',folders:['培训资料']},{name:'LCD 操作.mp4',folders:['产品资料','操作视频','LCD']}];
 const result=operationVideos(videos,resources);assert.equal(result.selected.length,2);assert.equal(result.withheld.length,2);const groups=groupVideos(result.selected,resources);assert.ok(groups.some(g=>g.key==='lcd'));assert.ok(groups.some(g=>g.label==='LED'));assert.ok(groups.every(g=>Array.isArray(g.videos)&&!g.groups));
});
