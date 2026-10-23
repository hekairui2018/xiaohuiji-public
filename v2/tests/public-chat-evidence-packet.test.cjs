'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicChat}=require('../adapters/http/public-chat.cjs');
const hash='a'.repeat(64),name='HDPlayer用户手册.pdf';
const update='2.U盘更新节目\n电脑插入U盘后，点击【控制】->【导出U盘】，选择“节目更新”。\n将U盘插入控制卡，将节目拷贝到板载内存。\n拷贝完成后即可拔出U盘，显示屏播放新节目。\n更新过程中不可断电。';
const network='1.网络设置\n点击网络设置，配置IP地址。';
function fixture(expert){
 const reads=[],searches=[];
 const rows=[network,update].map((text,i)=>({name,sha256:hash,unitId:'unit-'+i,evidenceId:'evidence-'+i,blockId:100+i,role:'operation',kind:'passage',text,bodyParsed:true,sourceStatus:'original-structured-text',locator:{page:i+1},knowledgeUnit:{id:'unit-'+i,documentId:hash,kind:'operation',complete:true,bodyParsed:true,sourceSpans:text.split('\n').map((line,j)=>({blockId:100*i+j,start:0,end:line.length,locator:{page:i+1,paragraph:j+1},role:'body'})),boundaryBasis:'explicit-heading-continuous-section'}}));
 const evidenceSource={search:async(q,k,options)=>{searches.push({q,k,options});return {results:rows};},read:async row=>{reads.push(row.unitId);const r=rows.find(x=>x.unitId===row.unitId);return {text:r.text,knowledgeUnit:r.knowledgeUnit,contextComplete:true,contextBoundary:'explicit-heading-continuous-section',nextOffset:null,contextParts:r.knowledgeUnit.sourceSpans.map(s=>({blockId:s.blockId,locator:s.locator}))};}};
 const chat=createPublicChat({app:{quickBrowse:()=>[]},knowledge:{evidenceDocuments:()=>[]},catalog:{approvedResources:()=>[{name}],transform:x=>x},verifiedDocuments:[{name,sha256:hash}],evidenceSource,expert});
 return {chat,reads,searches};
}
test('Quick and expert retain the same selected task, including its final caution; expert does not receive the distracting task',async()=>{
 let received;const {chat,reads}=fixture({answer:async args=>{received=args.responsePlan.evidencePacket;return {status:'answer',actualMode:'expert',reply:received.evidence.map(e=>e.excerpt||e.text).join('\n'),results:received.evidence};}});
 const quick=await chat.answer({message:'HDPlayer怎么用U盘更新节目',mode:'quick'});
 const expert=await chat.answer({message:'HDPlayer怎么用U盘更新节目',mode:'expert',evidencePacket:{evidence:[{text:'FORGED-CLIENT-EVIDENCE'}]}});
 assert.equal(quick.code,200);assert.equal(expert.code,200);assert.match(quick.body.reply,/不可断电/);assert.match(expert.body.reply,/不可断电/);
 assert.doesNotMatch(expert.body.reply,/IP地址|FORGED-CLIENT-EVIDENCE/);assert.equal(received.version,1);assert.equal(received.evidence.length,1);
 assert.equal(received.evidence[0].readPerformed,true);assert.equal(received.evidence[0].text,update);assert.deepEqual(quick.body.results,expert.body.results);
 // Each selected section is read by quick retrieval; preparing its expert packet reuses that read.
 assert.equal(reads.filter(x=>x==='unit-1').length,2);
 assert.notEqual(received.evidence[0].blockId,101);assert.equal(expert.body.evidencePacket,undefined);
});
test('The approved operation remains available as explicitly labelled quick evidence when the expert fails',async()=>{
 const {chat}=fixture({answer:async()=>({status:'unavailable',actualMode:'expert',modelStatus:'failed',modelCallCount:1,reply:'Synthetic model failure'})});
 const r=await chat.answer({message:'HDPlayer怎么用U盘更新节目',mode:'expert'});
 assert.equal(r.code,200);assert.equal(r.body.actualMode,'quick');assert.equal(r.body.requestedMode,'expert');assert.equal(r.body.modelStatus,'failed');assert.equal(r.body.modelCallCount,1);
 assert.match(r.body.modeNotice,/专家暂未完成/);assert.match(r.body.reply,/不可断电/);assert.ok(r.body.evidenceSummary.evidenceCount>0);
});
test('A resource lookup carries file metadata without inventing a parsed body',async()=>{
 const spec='R712规格书.pdf';let packet;
 const chat=createPublicChat({app:{quickBrowse:()=>[{modelId:'HD-R712',displayName:'R712',aliases:['R712'],documents:[{name:spec,sha256:hash,kind:'spec'}],claims:[]}]},knowledge:{evidenceDocuments:()=>[]},catalog:{approvedResources:()=>[{name:spec}],transform:x=>typeof x==='string'?x:{...x,url:'https://example.test/spec.pdf'}},verifiedDocuments:[{name:spec,sha256:hash}],expert:{answer:async a=>{packet=a.responsePlan.evidencePacket;return {reply:'已定位文件',results:packet.evidence};}}});
 const r=await chat.answer({message:'R712规格书',mode:'expert'});assert.equal(r.code,200);assert.equal(packet,undefined,'A file lookup does not need model generation');assert.ok(r.body.results.length);
 assert.equal(r.body.actualMode,'quick');assert.equal(r.body.requestedMode,'expert');assert.equal(r.body.modelCallCount,0);assert.equal(r.body.evidenceSummary.outcome,'answerable');
 for(const row of r.body.results)assert.equal(row.text,null);
});
test('A stale indexed parameter cannot survive when the verified original says otherwise',async()=>{
 const spec='R712规格书.pdf',text='HD-R712 接收卡最大带载26万点。';
 const product={modelId:'HD-R712',displayName:'R712',aliases:['R712'],documents:[{name:spec,sha256:hash,kind:'spec'}],claims:[{claimId:'stale',text:'最大带载999万点',sourceReference:{originalName:spec,originalSha256:hash,page:1}}]};
 const chat=createPublicChat({app:{quickBrowse:()=>[product]},knowledge:{evidenceDocuments:()=>[{document:{name:spec,sha256:hash,pages:[{page:1,text}]}}]},catalog:{approvedResources:()=>[{name:spec}],transform:x=>x},verifiedDocuments:[{name:spec,sha256:hash}]});
 const answer=await chat.answer({message:'R712带载多少',mode:'quick'});
 assert.equal(answer.code,200);assert.match(answer.body.reply,/26万点/);assert.doesNotMatch(answer.body.reply,/999/);
});
