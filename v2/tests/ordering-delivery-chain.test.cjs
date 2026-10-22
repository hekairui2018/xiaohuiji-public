'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs'),{progressiveOrdering}=require('../adapters/http/ordering-session.cjs');
const {parseGrid,gridEnvelope}=require('../domain/ordering/output/ssm-codec.cjs');
test('Generated alternatives switch actual controller, geometry and picture without confirming assumptions',async()=>{
 const app=createApp();let r=await progressiveOrdering(app,'配单P2.5室内屏，整屏1280×640');
 assert.ok(r.result.previewBom);assert.ok(r.result.options.length>=2);assert.ok(r.result.hdsetSvg);assert.equal(r.result.exportAllowed,false);
 const original=r.result.plan.controller.model,option=r.result.options.find(o=>o.controlMode==='async');assert.ok(option);
 r=await progressiveOrdering(app,'配单方案：'+option.id,r.orderingState);
 assert.equal(r.result.plan.controller.model,option.controller);assert.notEqual(r.result.plan.controller.model,original);assert.ok(r.result.hdsetSvg.includes(option.controller));assert.equal(r.orderingState.confirmed.controlMode,undefined);
 const rejected=await app.exportSsm(r.result.normalizedDemand);assert.notEqual(rejected.status,'ready');
});
test('Ordinary complete demand maps BOM, ordered receiver chains, drawing and SSM to the same plan',async()=>{
 const app=createApp(),r=await app.dialogue('配单P2.5 模组128x64 32扫 HUB75 全彩 室内 同步 接收卡 10宽10高');
 assert.equal(r.status,'ready');assert.equal(r.bom.find(x=>x.kind==='module').quantity,100);assert.equal(r.bom.find(x=>x.kind==='receiver').quantity,r.plan.cells.length);
 const exported=await app.exportSsm(r.normalizedDemand);assert.equal(exported.status,'ready');const grid=parseGrid(gridEnvelope(exported.xml).gridXml);
 for(const [i,p]of r.plan.ports.entries()){assert.equal(grid.ports[i].cells.length,p.cells.length);for(const [j,c]of p.cells.entries()){const actual=grid.ports[i].cells[j];assert.equal(actual.x+grid.ports[i].x,c.col*128);assert.equal(actual.y+grid.ports[i].y,c.row*64);assert.equal(actual.width,c.pixelWidth);assert.equal(actual.height,c.pixelHeight);}}
 assert.ok(r.hdsetSvg.includes(r.plan.controller.model));assert.equal(r.topology.connections.length,r.plan.cells.length);
});
test('Website long-strip output becomes a physical drawing and configuration is explicitly blocked',async()=>{
 const app=createApp(),r=await app.dialogue('配单P2.5 模组128x64 32扫 HUB75 全彩 室内 异步 播放盒 接收卡 40宽1高 A5L');
 assert.equal(r.plan.specialCanvas.raw.failed,false);assert.equal(r.plan.cells.length,r.plan.specialCanvas.raw.receiver.cardNum);assert.equal(r.plan.cells.reduce((n,c)=>n+c.columns*c.rows,0),40);assert.equal(r.exportAllowed,false);assert.ok(r.hdsetSvg);assert.equal(r.topology.connections.length,r.plan.cells.length);
 assert.notEqual((await app.exportSsm(r.normalizedDemand)).status,'ready');
});
