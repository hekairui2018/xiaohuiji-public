'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createQuickAnswer}=require('../adapters/http/quick-answer.cjs'),{createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge}),empty=async()=>({results:[]});
function conversation(){const business=createQuickAnswer({app,knowledge,search:empty,searchCases:empty}),api=createQuickRetrieval({app,knowledge,search:empty,searchCases:empty,businessAnswer:business.answer}),state={id:'conditional-dialogue',messages:[],retrievalHistory:[]};return async message=>{state.messages.push({role:'user',content:message});const result=await api.answer(message,{state});state.retrievalHistory.push({quickContext:result.quickContext});return result;};}
test('P2 then 10 by 10 then unknown module keeps one task and delivers a validated conditional list and wiring',async()=>{
 const say=conversation();for(const text of ['P2','10宽10高','不知道模组','室内'])assert.equal((await say(text)).intent,'ordering');const r=await say('同步'),s=r.quickContext.ordering;
 assert.equal(r.status,'answer');assert.equal(s.stage,'conditional');assert.equal(s.confirmed.module.pitchMm,2);assert.equal(s.confirmed.screen.moduleColumns,10);assert.equal(s.confirmed.module.scan,undefined);assert.equal(s.confirmed.module.interface,undefined);assert.equal(r.result.plan.screen.pixelWidth,1600);assert.equal(r.result.plan.screen.pixelHeight,800);assert.equal(r.result.previewBom.find(x=>x.kind==='module').quantity,100);assert.equal(r.result.topology.connections.length,r.result.plan.cells.length);assert.equal(r.result.exportAllowed,false);assert.equal(r.modelCallCount,0);assert.doesNotMatch(r.reply,/请提供模组完整|能提供单块|唯一库记录/);
 const changed=await say('改成12宽10高');assert.equal(changed.result.previewBom[0].quantity,120);assert.equal(changed.quickContext.ordering.confirmed.controlMode,'sync');
});
test('Only essential use conditions are asked and normal planning no longer ends in a full module specification demand',async()=>{
 const say=conversation();await say('配单P2，10宽10高');await say('室内');const r=await say('同步');assert.equal(r.quickContext.ordering.stage,'conditional');assert.match(r.reply,/条件配单/);assert.equal(r.result.previewBom.length,3);
 const noDefaults=await say('不要默认模组');assert.notEqual(noDefaults.quickContext.ordering.stage,'conditional');assert.equal(noDefaults.quickContext.ordering.planningPolicy.useCatalog,false);
 const reset=await say('另一块屏');assert.equal(reset.quickContext.ordering.confirmed.module,undefined);assert.notEqual(reset.quickContext.ordering.planningPolicy?.useCatalog,true);
});
test('Known pitch and module physical size infer pixels while unknown scan remains a source assumption',async()=>{
 const say=conversation();await say('配单P2 模组尺寸320×160mm，10宽10高，室内同步');const r=await say('不知道扫描，按常规配');assert.equal(r.quickContext.ordering.stage,'conditional');assert.equal(r.result.plan.module.resolution[0],160);assert.equal(r.quickContext.ordering.confirmed.module.pixelWidth,undefined);assert.equal(r.quickContext.ordering.derived.find(x=>x.field==='/module/pixelWidth').value,160);assert.equal(r.quickContext.ordering.confirmed.module.scan,undefined);
});
test('Ten metres remains physical size and a large screen without a feasible controller is not disguised as missing module facts',async()=>{
 const say=conversation();await say('配单P2 宽10米高10米');await say('室内同步');const candidate=await say('按常规模组配');assert.equal(candidate.quickContext.ordering.confirmed.screen.physicalWidthMm,10000);assert.equal(candidate.quickContext.ordering.confirmed.screen.moduleColumns,undefined);assert.ok(candidate.quickContext.ordering.gridProposal.requiresConfirmation);const adjusted=await say('允许调整尺寸');assert.notEqual(adjusted.quickContext.ordering.confirmed.screen.physicalWidthMm,10000);assert.ok(adjusted.quickContext.ordering.simulationFailures.length);assert.match(adjusted.reply,/单台主控|多机分区/);assert.doesNotMatch(adjusted.reply,/能提供单块模组/);
});
