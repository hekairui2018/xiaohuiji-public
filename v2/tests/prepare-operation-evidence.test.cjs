'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareOperationEvidence,incompleteOperationAnswer}=require('../adapters/http/prepare-operation-evidence.cjs');
test('targeted retrieval reads the requested native operation instead of a high-step-count neighbour',async()=>{
 let reads=0;const p=await prepareOperationEvidence({plan:{focus:'添加图片',software:['Example']},rows:[{text:'点击添加天气。',name:'Example手册'}],documents:['Example手册'],search:async()=>({evidence:[{blockId:8,text:'点击添加图片。'}]}),read:async()=>{reads++;return {evidence:[{text:'点击图片图标添加图片。',readPerformed:true}]};}});
 assert.equal(reads,1);assert.equal(p.complete,true);assert.equal(incompleteOperationAnswer(p),null);
});
test('an unsupported action chain cannot become another function procedure or a claim that no source exists',async()=>{
 const p=await prepareOperationEvidence({plan:{focus:'读取接收卡参数并保存'},rows:[{text:'网口备份，点击添加，点击保存。',name:'Example手册'}],documents:[],search:async()=>{throw Error('not expected')},read:async()=>{}});
 const a=incompleteOperationAnswer(p);assert.match(a.reply,/尚未核实/);assert.doesNotMatch(a.reply,/网口备份/);assert.equal(a.modelCallCount,0);assert.match(a.grounding,/not-a-proof/);
});
