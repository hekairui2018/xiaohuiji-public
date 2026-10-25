'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {answerProcess}=require('../adapters/http/answer-process.cjs');
test('Running summary distinguishes retrieval, actual model call and generation from completion',()=>{
 const before=answerProcess({models:['HD-X1'],status:'running'});assert.match(JSON.stringify(before),/尚未调用/);assert.doesNotMatch(JSON.stringify(before),/已生成回答/);
 const after=answerProcess({models:['HD-X1'],results:[{name:'X1规格书.pdf'}],modelCallCount:1,status:'generating'});assert.match(JSON.stringify(after),/X1规格书/);assert.match(JSON.stringify(after),/正在生成正文/);
});
test('Public real-time summaries apply filename and hash authorization before emitting source names',async()=>{
 const {createPublicChat}=require('../adapters/http/public-chat.cjs');const name='X1规格书.pdf',hash='a'.repeat(64),seen=[];
 const chat=createPublicChat({app:{quickBrowse:()=>[]},knowledge:{evidenceDocuments:()=>[{document:{name,sha256:hash,pages:[{page:1,text:'合成参数'}]}}]},catalog:{approvedResources:()=>[{name,url:'https://example.test/doc.pdf'}],transform:x=>x},verifiedDocuments:[{name,sha256:hash}],expert:{answer:async({onProgress})=>{
  onProgress('composing',{results:[{name,sha256:hash},{name:'PRIVATE_CANARY.pdf',sha256:hash},{name:'WRONG_HASH.pdf',sha256:'b'.repeat(64)}],modelCallCount:1});return {status:'answer',actualMode:'expert',reply:'合成',results:[]};
 }}});
 await chat.answer({message:'测试',mode:'expert'},{onAnswerProgress:summary=>seen.push(summary)});
 assert.ok(seen.length>=2);assert.match(JSON.stringify(seen),/X1规格书/);assert.doesNotMatch(JSON.stringify(seen),/PRIVATE_CANARY|WRONG_HASH/);
});
