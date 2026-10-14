'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs');
const {loadDataset}=require('../adapters/data/load-dataset.cjs');
const {validatePlan}=require('../domain/ordering/validator.cjs');
const dataset=loadDataset(),app=createApp({dataset});
const requirement=m=>({schemaVersion:'2.0',operation:'ordering',architecture:'receiver',controlMode:'sync',environment:m.indoor?'indoor':'outdoor',module:{pitchMm:m.dotPitch.spacing,pixelWidth:m.resolution[0],pixelHeight:m.resolution[1],scan:{numerator:1,denominator:Number(m.scanningMethod.replace('S',''))},interface:m.interface,color:{r:m.color.R||0,g:m.color.G||0,b:m.color.B||0}},screen:{moduleColumns:10,moduleRows:10}});
const testModule=dataset.modules().find(m=>m.dotPitch.spacing===2.5&&m.interface==='HUB75'&&m.indoor);
test('Real module yields independently validated controller/card/port/BOM/SVG without legacy engine',async()=>{
 const result=await app.dialogue(requirement(testModule));assert.equal(result.status,'ready');assert.ok(result.validation.passed);
 assert.equal(result.bom[0].quantity,100);assert.equal(result.bom[1].quantity,result.plan.cells.length);assert.equal(result.bom[2].quantity,1);
 assert.ok(result.sourceReferences.every(s=>s.sha256===dataset.source.sha256));assert.ok(result.topologySvg.startsWith('<svg'));
 assert.equal(result.plan.cells.reduce((sum,c)=>sum+c.columns*c.rows,0),100);
 assert.ok(![3,4,5].includes(result.plan.controller.status));assert.ok(result.plan.ports.every(p=>p.points<=655360));
});
test('Missing scan stays unknown rather than being filled from catalog',async()=>{
 const input=requirement(testModule);delete input.module.scan;assert.equal((await app.dialogue(input)).status,'needs_input');
});
test('Conflicting explicit geometry cannot produce a plan',async()=>{
 const input=requirement(testModule);input.screen.pixelWidth=1;assert.equal((await app.dialogue(input)).status,'conflict');
 const physical=requirement(testModule);physical.screen.physicalWidthMm=1;assert.equal((await app.dialogue(physical)).status,'conflict');
});
test('Special features and async architecture are not falsely supported',async()=>{
 const input=requirement(testModule);input.requirements={portBackup:true};assert.equal((await app.dialogue(input)).status,'unsupported');
 const asyncInput=requirement(testModule);asyncInput.controlMode='async';assert.equal((await app.dialogue(asyncInput)).status,'unsupported');
});
test('Unknown provided hardware and unverified revisions cannot be silently replaced',async()=>{
 const input=requirement(testModule);input.providedDevices=[{modelId:'VP99999'}];assert.equal((await app.dialogue(input)).status,'needs_input');
 input.providedDevices=[{modelId:'VP620A',revisionId:'E99'}];assert.equal((await app.dialogue(input)).status,'needs_input');
});
test('Unresolved R708 disputed loading remains blocked while normal R708 operation is retained',async()=>{
 const input=requirement(dataset.modules().find(m=>m.dotPitch.spacing===1.25&&m.interface==='HUB75'));input.providedDevices=[{modelId:'R708'}];const result=await app.dialogue(input);assert.notEqual(result.status,'ready');assert.ok(result.failures.every(f=>f.reason==='unresolved-receiver-source-conflict'));
 const normal=requirement(testModule);normal.providedDevices=[{modelId:'R708'}];const ready=await app.dialogue(normal);assert.equal(ready.status,'ready');assert.equal(ready.plan.receiver.model,'R708');
});
test('R708 larger confirmed-PWM common profile cannot be assumed for an unknown or conventional driver',async()=>{
 const input=requirement(dataset.modules().find(m=>m.dotPitch.spacing===1.25&&m.interface==='HUB75'));input.screen={moduleColumns:1,moduleRows:1};input.providedDevices=[{modelId:'R708'}];
 assert.equal((await app.dialogue(input)).status,'needs_input');input.module.driverFamily='conventional';assert.notEqual((await app.dialogue(input)).status,'ready');
 input.module.driverFamily='pwm';assert.equal((await app.dialogue(input)).status,'ready');
});
test('Independent validator catches duplicate coverage and corrupted port area',async()=>{
 const result=await app.dialogue(requirement(testModule));const broken=structuredClone(result.plan);broken.cells.push(broken.cells[0]);assert.equal(validatePlan(broken).passed,false);
 const port=structuredClone(result.plan);port.ports[0].points=1;assert.ok(validatePlan(port).errors.includes('port-bounding-geometry'));
});
test('Independent dataset-wide small rectangular sample never violates returned ready plans',async()=>{
 let ready=0;for(const m of dataset.modules().filter(m=>m.color.R===1&&m.color.G===1&&m.color.B===1&&m.interface==='HUB75')){
  const result=await app.dialogue(requirement(m));if(result.status==='ready'){ready++;assert.ok(validatePlan(result.plan).passed);assert.equal(result.plan.screen.points,result.plan.screen.pixelWidth*result.plan.screen.pixelHeight);}
 }assert.ok(ready>10);console.log('source-backed rectangular module samples ready: '+ready);
});
