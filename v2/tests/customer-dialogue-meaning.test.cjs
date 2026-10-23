'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs'),{createQuickAnswer}=require('../adapters/http/quick-answer.cjs');
const {parseOrderingFields}=require('../domain/parser/ordering-fields.cjs');
const {diagnosticContext}=require('../domain/parser/customer-language.cjs');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const {answerPlan}=require('../domain/knowledge/answer-plan.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge});
function conversation(){
 const search=async()=>({results:[]}),business=createQuickAnswer({app,knowledge,search,searchCases:search});
 const retrieval=createQuickRetrieval({app,knowledge,search,searchCases:search,businessAnswer:business.answer});
 const state={id:'spoken-meaning',retrievalHistory:[]};
 return async message=>{const r=await retrieval.answer(message,{state});state.taskState=r.quickContext.taskState;state.retrievalHistory.push({quickContext:r.quickContext});return r;};
}
for(const [message,columns,rows,mode]of [
 ['P2室内同步屏，横排十二块模组，纵排七块，按常规配',12,7,'sync'],
 ['P2.5室内异步，模组横向排了12块，竖向摆了8块，按常规配',12,8,'async'],
 ['配P2室内同步屏，每排10张模组，总共6排，其他按常规',10,6,'sync'],
 ['P2室内屏，模组宽12块高8块，要复制电脑画面，先按常规配',12,8,'sync'],
 ['P2.5模组10列4行，室内的，节目传进去断网也继续播，按常规配',10,4,'async']
])test('Complete engineering conditions survive the request phrasing: '+message,async()=>{
 const r=await conversation()(message),task=r.quickContext.taskState.tasks.find(t=>t.id===r.quickContext.taskState.activeId);
 assert.equal(r.result.planningStatus,'conditional');assert.equal(r.result.plan.screen.columns,columns);assert.equal(r.result.plan.screen.rows,rows);assert.equal(task.ordering.confirmed.controlMode,mode);assert.equal(r.modelCallCount,0);
});
test('Relative grid, pixel and physical changes each use an explicitly known unit and invalidate the old plan',async()=>{
 for(const [seed,change,expected]of [
  ['P2室内同步，模组12列8行，按常规配','宽再减两块，高不动',{columns:10,rows:8}],
  ['P2室内同步，整屏1280×640像素，按常规配','宽增加640像素，高不动',{pixelWidth:1920,pixelHeight:640}],
  ['P2室内同步，整屏宽3.2米高1.6米，按常规配','宽增加0.64米，高不变',{pixelWidth:1920,pixelHeight:800}],
  ['P2室内同步，整屏1280×640像素，按常规配','屏幕宽度改成1920像素，高不变',{pixelWidth:1920,pixelHeight:640}]
 ]){const say=conversation();await say(seed);const r=await say(change);assert.equal(r.result.planningStatus,'conditional');for(const [key,value]of Object.entries(expected))assert.equal(r.result.plan.screen[key],value);}
 const say=conversation();await say('配P2室内同步屏，其他按常规');const r=await say('宽加两块');assert.equal(r.status,'clarify');assert.ok(!r.result?.plan);assert.match(r.reply,/原值|新.*宽/);
});
test('Bare units stay unresolved, parameter selection principles stay parameter questions, and model IDs stay literal',async()=>{
 const r=await conversation()('P2室内同步，宽12高8，其他按常规');assert.equal(r.status,'clarify');assert.ok(!r.result?.plan);
 const parameter=await conversation()('R712接受卡能代栽多少点？实际选型要注意哪些条件？');assert.equal(parameter.intent,'parameters');assert.ok(!parameter.result?.plan);
 assert.equal(parseOrderingFields('R7I2 V1.2 模组宽十二块高八块').screen.moduleColumns,12);
 const {spokenGeometry}=require('../domain/parser/customer-meaning.cjs');assert.match(spokenGeometry('R7I2 R712S V1.2.3'),/^R7I2 R712S V1.2.3$/);
});
test('An absent external receiver does not erase explicitly confirmed direct wiring or turn reseating into an exchange',()=>{
 const state={messages:[],diagnosticState:diagnosticContext('C16L右边几行发绿还闪，节目发成功了，昨天换过一块模组。',{}, {hintIntent:'aftersales',models:['HD-C16L']})};
 const d=diagnosticContext('C16L直接接模组，没有外接接收卡。排线拔了重插没变化，没有拿正常备件替换过，下一步先查什么？',state,{hintIntent:'technical',models:['HD-C16L']});
 assert.equal(d.topology,'controller-direct-to-module');assert.equal(d.requiresTopology,false);assert.equal(d.symptomDomain,'screen-display');assert.equal(d.reseated,true);assert.equal(d.exchanged,false);
});
test('The prepared question plan reads the approved passage before one model answer, without a retrieval decision loop',async()=>{
 const tools=[],modelRequests=[];
 const transport=async(url,options={})=>{const pathname=new URL(url).pathname;
  if(pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'qwen3.8-test'}]})};
  if(pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:16384}})};
  if(pathname==='/tokenize')return {ok:true,json:async()=>({tokens:[1,2,3]})};
  assert.equal(pathname,'/v1/chat/completions');modelRequests.push(JSON.parse(options.body));
  return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'answer',claims:[{text:'R712最大带载26万点。',evidenceIds:['read-r712']}],generalAdvice:[],question:''})}}]})};
 };
 const expert=createEvidenceExpert({transport,autoReadCandidates:2});
 const result=await expert.answer({message:'R712带载多少',route:{intent:'technical',models:['HD-R712']},responsePlan:{purpose:'parameters',search:{action:'search',query:'R712 带载',kind:'products',documents:['R712规格书.pdf']}},execute:async(name,args)=>{
  tools.push({name,args});if(name==='search_evidence')return {evidence:[{evidenceId:'candidate',name:'R712规格书.pdf',blockId:17,text:'带载候选',readAvailable:true}]};
  assert.equal(name,'read_document');assert.equal(args.blockId,17);return {evidence:[{evidenceId:'read-r712',name:'R712规格书.pdf',text:'R712最大带载26万点。',readPerformed:true,readAvailable:false,nextOffset:null,modelIds:['HD-R712']}]};
 }});
 assert.equal(result.status,'answer');assert.equal(result.modelCallCount,1);assert.deepEqual(tools.map(t=>t.name),['search_evidence','read_document']);assert.match(result.reply,/26万点/);assert.equal(modelRequests.length,1);
 const input=JSON.parse(modelRequests[0].messages[1].content);assert.equal(input.preparedEvidence.evidence.length,1);assert.equal(input.preparedEvidence.evidence[0].readPerformed,true);
});
test('Compatibility and uncertain identities do not prefetch close-model parameters or firmware',()=>{
 const q={original:'R512S能直接刷R712固件吗',intent:'compatibility'};assert.equal(answerPlan(q).search,null);
 assert.equal(answerPlan({original:'照片型号看不清，像R7I2，也可能R712S，按R712给我固件',intent:'resources'}).identityUncertain,true);
});
test('Parameter tables with limits outrank a product overview and signed duplicates do not hide a second edition',()=>{
 const {rankAnswerEvidence}=require('../domain/knowledge/answer-evidence.cjs');
 const rows=[
  {name:'R716 V1.1.pdf',text:'概述\n最大可控制32万像素，具有强大带载能力。'},
  {name:'R716 V1.1.pdf',text:'参数表\n最大带载：32万点\n带载范围 常规芯片160×1024\n注：实际带载与接口数有关'},
  {name:'R716 V1.1_已签章.pdf',text:'参数表\n最大带载：32万点\n带载范围 常规芯片160×1024\n注：实际带载与接口数有关'},
  {name:'R716 V1.0.pdf',text:'参数表\n最大带载：32万点\n带载范围 常规芯片160×1024\n注：实际带载与模组分辨率有关'}
 ];
 const result=rankAnswerEvidence(rows,{intent:'parameters',attributes:['load'],question:'资料版本不同就分别告诉我'});
 assert.match(result[0].text,/参数表/);assert.equal(result[0].name,'R716 V1.1.pdf');assert.equal(result[1].name,'R716 V1.0.pdf');assert.equal(result.length,2);
});
test('A follow-up in the same sentence cannot turn an explicit program-writing operation into an unrelated software feature',async()=>{
 const r=await conversation()('HDPlayer做好节目，怎样通过U盘存到控制卡里，存完能拔吗');
 assert.equal(r.intent,'operation');assert.equal(r.queryPlan.operation.sendProgram,true);assert.ok(r.queryPlan.evidencePlan.terms.includes('节目更新'));
 const {describedControlMode}=require('../domain/parser/customer-meaning.cjs');assert.equal(describedControlMode('不需要复制电脑画面，节目发进去自己播放'),'async');assert.equal(describedControlMode('不要脱机播放'),null);
});
test('A software manual request excludes its installer while a screen fault cannot use an indicator lamp as its evidence',async()=>{
 const manual=await conversation()('找HDPlayer的使用手册');assert.ok(manual.queryPlan.categories.includes('manual'));assert.ok(!manual.queryPlan.categories.includes('software'));
 const {rank}=require('../adapters/http/quick-retrieval.cjs');
 const q={intent:'aftersales',original:'C16L右边几排发绿还闪',models:[],unknownModels:[],chips:[],versions:[],software:[],attributes:[],symptoms:['flicker','color'],concepts:['flicker','color'],categories:[],decision:{},evidencePlan:{scenario:{media:[],deniedMedia:[],knownNormal:[],tasks:[],phases:[],scope:['local'],exclusions:[]}},resourceConstraints:{}};
 const rejected={};const rows=rank(q,[{source:'text',rows:[{type:'passage',name:'C16L规格书.pdf',text:'RUN系统运行灯：绿灯闪烁表示正常。GPS指示灯：绿灯闪烁表示信号不佳。'}]}],{findProducts:()=>[],softwareItems:()=>[]},rejected);
 assert.equal(rows.length,0);assert.equal(rejected['indicator-not-screen-symptom'],1);
});
