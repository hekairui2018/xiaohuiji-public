'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs');
const {createDialogueService}=require('../adapters/http/dialogue-service.cjs');
const app=createApp(),details='模组128x64，32扫，HUB75，全彩，室内，同步，接收卡，10宽10高';
test('Natural customer parameters produce the same engineering result as independent standard JSON without AI',async()=>{
 const natural=await app.dialogue('帮我配单 P2.5 '+details);const standard=await app.dialogue({schemaVersion:'2.0',operation:'ordering',module:{pitchMm:2.5,pixelWidth:128,pixelHeight:64,scan:{numerator:1,denominator:32},interface:'HUB75',color:{r:1,g:1,b:1}},screen:{moduleColumns:10,moduleRows:10},environment:'indoor',controlMode:'sync',architecture:'receiver'});
 assert.equal(natural.status,'ready');assert.deepEqual(natural.bom,standard.bom);assert.deepEqual(natural.topology,standard.topology);
});
test('Missing parameters are gathered over multiple turns without choosing unstated module properties',async()=>{
 const chat=createDialogueService(app),sessionId='normal-order';let r=await chat({sessionId,message:'帮我配单P2.5'});assert.equal(r.status,'clarify');assert.ok(!r.result.normalizedDemand.module.scan);
 r=await chat({sessionId,message:details});assert.equal(r.status,'answer');assert.equal(r.result.bom[0].quantity,100);assert.equal(r.result.normalizedDemand.module.pitchMm,2.5);
 const other=await chat({sessionId:'other',message:details});assert.notEqual(other.result.status,'ready');
});
test('Faults and product questions during parameter gathering keep their own dialogue route',async()=>{
 const chat=createDialogueService(app),sessionId='mixed';await chat({sessionId,message:'帮我配单P2.5'});
 const product=await chat({sessionId,message:'R708参数'});assert.equal(product.result.operation,'consultation');assert.equal(product.status,'answer');
 await chat({sessionId,message:'帮我配单P2.5'});const fault=await chat({sessionId,message:'R708黑屏'});assert.equal(fault.result.operation,'aftersales');
});
test('Physical metres, unusual scan fractions, and ambiguous environments are not silently guessed',()=>{
 const d=app.understandInput('配单P2.5 宽10米高8米，模组128x64，2/32扫，室内室外').demand;
 assert.ok(!d.screen?.moduleColumns);assert.deepEqual(d.module.scan,{numerator:2,denominator:32});assert.ok(!d.environment);
 const variant=app.understandInput('MS4000 Pro参数').demand;assert.equal(variant.providedDevices[0].modelId,'HD-MS4000PRO');
 const lcd=app.understandInput('133MC参数').demand;assert.equal(lcd.providedDevices[0].modelId,'HD-133MC');
 const negated=app.understandInput('配单 P2.5 不是全彩，不是PWM，是常规芯片').demand;assert.ok(!negated.module.color);assert.ok(!negated.module.driverFamily);
});
