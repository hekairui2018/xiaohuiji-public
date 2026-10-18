'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs');
const {createExpertOrdering}=require('../adapters/http/expert-ordering.cjs');
const {retrievalDirections}=require('../model-adapter/retrieval-scope-map.cjs');
const q='一块LED屏，室内全彩，P2.5，模组128x64，32扫，HUB75，10宽10高，异步播放盒加接收卡，需要HDMI输出。';
test('Eight directions overlap and offer tools without assigning an exclusive intent',()=>{
 assert.equal(retrievalDirections.length,8);assert.ok(retrievalDirections.filter(d=>d.preferredScopes.includes('text')).length>5);assert.ok(!retrievalDirections.some(d=>'keywords' in d||'pattern' in d));
});
test('Expert invokes the existing validated solver with actual quoted conditions and source-backed arithmetic',async()=>{
 const tool=createExpertOrdering({app:createApp(),userMessages:[q]});const result=await tool({userQuotes:[q]});const e=JSON.parse(result.evidence[0].text);
 assert.equal(e.status,'ready');assert.equal(e.screen.points,819200);assert.equal(e.screen.pixelWidth,1280);assert.equal(e.screen.pixelHeight,640);assert.equal(e.controller.hdmiOut,true);assert.ok(e.controller.totalPoints>=819200);assert.equal(e.bom.find(b=>b.kind==='controller').quantity,1);assert.equal(e.validation.passed,true);assert.ok(e.sourceReferences.every(r=>r.sha256));assert.equal(result.evidence[0].compatibilityConfirmed,false);
 await assert.rejects(()=>tool({userQuotes:[q.replace('10宽','100宽')]}),/invalid-tool/);
});
test('Missing physical conditions and multiple screens do not silently receive a single-screen plan',async()=>{
 const app=createApp();for(const message of ['一块LED屏，P2.5，10宽10高',q.replace('一块LED屏','两块LED屏'),q.replace('一块LED屏，',''),q.replace('HDMI输出','DVI输出'),q+'另有一块LED屏']){
  const r=await createExpertOrdering({app,userMessages:[message]})({userQuotes:[message]});const s=JSON.parse(r.evidence[0].text);assert.notEqual(s.status,'ready');assert.equal(s.bom,undefined);
 }
});
test('A model-selected calculator round is executed and its complete result remains citable',async()=>{
 const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');let turn=0;const tool=createExpertOrdering({app:createApp(),userMessages:[q]});let evidence;
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  const req=JSON.parse(options.body);if(turn)assert.match(JSON.stringify(req.messages),/sourceReferences/);
  const action=turn++?{action:'answer',claims:[{text:'计算整屏1280×640，共819,200像素。',evidenceIds:[evidence.evidenceId]}],generalAdvice:[],question:''}:{action:'calculate',userQuotes:[q]};return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(action)},finish_reason:'stop'}]})};
 }});
 const r=await expert.answer({message:q,execute:async(name,args)=>{assert.equal(name,'calculate_ordering');const data=await tool(args);evidence=data.evidence[0];return data;}});assert.equal(r.status,'answer');assert.equal(r.toolCallCount,1);assert.match(r.reply,/819,200/);
});
test('Thousands separators preserve values without admitting invented numbers or arbitrary comma removal',async()=>{
 const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
 for(const [text,allowed]of [['819,200像素',true],['819,201像素',false],['1,2像素',false]]){
  const expert=createEvidenceExpert({transport:async(url)=>url.pathname==='/v1/models'?{ok:true,json:async()=>({data:[{id:'synthetic'}]})}:url.pathname==='/props'?{ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})}:url.pathname==='/tokenize'?{ok:false,json:async()=>({})}:{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({action:'answer',claims:[{text,evidenceIds:['source']}],generalAdvice:[],question:''})},finish_reason:'stop'}]})}});
  const r=await expert.answer({message:'参数',route:{simpleResource:true},execute:async()=>({evidence:[{evidenceId:'source',name:'合成来源',text:'819200像素，12个单元'}]})});assert.equal(r.status,allowed?'answer':'unavailable');
 }
});
