'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadDataset}=require('../adapters/data/load-dataset.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs');
const {c16CanDrive,sharedCabinet}=require('../domain/ordering/c16-sharing.cjs');
const {analyzeSpecialCanvas}=require('../domain/ordering/special-canvas.cjs');
const {createAcceptance}=require('../acceptance/index.cjs'),{parseGrid}=require('../domain/ordering/output/ssm-codec.cjs');
const dataset=loadDataset(),app=createApp(),audit=createAcceptance({dataset,knowledge:loadKnowledge()});
const bytes=fs.readFileSync('reference/official-selection-tool/official-selection-bundle.js');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),dataset.source.sha256);const source=bytes.toString();
const requirement=()=>({schemaVersion:'2.0',operation:'ordering',controlMode:'async',architecture:'receiver',environment:'indoor',module:{pitchMm:2.5,pixelWidth:128,pixelHeight:64,scan:{numerator:1,denominator:32},interface:'HUB75',color:{r:1,g:1,b:1}},requirements:{controllerFamily:'asyncCard',c16Sharing:true},cabinet:{moduleColumns:1,moduleRows:4,columns:3,rows:1},providedDevices:[{modelId:'C16L'},{modelId:'R712'}]});
test('C16 conditions match frozen Gi and its actual source tables, including boundaries and other interfaces',()=>{
 const start=source.indexOf('Gi=(e,t)=>'),end=source.indexOf(',Ey=',start),tableStart=source.indexOf('ky={"1.25"'),tableEnd=source.indexOf(',er=',tableStart);assert.ok(start>0&&end>start&&tableStart>0);
 const tables=vm.runInNewContext('(()=>{const '+source.slice(tableStart,tableEnd)+';return {ky,ql};})()');let checked=0;
 for(const row of dataset.modules())for(const [columns,rows]of [[1,1],[2,4],[8,1],[1,9],[9,2]])for(const model of ['C16L','C16H'])for(const type of ['75','320']){
  const controller=dataset.findProducts(model)[0],module={...row,interface:type==='75'?'HUB75':'HUB320'},val=value=>({value});
  const state={ReceiveCardWidth:val(1),modInformation:val({long:module.size[0]}),ModulePixelWidth:val(module.resolution[0]),IsC16L:val(model==='C16L'),IsC16X:val(true),PointSpacing:val(module.dotPitch.spacing),productCard:val(controller),receivingCard:val({interface:{type}})};
  const original=vm.runInNewContext('('+source.slice(start+3,end)+')',{...tables,Et:()=>state},{timeout:1000});assert.equal(c16CanDrive(controller,module,columns,rows),Boolean(original(columns,rows)),module.id+' '+model+' '+columns+'x'+rows+' '+type);checked++;
 }assert.equal(checked,900);
});
test('One-card C16 cabinet sharing replaces the last region without losing coverage or inventing an SSM',async()=>{
 const demand=requirement(),r=await app.dialogue(demand);assert.equal(r.status,'ready');assert.equal(r.bom[1].quantity,2);assert.equal(r.plan.builtInRegions.length,1);assert.equal(r.plan.builtInRegions[0].cabinetId,3);assert.ok(audit.ordering(r).automaticPassed);assert.equal((await app.exportSsm(demand)).status,'unsupported');
 const wrong=structuredClone(r);wrong.plan.builtInRegions[0].cabinetId=1;assert.equal(audit.ordering(wrong).automaticPassed,false);
 const missing=structuredClone(r);missing.plan.builtInRegions=[];assert.equal(audit.ordering(missing).automaticPassed,false);
 const only=requirement();only.cabinet.columns=1;const one=await app.dialogue(only);assert.equal(one.status,'ready');assert.equal(one.bom[1].quantity,0);assert.equal(one.plan.ports.length,0);assert.ok(audit.ordering(one).automaticPassed);
});
test('C16 missing, excess and ambiguous two-card reductions remain protected; explicit builtin direct works',async()=>{
 const missing=requirement();delete missing.cabinet;missing.screen={moduleColumns:3,moduleRows:4};assert.equal((await app.dialogue(missing)).status,'needs_input');
 const excess=requirement();excess.cabinet.moduleRows=9;assert.notEqual((await app.dialogue(excess)).status,'ready');
 const direct=requirement();delete direct.cabinet;direct.architecture='direct';direct.screen={moduleColumns:2,moduleRows:2};direct.providedDevices=[{modelId:'C16L'}];assert.equal((await app.dialogue(direct)).status,'ready');
 const module=dataset.modules().find(m=>m.id===2),controller=dataset.findProducts('C16L')[0];
 assert.ok(c16CanDrive(controller,module,1,8));assert.equal(sharedCabinet([{cabinetId:1},{cabinetId:1}],{moduleColumns:1,moduleRows:8,columns:1,rows:1},module,controller).reason,'official-two-card-c16-count-and-diagram-disagree');
});
test('Receiver chain order corresponds to every SSM port, and cross-port or missing links fail acceptance',async()=>{
 const r=await app.dialogue('配单P2.5 模组128x64 32扫 HUB75 全彩 室内 同步 接收卡 10宽10高');assert.equal(r.status,'ready');assert.equal(r.topology.connections.length,r.plan.cells.length);
 const exported=await app.exportSsm(r.normalizedDemand);assert.equal(exported.status,'ready');const grid=parseGrid(exported.gridXml);
 for(let i=0;i<r.plan.ports.length;i++){const port=r.plan.ports[i];assert.equal(grid.ports[i].cells.length,port.cells.length);for(let j=0;j<port.cells.length;j++){const cell=port.cells[j],actual=grid.ports[i].cells[j];assert.equal(actual.x+grid.ports[i].x,cell.col*r.plan.module.resolution[0]);assert.equal(actual.y+grid.ports[i].y,cell.row*r.plan.module.resolution[1]);}}
 const broken=structuredClone(r);broken.topology.connections[0].portId=99;assert.equal(audit.ordering(broken).automaticPassed,false);
});
test('Special width segmentation matches original mL.P; partial segments and excess do not become formal plans',async()=>{
 const start=source.indexOf('P=(_,b)=>',source.indexOf('function mL()')),end=source.indexOf(',O=(_,b)=>',start);assert.ok(start>0&&end>start);const module=dataset.modules().find(m=>m.id===10);
 for(const [model,columns,rows]of [['A5L',40,1],['A7',60,8],['A7',61,8]]){
  const controller=dataset.findProducts(model)[0],screen={columns,rows,pixelWidth:columns*module.resolution[0],pixelHeight:rows*module.resolution[1]},val=value=>({value}),Js=val([]);
  const original=vm.runInNewContext('('+source.slice(start+2,end)+')',{n:val({H4K:false}),t:[],o:val({pixel:{long:screen.pixelWidth,width:screen.pixelHeight}}),a:val(controller),d:val(columns),c:val(module.resolution[0]),h:val(false),e:655360,Js,ol:val([]),console:{log(){}}},{timeout:1000});assert.equal(original(controller,()=>{}),true);
  const result=analyzeSpecialCanvas(module,screen,controller);assert.equal(result.status,'candidate');assert.equal(result.nominalWidth,Js.value[0].width);assert.equal(result.count,Js.value[0].num);assert.equal(result.portsPerSegment,Js.value[0].networkPortNumber);assert.equal(result.segments.reduce((s,r)=>s+r.pixelWidth,0),screen.pixelWidth);assert.ok(result.segments.every(s=>s.portColumns.reduce((a,b)=>a+b,0)===s.moduleColumns));assert.equal(result.formalPlan,false);
 }
 const blocked=await app.dialogue('配单P2.5 模组128x64 32扫 HUB75 全彩 室内 异步 播放盒 接收卡 40宽1高 A5L');assert.equal(blocked.status,'unsupported');assert.ok(blocked.failures.some(f=>f.sourceAnalysis?.status==='candidate'));
 const over=analyzeSpecialCanvas(module,{columns:60,rows:100,pixelWidth:7680,pixelHeight:6400},dataset.findProducts('A7')[0]);assert.equal(over.status,'pending');
});
test('Playbox cascade checks declared count and multiplied load, but never fabricates a multi-device topology',async()=>{
 const demand=requirement();delete demand.cabinet;demand.screen={moduleColumns:10,moduleRows:10};demand.requirements={controllerFamily:'playBox',cascadeSplicing:{supportive:true,count:2}};demand.providedDevices=[{modelId:'B6L'}];
 const r=await app.dialogue(demand);assert.equal(r.status,'unsupported');assert.equal(r.plan,null);assert.equal(r.sourceAnalysis.eligibleModels[0].modelId,'B6L');assert.equal(r.sourceAnalysis.formalPlan,false);
 demand.providedDevices=[{modelId:'A5L'}];assert.equal((await app.dialogue(demand)).status,'no_feasible_plan');
 demand.providedDevices=[{modelId:'B6L'}];demand.requirements.cascadeSplicing.count=11;assert.equal((await app.dialogue(demand)).status,'no_feasible_plan');
 delete demand.requirements.cascadeSplicing.count;assert.equal((await app.dialogue(demand)).status,'needs_input');
});
