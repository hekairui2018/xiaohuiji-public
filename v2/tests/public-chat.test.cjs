'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicChat}=require('../adapters/http/public-chat.cjs');
const hash='a'.repeat(64),name='R712规格书.pdf';
const doc={name,sha256:hash,pages:[{page:1,text:'HD-R712 接收卡\n带载：128×512 像素。'}]};
const product={modelId:'HD-R712',displayName:'R712',aliases:['R712'],parameters:{secret:'PRIVATE-CANARY'},documents:[{name,kind:'spec'},{name:'内部私密.pdf',kind:'spec'}],claims:[]};
const catalog={approvedResources:()=>[{name,url:'https://example.test/approved.pdf'}],transform:x=>x};
test('Public quick retrieval uses only approved, hash-verified originals and independent conversation state',async()=>{
 const app={quickBrowse:()=>[product],dialogue(){throw Error('Private pipeline called');},originalDocuments(){throw Error('Private originals called');}};
 const knowledge={evidenceDocuments:()=>[{document:doc},{document:{name:'内部私密.pdf',sha256:'b'.repeat(64),pages:[{page:1,text:'PRIVATE-CANARY'}]}}]};
 const chat=createPublicChat({app,knowledge,catalog,verifiedDocuments:[{name,sha256:hash}]});
 assert.equal(chat.evidenceCount,1);
 const r=await chat.answer({message:'R712 带载多少',mode:'quick',conversationId:'some-internal-session'});
 assert.equal(r.code,200);assert.match(r.body.reply,/128|512/);assert.ok(!JSON.stringify(r).includes('PRIVATE-CANARY'));assert.notEqual(r.body.conversationId,'some-internal-session');
 const next=await chat.answer({message:'规格书',conversationId:r.body.conversationId});assert.equal(next.code,200);assert.equal(next.body.conversationId,r.body.conversationId);
 assert.equal((await chat.answer({message:'R712',mode:'private'})).code,400);
 const bad=createPublicChat({app,knowledge,catalog,verifiedDocuments:[{name,sha256:'c'.repeat(64)}]});assert.equal(bad.evidenceCount,0);
});
test('Expert tools issue public-only read handles and never disclose internal sessions or evidence',async()=>{
 let executed=false;const expert={status:async()=>({available:true}),answer:async({execute,sessionState})=>{
  assert.deepEqual(sessionState.messages,[]);await assert.rejects(()=>execute('read_document',{blockId:999999}),/invalid-tool/);
  const r=await execute('search_evidence',{query:'R712 带载',kind:'text'});assert.ok(r.evidence.length);assert.ok(!JSON.stringify(r).includes('PRIVATE-CANARY'));
  const read=await execute('read_document',{blockId:r.evidence[0].blockId});assert.equal(read.evidence[0].readPerformed,true);executed=true;
  return {status:'answer',reply:read.evidence[0].text,actualMode:'expert',modelStatus:'available',results:read.evidence};
 }};
 const chat=createPublicChat({app:{quickBrowse:()=>[product]},knowledge:{evidenceDocuments:()=>[{document:doc}]},catalog,expert,verifiedDocuments:[{name,sha256:hash}]});
 const r=await chat.answer({message:'R712 带载多少',mode:'expert'});assert.equal(r.code,200);assert.equal(executed,true);assert.equal(r.body.actualMode,'expert');assert.equal(r.body.toolTrace,undefined);
});
