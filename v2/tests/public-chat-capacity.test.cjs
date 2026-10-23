'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicChat}=require('../adapters/http/public-chat.cjs');
function chat(expert){return createPublicChat({app:{quickBrowse:()=>[]},knowledge:{evidenceDocuments:()=>[]},catalog:{approvedResources:()=>[],transform:x=>x},expert});}
test('New failed model requests never exhaust the public conversation capacity',async()=>{
 for(const expert of [undefined,{answer:async()=>({status:'unavailable',reply:'synthetic offline',actualMode:'expert'})},{answer:async()=>({status:'busy',reply:'synthetic busy',actualMode:'expert'})}]){
  const api=chat(expert);for(let i=0;i<205;i++){const result=await api.answer({message:'请专家分析',mode:'expert'});assert.equal(result.code,expert?(expert&&result.body.status==='busy'?429:503):503);}
  assert.equal((await api.answer({message:'你好',mode:'quick'})).code,200);
 }
});
