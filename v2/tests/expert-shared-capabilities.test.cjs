'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSectionTools}=require('../adapters/http/section-tools.cjs');
test('expert search and quick tool execute the complete shared answer policy',async()=>{
 const calls=[];
 const tools=createSectionTools({resourceAnswer:async q=>{calls.push(q);return {status:'partial',intent:'chips',answerBasis:'registered-chip-relations',reply:'原条件必须核对',results:[{name:'合成芯片表',text:'译码选择 A',sourceKind:'chip-mapping-original'}]};},resourceSearch:()=>{throw Error('raw-only path');}});
 for(const name of ['search_evidence','quick_answer']){
  const result=await tools.execute(name,{kind:'resources',query:'合成芯片'});
  assert.equal(result.evidence[0].sourceKind,'chip-mapping-original');assert.equal(result.notice.answers[0].status,'partial');assert.match(result.notice.answers[0].reply,/条件/);
  const read=await tools.execute('read_document',{blockId:result.evidence[0].blockId});assert.equal(read.evidence[0].text,'译码选择 A');
 }
 assert.deepEqual(calls,['合成芯片','合成芯片']);
});
test('authorized tender and comparison remain separate from quick sources',async()=>{
 const tools=createSectionTools({tenderMaterials:{evidence:()=>[{evidenceId:'tender-test',name:'合成控标',text:'要求提供证书',sourceKind:'structured-tender-original'}]},expertMaterials:{evidence:()=>[{evidenceId:'compare-test',name:'合成对比',text:'参数原值'}]},resourceAnswer:()=>{throw Error('unexpected quick');},calculateOrdering:async()=>({evidence:[],calculated:true})});
 assert.equal((await tools.execute('search_evidence',{kind:'tender',query:'X100控标'})).notice.certificationConfirmed,false);
 assert.equal((await tools.execute('search_evidence',{kind:'products',query:'X100对比'})).evidence[0].evidenceId,'compare-test');
 assert.equal((await tools.execute('calculate_ordering',{})).calculated,true);
});
