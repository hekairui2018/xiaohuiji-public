'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {createApp}=require('../app/bootstrap.cjs'),{loadDataset}=require('../adapters/data/load-dataset.cjs');
const {asyncCardFits}=require('../domain/ordering/async-card-rules.cjs');
const {validatePlan}=require('../domain/ordering/validator.cjs');
const {parseGrid}=require('../domain/ordering/output/ssm-codec.cjs');
const {createAcceptance}=require('../acceptance/index.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const dataset=loadDataset(),app=createApp(),audit=createAcceptance({dataset,knowledge:loadKnowledge()});
const demand=()=>({schemaVersion:'2.0',operation:'ordering',controlMode:'async',architecture:'direct',environment:'indoor',module:{pitchMm:2.5,pixelWidth:128,pixelHeight:64,scan:{numerator:1,denominator:32},interface:'HUB75',color:{r:1,g:1,b:1}},screen:{moduleColumns:2,moduleRows:2},requirements:{controllerFamily:'asyncCard'}});
test('D16/C08L conditions match the original JS across module pitches, dimensions and R500S exclusion',()=>{
 const bytes=fs.readFileSync('reference/official-selection-tool/official-selection-bundle.js');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),dataset.source.sha256);
 const source=bytes.toString(),start=source.indexOf('C=k=>{if(["D10"'),end=source.indexOf(';return{PublicFilterSendingCard',start);assert.ok(start>0&&end>start);
 let comparisons=0;for(const m of dataset.modules())for(const [columns,rows]of [[1,1],[2,2],[4,2],[8,1],[9,1]])for(const model of ['D16','C08L'])for(const receiver of ['', 'R500S']){
  const val=value=>({value}),screen={columns,rows,pixelWidth:columns*m.resolution[0],pixelHeight:rows*m.resolution[1]},device=dataset.findProducts(model)[0];
  const context={r:val(columns),i:val(rows),v:val(m.dotPitch.spacing),s:val(screen.pixelHeight),o:val(columns*m.size[0]),t:val({long:m.size[0],width:m.size[1]}),d:val({model:receiver}),console};
  const original=vm.runInNewContext('('+source.slice(start+2,end)+')',context,{timeout:1000});assert.equal(asyncCardFits(device,m,screen,receiver),original(device),m.id+' '+model+' '+columns+'x'+rows);comparisons++;
 }assert.equal(comparisons,900);
});
test('Direct normal and boundary plans have no fictitious receivers, ports or SSM',async()=>{
 const input=demand();input.providedDevices=[{modelId:'D16'}];const result=await app.dialogue(input);assert.equal(result.status,'ready');assert.equal(result.plan.directOutputs.length,4);assert.equal(result.bom.length,2);assert.equal(result.plan.cells.length,0);assert.equal(result.plan.ports.length,0);assert.ok(audit.ordering(result).automaticPassed);
 assert.equal((await app.exportSsm(input)).status,'unsupported');
 const larger=demand();larger.screen={moduleColumns:4,moduleRows:2};larger.providedDevices=[{modelId:'C08L'}];assert.equal((await app.dialogue(larger)).status,'ready');
 const invalid=structuredClone(result);invalid.plan.directOutputs[1]=structuredClone(invalid.plan.directOutputs[0]);assert.equal(audit.ordering(invalid).automaticPassed,false);
});
test('Direct missing, excess, contradictory hardware and unverified larger HUB layouts stay protected',async()=>{
 const missing=demand();delete missing.module.scan;assert.equal((await app.dialogue(missing)).status,'needs_input');
 const over=demand();over.screen={moduleColumns:5,moduleRows:2};over.providedDevices=[{modelId:'D16'}];assert.equal((await app.dialogue(over)).status,'no_feasible_plan');
 const receiver=demand();receiver.providedDevices=[{modelId:'D16'},{modelId:'R708'}];assert.equal((await app.dialogue(receiver)).status,'conflict');
 const geometry=demand();geometry.screen.pixelWidth=1;assert.equal((await app.dialogue(geometry)).status,'conflict');
 const c16=demand();c16.providedDevices=[{modelId:'C16L'}];assert.equal((await app.dialogue(c16)).status,'unsupported');
});
test('A3L async receiver selection, sound capability and loading limits use the source device',async()=>{
 const input=demand();input.architecture='receiver';input.screen={moduleColumns:8,moduleRows:4};input.providedDevices=[{modelId:'A3L'}];input.requirements.peripherals=['sound'];const r=await app.dialogue(input);assert.equal(r.status,'ready');assert.equal(r.plan.controller.model,'A3L');assert.ok(r.plan.ports.length===1);assert.equal((await app.exportSsm(input)).status,'ready');
 input.screen={moduleColumns:100,moduleRows:100};assert.equal((await app.dialogue(input)).status,'no_feasible_plan');
 const noSound=demand();noSound.providedDevices=[{modelId:'D16'}];noSound.requirements.peripherals=['sound'];assert.equal((await app.dialogue(noSound)).status,'no_feasible_plan');
});
test('Cabinet one/two-card partitions keep box boundaries, counts and SSM coordinates consistent',async()=>{
 for(const cabinet of [{moduleColumns:1,moduleRows:4,columns:3,rows:2},{moduleColumns:1,moduleRows:24,columns:2,rows:1}]){
  const input=demand();input.controlMode='sync';input.architecture='receiver';delete input.requirements;delete input.screen;input.cabinet=cabinet;input.providedDevices=[{modelId:'R712'}];const r=await app.dialogue(input);assert.equal(r.status,'ready');assert.ok(validatePlan(r.plan).passed);assert.ok(audit.ordering(r).automaticPassed);
  const perBox=Math.ceil(cabinet.moduleColumns*cabinet.moduleRows/(r.plan.receiver.width*r.plan.receiver.height));assert.equal(r.bom[1].quantity,perBox*cabinet.columns*cabinet.rows);
  const out=await app.exportSsm(input);assert.equal(out.status,'ready');assert.ok(out.acceptance.automaticPassed);assert.equal(parseGrid(out.gridXml).ports.flatMap(p=>p.cells).length,r.bom[1].quantity);assert.equal(out.metadata.hardwareDownloadVerified,false);
  const broken=structuredClone(r.plan);broken.cells[0].cabinetId=99;assert.ok(validatePlan(broken).errors.includes('cabinet-receiver-crosses-boundary'));
 }
});
test('Cabinet missing dimensions, conflicting total geometry and unsupported splits cannot become ready',async()=>{
 const input=demand();input.controlMode='sync';input.architecture='receiver';delete input.requirements;delete input.screen;input.cabinet={moduleColumns:1,moduleRows:4};assert.equal((await app.dialogue(input)).status,'needs_input');
 input.cabinet={moduleColumns:1,moduleRows:4,columns:2,rows:2};input.screen={moduleColumns:3,moduleRows:8};assert.equal((await app.dialogue(input)).status,'conflict');
 delete input.screen;input.cabinet={moduleColumns:2,moduleRows:4,columns:2,rows:2};input.providedDevices=[{modelId:'R712'}];assert.equal((await app.dialogue(input)).status,'unsupported');
 input.cabinet={moduleColumns:1,moduleRows:37,columns:1,rows:1};assert.equal((await app.dialogue(input)).status,'unsupported');
});
