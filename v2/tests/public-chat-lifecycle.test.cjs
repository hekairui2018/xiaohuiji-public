'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createPublicChat}=require('../adapters/http/public-chat.cjs'),{createPublicCatalog}=require('../adapters/http/public-catalog.cjs');
const name='R712规格书.pdf',hash='a'.repeat(64),url='https://example.test/approved.pdf';
function fixture({expert,text='R712 接收卡最大带载26万点。',documents,claims=[],catalog,products}={}){
 return createPublicChat({expert,catalog:catalog||{approvedResources:()=>[{name,url}],transform:x=>x},
  app:{quickBrowse:()=>products||[{modelId:'HD-R712',displayName:'R712',aliases:['R712'],documents:[{name,kind:'spec'}],claims}]},
  knowledge:{evidenceDocuments:()=>documents||[{document:{name,sha256:hash,pages:[{page:1,text}]}}]},verifiedDocuments:[{name,sha256:hash}]});
}
test('Public signatures are refreshed at response time even after the service has run for hours',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-chat-signing-'));let now=1_000_000;
 try{
  fs.writeFileSync(path.join(dir,'cloud.json'),JSON.stringify({AccessKeyId:'synthetic-id',AccessKeySecret:'synthetic-secret',Bucket:'synthetic-bucket',Region:'oss-cn-shenzhen'}));
  fs.writeFileSync(path.join(dir,'allow.json'),JSON.stringify({schemaVersion:'v2-public-cloud-1',objects:[{name,key:'official-files/'+name}]}));
  const catalog=createPublicCatalog({configFile:path.join(dir,'cloud.json'),allowlistFile:path.join(dir,'allow.json'),now:()=>now});
  const chat=fixture({catalog,expert:{answer:async({execute})=>{const found=await execute('search_evidence',{kind:'text',query:'R712带载'});now+=600_000;return {reply:'已核对',results:found.evidence};}}});
  now+=7_200_000;const result=await chat.answer({message:'R712带载多少',mode:'expert'});
  assert.ok(result.body.results.length);assert.equal(Number(new URL(result.body.results[0].download).searchParams.get('Expires')),Math.floor(now/1000)+300);
  now+=7_200_000;const quick=await chat.answer({message:'R712规格书'});assert.ok(quick.body.results.length);assert.equal(Number(new URL(quick.body.results[0].download).searchParams.get('Expires')),Math.floor(now/1000)+300);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('Product preview claims require a read of the matching verified original, not the indexed claim text',async()=>{
 const chat=fixture({claims:[{claimId:'claim1',text:'索引候选带载999万点',sourceReference:{originalName:name,originalSha256:hash,page:1}}],expert:{answer:async({execute})=>{
  const found=await execute('search_evidence',{kind:'products',query:'R712带载'}),claim=found.evidence.find(e=>e.text.includes('999'));
  assert.ok(claim);assert.equal(claim.readPerformed,false);assert.equal(claim.readAvailable,true);
  const read=await execute('read_document',{blockId:claim.blockId});assert.match(read.evidence[0].text,/26万点/);assert.ok(!read.evidence[0].text.includes('999'));assert.equal(read.evidence[0].sha256,hash);
  return {reply:'只读取已核实原件',results:read.evidence};
 }}});assert.equal((await chat.answer({message:'R712带载',mode:'expert'})).code,200);
});
test('Public read handles are issued per request and pagination only follows emitted offsets',async()=>{
 let oldHandle,oldExecute,round=0;const text='R712 带载26万点。'+'正文'.repeat(5500)+'最终条件';
 const chat=fixture({text,expert:{answer:async({execute})=>{
  if(round++)await assert.rejects(()=>execute('read_document',{blockId:oldHandle}),/invalid-tool/);
  const found=await execute('search_evidence',{kind:'text',query:'R712带载'}),handle=found.evidence[0].blockId;
  if(oldHandle)assert.notEqual(oldHandle,handle);oldHandle=handle;
  await assert.rejects(()=>execute('read_document',{blockId:handle,offset:5000}),/invalid-tool/);
  await assert.rejects(()=>execute('read_document',{blockId:handle,offset:-1}),/invalid-tool/);
  let joined='',offset=0;do{const read=await execute('read_document',{blockId:handle,offset});joined+=read.evidence[0].text;offset=read.notice.nextOffset;}while(offset!==null);
  assert.equal(joined,text);oldExecute=execute;return {reply:'分页读取完成'};
 }}});
 const first=await chat.answer({message:'R712带载',mode:'expert'});await assert.rejects(()=>oldExecute('read_document',{blockId:oldHandle}),/invalid-tool/);await chat.answer({message:'继续核对',mode:'expert',conversationId:first.body.conversationId});
});
test('Public approval never overrides restricted metadata or a mismatched product digest',async()=>{
 const chat=fixture({documents:[{document:{name,sha256:hash,accessRestricted:true,pages:[{page:1,text:'PRIVATE-CANARY 带载26万点'}]}}],claims:[{claimId:'secret',text:'PRIVATE-CANARY 带载26万点',sourceReference:{originalName:name,originalSha256:hash}}]});
 assert.equal(chat.evidenceCount,0);assert.ok(!JSON.stringify(await chat.answer({message:'R712带载'})).includes('PRIVATE-CANARY'));
 const bad=fixture({documents:[],products:[{modelId:'HD-R712',displayName:'R712',aliases:[],documents:[{name,sha256:'b'.repeat(64),kind:'spec'}],claims:[]}]});
 const answer=await bad.answer({message:'R712规格书'});assert.deepEqual(answer.body.results,[]);
});
test('Only current public history crosses quick to expert; unknown session IDs cannot import another conversation',async()=>{
 const seen=[];const chat=fixture({expert:{answer:async({sessionState})=>{seen.push(structuredClone(sessionState));return {reply:'已结合上文'};}}});
 const first=await chat.answer({message:'R712 带载多少'});await chat.answer({message:'这款规格书',conversationId:first.body.conversationId});
 await chat.answer({message:'请结合上文继续分析',mode:'expert',conversationId:first.body.conversationId});
 assert.equal(seen[0].messages.filter(m=>m.role==='user').length,2);assert.equal(seen[0].messages[0].content,'R712 带载多少');assert.ok(seen[0].taskState);
 await chat.answer({message:'请分析',mode:'expert',conversationId:'unknown-private-id'});assert.deepEqual(seen[1].messages,[]);assert.notEqual(seen[1].id,first.body.conversationId);
});
test('Failed or cancelled expert work leaves session state untouched and releases its busy slot',async()=>{
 let release,entered;const wait=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;}),committed=[];let calls=0;
 const chat=fixture({expert:{answer:async({sessionState})=>{calls++;if(calls===1){sessionState.messages.push({role:'user',content:'MUST-NOT-COMMIT'});entered();await gate;}else committed.push(structuredClone(sessionState));return {reply:'已完成'};}}});
 const first=await chat.answer({message:'R712带载'}),id=first.body.conversationId,controller=new AbortController();
 const cancelled=chat.answer({message:'取消本条',mode:'expert',conversationId:id},{signal:controller.signal});await wait;
 assert.equal((await chat.answer({message:'重复请求',mode:'expert',conversationId:id})).code,409);
 controller.abort();release();await assert.rejects(()=>cancelled,{name:'AbortError'});
 const resumed=await chat.answer({message:'R712规格书',conversationId:id});assert.equal(resumed.code,200);
 await chat.answer({message:'检查上下文',mode:'expert',conversationId:id});assert.ok(!JSON.stringify(committed).includes('MUST-NOT-COMMIT'));assert.ok(!JSON.stringify(committed).includes('取消本条'));assert.ok(!JSON.stringify(committed).includes('重复请求'));
 const snapshots=[];const other=fixture({expert:{answer:async({sessionState})=>{snapshots.push(sessionState);throw Error('synthetic failure');}}});
 const start=await other.answer({message:'R712带载'});await assert.rejects(()=>other.answer({message:'失败请求',mode:'expert',conversationId:start.body.conversationId}),/synthetic failure/);
 assert.equal((await other.answer({message:'R712规格书',conversationId:start.body.conversationId})).code,200);
});
