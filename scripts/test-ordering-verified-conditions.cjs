'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const e=require('../backend/ordering/ordering-engine.cjs');
const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../backend/ordering/data/09_配单选型知识库_已验证带载档案.json'),'utf8')).profiles[0];
for(const q of ['P2 64x64 32S HUB75 全彩 宽10块高10块 同步',
 'P2 模组分辨率64x64点 32S HUB75 全彩 10宽10高 同步',
 'P2 64×64 32扫 HUB75E 全彩 10宽10高 同步'])test('Exact verified module: '+q,()=>{
 const a=e.answerWithContext([q]),r=a.result;assert.deepEqual(a.input.modulePixels,source.match.modulePixels);
 assert.ok(r.ok);assert.equal(r.preset.key,source.id);assert.equal(r.resultState,'formal');
 assert.equal(r.screenW,640);assert.equal(r.screenH,640);assert.equal(r.totalPx,409600);
 const layout=source.receiverLayouts[r.card.name];assert.ok(layout);assert.equal(r.card.w,layout.w);assert.equal(r.card.h,layout.h);
 assert.equal(r.bom.items.find(x=>x.category==='receiver').quantity,r.receiverQuantity);
 assert.equal(r.plan.ports.flatMap(p=>p.cells).reduce((sum,c)=>sum+c.points,0),r.totalPx);
 assert.ok(r.plan.ports.every(p=>p.points<=655360));assert.ok(r.physicalPortCount<=r.processor.ports);
});
for(const scan of ['16S','64S',''])test('Special profile cannot be confirmed with scan '+(scan||'missing'),()=>{
 const r=e.answerWithContext([`P2 模组分辨率64x64点 ${scan} HUB75 全彩 10宽10高 同步`]).result;
 assert.notEqual(r.resultState,'formal');assert.notEqual(r.preset?.key,source.id);assert.ok(!r.ok);
 assert.match((r.missing||[]).join(' '),/扫描|扫/);
});
test('Special profile cannot infer missing interface',()=>{
 const r=e.answerWithContext(['P2 模组分辨率64x64点 32S 全彩 10宽10高 同步']).result;
 assert.ok(!r.ok);assert.match((r.missing||[]).join(' '),/接口/);
});
test('Special profile cannot infer missing color',()=>{
 const r=e.answerWithContext(['P2 模组分辨率64x64点 32S HUB75 10宽10高 同步']).result;
 assert.ok(!r.ok);assert.match((r.missing||[]).join(' '),/颜色|全彩/);
});
test('Structured explicit facts agree with natural-language verified plan',()=>{
 const input=e.parseRequest('P2 模组分辨率64x64点 32S HUB75 全彩 10宽10高 同步');
 const r=e.calculate(input);assert.equal(r.preset.key,source.id);assert.equal(r.resultState,'formal');
});
test('Explicit screen resolution is not a module',()=>{
 const input=e.parseRequest('整屏分辨率1920x1080 P3 同步');assert.deepEqual(input.screenPixels,[1920,1080]);assert.equal(input.modulePixels,null);
});
test('A pixel grid alone does not prove a verified pitch',()=>{
 const r=e.answerWithContext(['模组分辨率64x64点 32S HUB75 全彩 10宽10高 同步']).result;
 assert.ok(!r.ok);assert.match((r.missing||[]).join(' '),/点间距/);
});
