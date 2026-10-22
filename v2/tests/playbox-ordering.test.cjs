'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {createApp}=require('../app/bootstrap.cjs');
const {loadDataset}=require('../adapters/data/load-dataset.cjs');
const {controllerCandidates}=require('../domain/ordering/controller-selector.cjs');
const {createDialogueService}=require('../adapters/http/dialogue-service.cjs');
const {parseGrid}=require('../domain/ordering/output/ssm-codec.cjs');
const {modelId}=require('../domain/identity/model-id.cjs');
const dataset=loadDataset(),app=createApp({dataset});
const base=()=>({schemaVersion:'2.0',operation:'ordering',controlMode:'async',architecture:'receiver',environment:'indoor',module:{pitchMm:2.5,pixelWidth:128,pixelHeight:64,scan:{numerator:1,denominator:32},interface:'HUB75',color:{r:1,g:1,b:1}},screen:{moduleColumns:10,moduleRows:10},requirements:{controllerFamily:'playBox'}});
// Execute only the official filter closure, in an isolated context with source tables.
// This is a test oracle, never imported by the V2 business implementation.
function officialCandidates(screen,requirements,family){
 const bytes=fs.readFileSync('reference/official-selection-tool/official-selection-bundle.js');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),dataset.source.sha256);
 const source=bytes.toString(),start=source.indexOf('dL=()=>'),end=source.indexOf(',fL=',start);assert.ok(start>0&&end>start);
 const value=v=>({value:v});const scene={H4K:false,hdmiOut:false,posterScreen:false,meetingScreen:false,cascadeSplicing:{supportive:false},peripherals:[],inputSource:[],...requirements};
 scene.peripherals=(requirements.peripherals||[]).map(key=>({key}));scene.inputSource=(requirements.inputSource||[]).map(name=>({name}));
 const state={PixelLong:value(screen.pixelWidth),PixelWidth:value(screen.pixelHeight),scene:value(scene),drawFail:value([]),div:value({update:false}),modInformation:value({}),receivingCard:value({})};
 const sandbox={Jo:()=>({initDiv(){}}),Et:()=>state,ol:value([]),Fy:dataset.devices().filter(d=>d.source.symbol==='Fy'),By:dataset.devices().filter(d=>d.source.symbol==='By'),console:{log(){},error(){}}};
 const fn=vm.runInNewContext('('+source.slice(start+3,end)+')',sandbox,{timeout:1000})();
 fn[family==='playBox'?'ComputePlayBoxFilterRules':'ComputeProcessFilterRules']();
 return [...new Set(state.div.value.cards.map(d=>d.model))];
}
test('Playbox and processor choices match the frozen official filter for supported features',()=>{
 const screen={pixelWidth:1280,pixelHeight:640,points:819200};
 for(const requirements of [{controllerFamily:'playBox'},{controllerFamily:'playBox',hdmiOut:true},{controllerFamily:'playBox',posterScreen:true},{controllerFamily:'playBox',meetingScreen:true},{controllerFamily:'playBox',peripherals:['sound']},{inputSource:['HDMI'],dockingCentralControl:true},{ktvRecommended:true}]){
  const family=requirements.controllerFamily||'processor',demand={...base(),controlMode:family==='processor'?'sync':'async',requirements};
  const result=controllerCandidates(demand,screen,dataset),actual=result.controllers?.map(d=>d.model)||[];
  const official=officialCandidates(screen,requirements,family),unresolved=official.filter(id=>!modelId(id));
  // The official table contains translated optional-card placeholders, not actual model IDs.
  assert.ok(unresolved.every(id=>['VP1620S_{optional}','VP1640A_{optional}'].includes(id)));
  assert.deepEqual(actual,official.filter(id=>modelId(id)));assert.ok(actual.every(id=>!id.includes('{')));
 }
});
test('Explicit async playback produces source-backed BOM, ports, topology and matching SSM grid',async()=>{
 const result=await app.dialogue(base());assert.equal(result.status,'ready');assert.equal(result.plan.controller.category,'同步异步播放盒');assert.equal(result.plan.controller.model,'A5L');
 assert.equal(result.bom[2].modelId,'HD-A5L');assert.equal(result.bom[1].quantity,result.plan.cells.length);
 assert.equal(result.plan.ports.flatMap(p=>p.cells).length,result.topology.receivers.length);
 const exported=await app.exportSsm(base());assert.equal(exported.status,'ready');assert.ok(exported.acceptance.automaticPassed);
 const grid=parseGrid(exported.gridXml);assert.equal(grid.ports.length,result.plan.ports.length);assert.equal(grid.ports.flatMap(p=>p.cells).length,result.bom[1].quantity);assert.equal(exported.metadata.hardwareDownloadVerified,false);
});
test('Poster, meeting and HDMI requirements select eligible hardware rather than ignoring features',async()=>{
 for(const [feature,models]of [['posterScreen',['B6L','A6L','B8L']],['meetingScreen',['H6','H8']]]){const demand=base();demand.requirements[feature]=true;const result=await app.dialogue(demand);assert.equal(result.status,'ready');assert.ok(models.includes(result.plan.controller.model));}
 const hdmi=base();hdmi.requirements.hdmiOut=true;const supported=await app.dialogue(hdmi);assert.equal(supported.status,'ready');assert.equal(supported.plan.controller.hdmiOut,true);
 hdmi.providedDevices=[{modelId:'A5L'}];assert.equal((await app.dialogue(hdmi)).status,'no_feasible_plan');
});
test('Unimplemented direct, special canvas and cascading do not yield a normal plan',async()=>{
 const direct=base();direct.architecture='direct';assert.equal((await app.dialogue(direct)).status,'unsupported');
 const cascade=base();cascade.requirements.cascadeSplicing={count:2};assert.equal((await app.dialogue(cascade)).status,'unsupported');
 const wide=base();wide.screen={moduleColumns:40,moduleRows:1};wide.providedDevices=[{modelId:'A5L'}];const result=await app.dialogue(wide);assert.equal(result.status,'needs_input');assert.equal(result.exportAllowed,false);assert.equal(result.plan.specialCanvas.raw.failed,false);assert.ok(result.hdsetSvg);
 const malformed=base();malformed.requirements.hdmiOut='true';assert.equal((await app.dialogue(malformed)).status,'needs_input');
});
test('No-AI dialogue gathers explicit playback mode across turns and keeps quick separate',async()=>{
 const chat=createDialogueService(app),sessionId='playbox';await chat({sessionId,message:'配单P2.5'});
 const result=await chat({sessionId,message:'播放盒，异步，接收卡，室内，全彩，模组128x64，32扫，HUB75，10宽10高，需要HDMI输出'});
 assert.equal(result.result.status,'ready');assert.equal(result.result.plan.controller.hdmiOut,true);assert.equal(result.result.plan.controller.category,'同步异步播放盒');
 const negated=app.understandInput('配单 不要HDMI输出，不用播放盒，不是广告屏，不做会议屏').demand;assert.ok(!negated.requirements?.hdmiOut);assert.ok(!negated.requirements?.controllerFamily);assert.ok(!negated.requirements?.posterScreen);assert.ok(!negated.requirements?.meetingScreen);
 assert.ok(app.quickSearch('A5L').records.length);
});
