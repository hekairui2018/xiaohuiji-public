'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
const hash='a'.repeat(64),unitId='b'.repeat(64);
const products=['HD-R712','HD-R716','HD-R512S'].map(modelId=>({modelId}));
const knowledge={products:()=>products,findProducts:id=>products.filter(p=>p.modelId===id)};
const empty=async()=>({results:[]});
const unit={id:unitId,kind:'parameter',sourceSpans:[{blockId:11,start:0,end:24,textHash:'c'.repeat(64)}],complete:true,boundaryBasis:'native-page'};
function api(options={}){return createQuickRetrieval({knowledge,search:empty,...options});}

test('A numeric parameter request never promotes a matching fault passage or a FAQ remedy to product specifications',async()=>{
 // Constructed negative fixtures; no customer case text or historical remedy.
 const rows=[
  {name:'合成显示故障问题总结.docx',text:'合成现场：R712测试画面出现条纹和灰阶缺失，修改gamma为1.1仍未恢复',locator:{paragraph:7}},
  {name:'合成R712常见问题FAQ.csv',text:'合成记录 | R712灰阶多少 | 解决方法：升级R712固件V1.2.3.4，使用1.2.3.4软件。',locator:{row:2}},
  {name:'合成R712规格书.pdf',text:'合成样例：灰阶缺失现象，修改gamma为1.1，升级R712固件。',locator:{page:3}}
 ];
 const r=await api({search:async()=>({results:rows})}).answer('R712灰阶多少');
 assert.equal(r.answerType,'insufficient-evidence');assert.doesNotMatch(r.reply,/合成现场|条纹|gamma|1\.2\.3\.4|解决方法/);
 assert.ok(r.results.every(row=>row.type!=='faq'&&!/问题总结/.test(row.name)));
});

test('Parameter retrieval requests the parameter role with exact models and reads source spans before answering',async()=>{
 const calls=[],candidate={name:'HD-R712规格书 V3.1.pdf',sha256:hash,blockId:11,unitId,knowledgeUnit:unit,role:'parameter',text:'灰度等级 支持256~65536级',locator:{page:3}};
 const r=await api({searchContext:async args=>{calls.push(args);return [candidate];},readContext:async row=>{assert.equal(row.unitId,unitId);return {text:'二、参数表\n灰度等级 支持256~65536级\n接口 2个千兆网口，12组HUB75E\n工作功率5瓦特',knowledgeUnit:unit,contextComplete:true};}}).answer('R712灰阶多少');
 assert.equal(calls[0].role,'parameter');assert.deepEqual(calls[0].models,['R712']);assert.deepEqual(calls[0].concepts,['灰度等级']);assert.equal(Object.hasOwn(calls[0],'documents'),false);
 assert.equal(r.answerType,'parameter-answer');assert.match(r.reply,/灰度等级 支持256~65536级/);assert.match(r.reply,/V3\.1/);assert.doesNotMatch(r.reply,/工作功率|HUB75E/);
 assert.deepEqual(r.results[0].knowledgeUnit.sourceSpans,unit.sourceSpans);assert.equal(r.results[0].contextComplete,true);assert.equal(r.modelCallCount,0);
});

test('Role metadata cannot turn another model or an operation unit into the requested product parameter',async()=>{
 const candidates=[{name:'HD-R716规格书.pdf',role:'parameter',knowledgeUnit:unit,text:'灰度等级65536级'}, {name:'HD-R712操作手册.pdf',role:'operation',knowledgeUnit:{...unit,kind:'operation'},text:'升级固件V25可解决灰阶问题'}];let read=0;
 const r=await api({searchContext:async()=>candidates,readContext:async row=>{read++;return {text:row.text,knowledgeUnit:row.knowledgeUnit};}}).answer('R712灰阶多少');
 assert.equal(read,1);assert.equal(r.answerType,'insufficient-evidence');assert.doesNotMatch(r.reply,/65536|V25/);
});

test('A legacy specification fallback retains field evidence while refusing disconnected or broken numeric values',async()=>{
 for(const text of ['灰度等级 支持2 56~65536级','灰度等级\n软件版本1.2.3.4']){
  const r=await api({search:async()=>({results:[{name:'HD-R712规格书.pdf',text,locator:{page:3}}]})}).answer('R712灰阶多少');
  assert.equal(r.answerType,'insufficient-evidence');assert.doesNotMatch(r.reply,/2 56|1\.2\.3\.4|为256/);
 }
 const r=await api({search:async()=>({results:[{name:'HD-R712规格书.pdf',text:'接口 12组HUB75E\n灰度等级 支持256~65536级\n工作功率5瓦特',locator:{page:3}}]})}).answer('R712灰阶多少');
 assert.equal(r.answerType,'parameter-answer');assert.match(r.reply,/256~65536级/);assert.doesNotMatch(r.reply,/工作功率|HUB75E/);
});

test('A source unit read failure cannot be replaced by its unverified search snippet',async()=>{
 const r=await api({searchContext:async()=>[{name:'HD-R712规格书.pdf',role:'parameter',knowledgeUnit:unit,text:'灰度等级65536级'}],readContext:async()=>{throw Error('source changed');}}).answer('R712灰阶多少');
 assert.notEqual(r.answerType,'parameter-answer');assert.doesNotMatch(r.reply,/65536/);assert.ok(r.sourceFailures.includes('parameter-original-context'));
});

test('Physical dimensions do not include resolution, and pixel/load values retain their own source condition',async()=>{
 const originalDocuments=[{document:{name:'HD-R712规格书.pdf',sha256:hash,pages:[{page:3,text:'板卡尺寸160×100mm\n最大单卡带载512×512像素\n注：实际带载与接口数、模组分辨率有关'}]}}];
 const client=api({originalDocuments,resolveDocuments:async rows=>rows.map(()=>({available:true,url:'/original'}))});
 const physical=await client.answer('R712板卡尺寸多大');assert.match(physical.reply,/160×100mm/);assert.doesNotMatch(physical.reply,/512×512像素/);
 const pixels=await client.answer('R712分辨率最大多少');assert.match(pixels.reply,/512×512像素/);assert.match(pixels.reply,/条件：注：实际带载/);assert.doesNotMatch(pixels.reply,/160×100mm/);
});

test('A chapter number and a revision date are never physical dimensions; a network-port count cannot borrow a power connector number',async()=>{
 const search=async()=>({results:[{name:'HD-R712 Specification V3.1.pdf',text:'4. Dimensions\nV3.1 Apr. 29, 2025 Update product images and size drawings.\nV2.1 Sept. 20, 2023 Update dimensions and content layout.',locator:{page:2}},{name:'HD-R712规格书.pdf',text:'电源输入接口 1\n板载12个标准HUB75E接口，最大控制26万像素\n接口 2个千兆网口，12组HUB75E接口',locator:{page:3}}]});
 const dimensions=await api({search}).answer('R712板卡尺寸多大');assert.equal(dimensions.answerType,'insufficient-evidence');assert.doesNotMatch(dimensions.reply,/Dimensions|2025|2023/);
 const ports=await api({search}).answer('R712网口数量');assert.equal(ports.answerType,'parameter-answer');assert.match(ports.reply,/2个千兆网口/);assert.doesNotMatch(ports.reply,/电源输入接口|26万像素/);
});
