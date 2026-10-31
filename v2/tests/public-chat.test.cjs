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
test('public expert chooses quick delivery and owns the following turn without prefetched private evidence',async()=>{
 let calls=0;const expert={status:async()=>({available:true}),answer:async({execute,preparedEvidence,sessionState,message})=>{
  assert.equal(preparedEvidence,undefined);calls++;
  if(calls===1){const tool=await execute('quick_answer',{query:'R712规格书'});assert.equal(tool.notice.scope,'explicit-public-allowlist-only');assert.equal(tool.directAnswer.status,'answer');assert(tool.directAnswer.results.every(r=>r.name===name));assert(!JSON.stringify(tool).includes('PRIVATE-CANARY'));return {...tool.directAnswer,actualMode:'expert',modelCallCount:1};}
  assert(sessionState.messages.some(m=>m.role==='user'&&m.content==='R712规格书'));assert.equal(message,'它的带载呢');return {status:'answer',actualMode:'expert',reply:'继续核对R712。',modelCallCount:1};
 }};
 const chat=createPublicChat({app:{quickBrowse:()=>[product]},knowledge:{evidenceDocuments:()=>[{document:doc},{document:{name:'内部私密.pdf',sha256:'b'.repeat(64),accessRestricted:true,pages:[{page:1,text:'PRIVATE-CANARY'}]}}]},catalog,expert,verifiedDocuments:[{name,sha256:hash}]});
 const first=await chat.answer({message:'R712规格书',mode:'expert'});assert.equal(first.code,200);assert.equal(first.body.actualMode,'expert');assert.equal(first.body.results[0].name,name);
 const next=await chat.answer({message:'它的带载呢',mode:'expert',conversationId:first.body.conversationId});assert.equal(next.code,200);assert.equal(next.body.conversationId,first.body.conversationId);assert.equal(calls,2);
});
test('public file tools return approved metadata rather than unread pages or private original links',async()=>{
 const expert={status:async()=>({available:true}),answer:async({execute})=>{const r=await execute('search_evidence',{kind:'files',query:'规格书',models:['HD-R712']});assert.equal(r.evidence.length,1);assert.equal(r.evidence[0].name,name);assert.equal(r.evidence[0].sourceKind,'registered-resource-metadata');assert.equal(r.evidence[0].readAvailable,false);assert(!JSON.stringify(r).includes('PRIVATE-CANARY'));return {status:'answer',actualMode:'expert',reply:'文件在这里。',results:r.evidence};}};
 const chat=createPublicChat({app:{quickBrowse:()=>[product]},knowledge:{evidenceDocuments:()=>[{document:doc}]},catalog,expert,verifiedDocuments:[{name,sha256:hash}]});
 const r=await chat.answer({message:'R712规格书',mode:'expert'});assert.equal(r.code,200);assert.equal(r.body.results[0].name,name);
});
