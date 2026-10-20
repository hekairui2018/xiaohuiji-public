'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createApp}=require('../app/bootstrap.cjs');
const {loadDataset}=require('../adapters/data/load-dataset.cjs');
const {createDataset}=require('../domain/data/dataset.cjs');
const {importSource}=require('../tools/import-source.cjs');
const {modelId}=require('../domain/identity/model-id.cjs');
const {evaluateRules}=require('../domain/rules/evaluator.cjs');
const {validate}=require('../contracts/validate.cjs');
const {parseInput}=require('../domain/parser/deterministic-parser.cjs');
const demandSchema=require('../contracts/demand.schema.json');
const dataset=loadDataset(),app=createApp({dataset});
const dataRoot=path.resolve(__dirname,'../data');
const manifest=JSON.parse(fs.readFileSync(path.join(dataRoot,'active-manifest.json'),'utf8'));
const sourceFile=path.join(dataRoot,'versions',manifest.versionId,'source.json');
const raw=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
test('Full imported source inventory and original checksum retained',()=>{
 assert.deepEqual(dataset.counts,{products:119,modules:45,receivers:5});assert.equal(dataset.source.sha256,manifest.originSHA256);
 assert.equal(dataset.unresolvedLabels().length,10);assert.equal(dataset.receivers()[1].source.symbol,'My');
});
test('Exact model identities keep suffixes, plus sign, and unknown labels apart',()=>{
 assert.notEqual(modelId('A3'),modelId('A3L'));assert.notEqual(modelId('VP620'),modelId('VP620A'));
 assert.notEqual(modelId('A30'),modelId('A30+'));assert.equal(modelId('{optional}'),null);
 assert.equal(dataset.findProducts('A30+')[0].model,'A30+');assert.equal(dataset.findProducts('VP620A')[0].model,'VP620A');
});
test('Static device inventory does not imply automatic selection or supply status',()=>{
 const result=app.quickLookup({modelId:'A3'});assert.equal(result.status,'found');assert.equal(dataset.findProducts('A3')[0].status,4);assert.equal(result.records[0].status,undefined);assert.equal(result.records[0].selectionRecords,undefined);
 assert.ok(!Object.hasOwn(result,'plan'));assert.ok(!Object.hasOwn(result,'recommendedController'));
});
test('Read model is immutable; callers cannot change retained facts',()=>{
 const rows=dataset.findProducts('VP620A');assert.throws(()=>{rows[0].totalPoints=1;});rows.length=0;
 assert.equal(dataset.findProducts('VP620A')[0].totalPoints,3932160);
});
test('Duplicate and unsupported source records fail closed',()=>{
 const copy=structuredClone(raw);copy.devices.push(copy.devices[0]);assert.throws(()=>createDataset(copy,'test'),/Duplicate source/);
 const bad=structuredClone(raw);bad.modules[0].source.sha256='0'.repeat(64);assert.throws(()=>createDataset(bad,'test'),/provenance/);
});
test('Importer is non-destructive and checksum loader detects tampering',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-v2-data-'));try{
  const m=importSource(sourceFile,dir);assert.deepEqual(loadDataset(dir).counts,dataset.counts);assert.throws(()=>importSource(sourceFile,dir),/already exists/);
  fs.appendFileSync(path.join(dir,'versions',m.versionId,'source.json'),' ');assert.throws(()=>loadDataset(dir),/checksum/);
 }finally{const resolved=path.resolve(dir),allowed=path.resolve(os.tmpdir())+path.sep;if(!resolved.startsWith(allowed))throw Error('Unsafe temporary cleanup path');fs.rmSync(resolved,{recursive:true,force:true});}
});
const rule=(when,effect={eligible:true})=>({ruleId:'test-rule',priority:1,when,effect,sourceReferences:[{symbol:'test',index:0}]});
const pathOperand=path=>({path}),literal=value=>({literal:value});
test('Unknown engineering conditions remain unknown',()=>{
 const when={op:'lte',args:[pathOperand('/width'),literal(4096)]};
 assert.equal(evaluateRules([rule(when)],{})[0].state,'unknown');assert.equal(evaluateRules([rule(when)],{width:null})[0].state,'unknown');
 assert.equal(evaluateRules([rule(when)],{width:4096})[0].state,'matched');assert.equal(evaluateRules([rule(when)],{width:4097})[0].state,'rejected');
});
test('Three-valued boolean rules preserve explicit true/false with missing facts',()=>{
 const unknown={op:'eq',args:[pathOperand('/missing'),literal(true)]};
 assert.equal(evaluateRules([rule({op:'all',args:[unknown,literal(false)]})],{})[0].state,'rejected');
 assert.equal(evaluateRules([rule({op:'any',args:[unknown,literal(true)]})],{})[0].state,'matched');
 assert.equal(evaluateRules([rule({op:'not',args:[unknown]})],{})[0].state,'unknown');
});
test('Unsourced rules, implicit numeric coercion and executable operators rejected',()=>{
 assert.throws(()=>evaluateRules([{...rule(literal(true)),sourceReferences:[]}],{}),/unsourced/);
 assert.throws(()=>evaluateRules([rule({op:'lte',args:[literal('10'),literal(20)]})],{}),/Numeric/);
 assert.throws(()=>evaluateRules([rule({op:'eval',args:[]})],{}),/Unsupported/);
 assert.throws(()=>evaluateRules([rule({op:'eq',args:[pathOperand('/__proto__'),literal(1)]})],{}),/Unsafe/);
});
test('Standard contracts reject zero/fractional geometry and route injection',()=>{
 assert.equal(validate(demandSchema,{schemaVersion:'2.0',operation:'ordering',screen:{moduleColumns:0}}).valid,false);
 assert.equal(validate(demandSchema,{schemaVersion:'2.0',operation:'ordering',screen:{pixelWidth:1.5}}).valid,false);
 assert.equal(validate(demandSchema,{schemaVersion:'2.0',operation:'knowledge'}).valid,false);
 assert.equal(validate(demandSchema,{schemaVersion:'2.0',operation:'ordering',selectedController:'VP620A'}).valid,false);
});
test('Quick lookup bypasses every dialogue handler',()=>{
 let count=0;const fail=()=>{count++;throw Error('Router must not run');};
 const isolated=createApp({dataset,handlers:{ordering:fail,aftersales:fail,consultation:fail}});
 assert.equal(isolated.quickLookup({modelId:'VP620A'}).status,'found');assert.equal(count,0);
 assert.equal(isolated.quickLookup({modelId:'VP620A',operation:'ordering'}).status,'invalid_request');
});
test('Dialogue routes only ordering, aftersales and consultation',async()=>{
 const calls=[];const handlers=Object.fromEntries(['ordering','aftersales','consultation'].map(op=>[op,()=>{calls.push(op);return {status:'unsupported'};}]));
 const routed=createApp({dataset,handlers});for(const operation of Object.keys(handlers))await routed.dialogue({schemaVersion:'2.0',operation});
 assert.deepEqual(calls,['ordering','aftersales','consultation']);
 assert.equal((await routed.dialogue({schemaVersion:'2.0',operation:'knowledge'})).status,'invalid_request');
});
test('Dialogue product consultation uses independent knowledge service',async()=>{
 const result=await app.dialogue({schemaVersion:'2.0',operation:'consultation',providedDevices:[{modelId:'VP620A'}]});
 assert.equal(result.status,'ready');assert.equal(result.knowledge.records[0].model,'VP620A');assert.equal(result.operation,'consultation');
});
test('Deterministic text parsing keeps product questions in consultation and faults ahead of ordering',()=>{
 assert.equal(parseInput('VP620A参数',dataset).demand.operation,'consultation');
 assert.equal(parseInput('VP620A花屏，配单后异常',dataset).demand.operation,'aftersales');
 assert.equal(parseInput('帮我配单 P2 整屏分辨率640×640 同步',dataset).demand.screen.pixelWidth,640);
 assert.equal(parseInput('A30+参数',dataset).demand.providedDevices[0].modelId,'HD-A30+');
});
test('No-AI standard and text entrypoints work without inventing unfinished plans',async()=>{
 assert.equal(app.health().aiEnabled,false);assert.equal((await app.dialogue('VP620A参数')).status,'ready');
 for(const operation of ['ordering','aftersales']){const r=await app.dialogue({schemaVersion:'2.0',operation});assert.equal(r.status,'unsupported');assert.equal(r.plan,null);}
});
test('A domain cannot label an unvalidated ordering plan ready',async()=>{
 const bad=createApp({dataset,handlers:{ordering:()=>({status:'ready',plan:{},validation:{passed:false}})}});
 await assert.rejects(bad.dialogue({schemaVersion:'2.0',operation:'ordering'}),/Unvalidated/);
});
