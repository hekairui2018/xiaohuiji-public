'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createExpertEvidence}=require('../adapters/http/expert-evidence.cjs'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const hash='a'.repeat(64),other='b'.repeat(64),unitId='c'.repeat(64);
const unit={id:unitId,kind:'parameter',sourceSpans:[{blockId:10,start:2,end:15,textHash:'d'.repeat(64),indexedTextHash:'e'.repeat(64),role:'body',locator:{page:3}}],complete:false,boundaryBasis:'parsed-page-parameter-window;table-layout-unverified'};
const result={blockId:10,name:'R712规格书.pdf',sha256:hash,unitId,knowledgeUnit:unit,role:'parameter',text:'最大带载26万点',locator:{page:3},locations:[{id:2}],readAnchor:2,proximity:{matchedConcepts:1,spanChars:7}};
function tools(extra={}){return createExpertEvidence({request:async()=>({results:[]}),searchCases:()=>({results:[]}),caseMap:new Map(),clean:String,location:x=>x,roleIndexEnabled:true,...extra});}
test('Expert role units preserve source spans, only issued handles read and changed unit identity is rejected',async()=>{
 const calls=[];let tamper=false;const api=tools({roleRequest:async(route,args)=>{calls.push({route,args});return route==='/role/search'?{results:[result]}:{blocks:[{blockId:10,locator:{page:3},charStart:2,charEnd:15,text:'最大带载26万点，完整条件'}],knowledgeUnit:tamper?{...unit,sourceSpans:[{...unit.sourceSpans[0],textHash:'e'.repeat(64)}]}:unit,boundary:'explicit-section',nextOffset:null,totalChars:15};}});
 const found=await api.search({kind:'products',query:'R712带载',concepts:['带载']});assert.equal(calls[0].args.role,'parameter');assert.deepEqual(found.evidence[0].knowledgeUnit.sourceSpans,unit.sourceSpans);assert.equal(found.notice.roleIndexUsed,true);
 assert.equal(await api.read({blockId:10}),null);const read=await api.read({blockId:found.evidence[0].blockId});assert.equal(calls.at(-1).args.unit,unitId);assert.equal(read.evidence[0].readPerformed,true);assert.deepEqual(read.evidence[0].knowledgeUnit,unit);
 tamper=true;await assert.rejects(()=>api.read({blockId:found.evidence[0].blockId}),/unit-identity-mismatch/);
});
test('Unavailable or malformed role candidates fall back to the existing proximity search; default stays unchanged',async()=>{
 for(const malformed of [false,true]){let legacy=0;const api=tools({roleRequest:async()=>{if(!malformed)throw Error('503');return {results:[{...result,unitId:'wrong'}]};},request:async()=>{legacy++;return {results:[result]};}});const found=await api.search({kind:'text',query:'带载',concepts:['带载']});assert.equal(legacy,1);assert.equal(found.notice.roleIndexUsed,false);}
 const api=tools({roleIndexEnabled:false,roleRequest:async()=>{throw Error('must not run');}});assert.deepEqual((await api.search({kind:'text',query:'带载',concepts:['带载']})).evidence,[]);
});
test('Role file metadata never receives a fabricated original-reading handle',async()=>{
 const api=tools({roleRequest:async()=>({results:[{...result,blockId:null,knowledgeUnit:{...unit,kind:'file'}}]})});const found=await api.search({kind:'firmware',query:'固件',concepts:['固件']});assert.equal(found.evidence[0].blockId,null);assert.equal(found.evidence[0].readAvailable,false);
});

test('Expert document filters preserve Python omitted, empty and exact-name semantics',async()=>{
 const seen=[],api=tools({defaultModels:['HD-R712'],roleRequest:async(route,args)=>{
  assert.equal(route,'/role/search');seen.push(args);
  const rows=args.documents==null||args.documents.includes(result.name)?[result]:[];
  return {results:rows};
 }});
 const base={kind:'products',query:'R712灰度等级',concepts:['灰度']};
 assert.equal((await api.search(base)).evidence.length,1);
 assert.equal(Object.hasOwn(seen[0],'documents'),false);assert.deepEqual(seen[0].models,['HD-R712']);assert.equal(seen[0].role,'parameter');
 assert.equal((await api.search({...base,documents:[]})).evidence.length,0);assert.deepEqual(seen.at(-1).documents,[]);
 assert.equal((await api.search({...base,documents:[result.name]})).evidence.length,1);assert.deepEqual(seen.at(-1).documents,[result.name]);
 assert.equal((await api.search({...base,documents:['R712S规格书.pdf']})).evidence.length,0);
 for(const documents of [null,'R712规格书.pdf',[null],['']])await assert.rejects(()=>api.search({...base,documents}),/expert-invalid-tool/);
});

test('Expert file navigation includes firmware metadata without inventing body evidence or read handles',async()=>{
 const calls=[],firmware={...result,kind:'file',role:'firmware',blockId:undefined,name:'R712_FPGA_V1.2.3.4_ZZ.bin',knowledgeUnit:{...unit,kind:'firmware',bodyParsed:false,sourceSpans:[]},text:'R712_FPGA_V1.2.3.4_ZZ.bin\n合成固件目录 LS9932'};
 const api=tools({roleRequest:async(route,args)=>{calls.push({route,args});return {results:args.role==='all'?[firmware]:[]};}});
 const found=await api.search({kind:'files',query:'R712 LS9932',concepts:['LS9932'],models:['R712']});
 assert.equal(found.evidence.length,1);assert.equal(found.notice.roleIndexUsed,true);assert.equal(calls[0].args.role,'all');assert.deepEqual(calls[0].args.models,['R712']);
 const e=found.evidence[0];assert.equal(e.role,'firmware');assert.equal(e.knowledgeUnit.bodyParsed,false);assert.deepEqual(e.knowledgeUnit.sourceSpans,[]);assert.equal(e.blockId,null);assert.equal(e.readAvailable,false);assert.deepEqual(e.readBlockIds,[]);
 assert.equal(await api.read({blockId:10}),null);assert.equal(calls.length,1);
});
test('Unsupported chip/version constraints stay on the existing constrained retrieval path',async()=>{
 const urls=[],api=tools({roleRequest:async()=>{throw Error('must not discard hard constraints');},request:async url=>{urls.push(url);return {results:[]};}});
 await api.search({kind:'firmware',query:'闪烁',concepts:['闪烁'],chips:['ICN2153'],version:'V1.2.3'});assert.equal(urls.length,1);const params=new URL(urls[0],'http://local').searchParams;assert.deepEqual(JSON.parse(params.get('chips')),['ICN2153']);assert.equal(params.get('version'),'V1.2.3');
});
test('Offline HTTP role tools send a bounded POST authorization scope and recheck response/read identity',async()=>{
 const seen=[];let fallback=false;const index=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');let body={};if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);body=JSON.parse(Buffer.concat(chunks));}seen.push({url:req.url,method:req.method,body});
  if(req.url==='/catalog')return res.end(JSON.stringify({resources:[{name:result.name,sha256:hash,locationId:2,availabilityState:'present'},{name:'internal.docx',sha256:other,locationId:3,folders:['仅供内部']},{name:'regular-copy.docx',sha256:other,locationId:4,folders:[]}]}));
  if(req.url==='/role/search'){if(fallback){res.statusCode=503;return res.end('{}');}return res.end(JSON.stringify({results:[result,{...result,name:'internal.docx',sha256:other,unitId:'f'.repeat(64),knowledgeUnit:{...unit,id:'f'.repeat(64)}}]}));}
  if(req.url==='/role/read')return res.end(JSON.stringify({knowledgeUnit:unit,blocks:[{blockId:10,text:'完整原文条件'}],nextOffset:null,boundary:'explicit-section'}));
  if(req.url.startsWith('/proximity/search'))return res.end(JSON.stringify({results:[result,{...result,name:'internal.docx',sha256:other}]}));
  if(req.url.startsWith('/proximity/read'))return res.end(JSON.stringify({blocks:[{blockId:10,text:'旧检索原文'}],nextOffset:null}));
  res.statusCode=404;res.end('{}');
 });await new Promise(r=>index.listen(0,'127.0.0.1',r));let tested=0;
 const api=createOfflineKnowledge({resourceBase:'http://127.0.0.1:'+index.address().port,roleIndexEnabled:true,expert:{answer:async({execute})=>{
  const found=await execute('search_evidence',{kind:'text',query:'带载',concepts:['带载']});assert.equal(found.evidence.length,1);assert.equal(found.evidence[0].name,result.name);assert.equal(found.notice.roleIndexUsed,!fallback);
  const read=await execute('read_document',{blockId:found.evidence[0].blockId});assert.equal(read.evidence[0].readPerformed,true);tested++;return {status:'answer',reply:'已核对'};
 }}});
 const server=http.createServer((req,res)=>api.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const shouldFallback of [false,true]){fallback=shouldFallback;const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'查带载',mode:'expert',sessionId:'role-test-'+shouldFallback})});assert.equal(r.status,200);assert.equal((await r.json()).reply,'已核对');}
  assert.equal(tested,2);for(const call of seen.filter(x=>x.url.startsWith('/role/'))){assert.equal(call.method,'POST');assert.deepEqual(call.body.authorized_keys,[hash]);}assert.ok(seen.some(x=>x.url.startsWith('/proximity/search')));
 }finally{server.closeAllConnections();index.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>index.close(r))]);}
});
test('Quick operation context prefers the role unit and safely falls back to legacy context when unavailable',async()=>{
 const name='HDPlayer用户手册.pdf',operationUnit={...unit,kind:'operation'},text='第五章 节目更新\n1.集群发送\n选择设备后点击发送。\n2.U盘更新节目\n点击导出U盘。';let fallback=false;const seen=[];
 const index=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');let args={};if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);args=JSON.parse(Buffer.concat(chunks));}seen.push({url:req.url,args});
  if(req.url==='/catalog')return res.end(JSON.stringify({resources:[{name,sha256:hash,locationId:2}]}));
  if(req.url==='/role/search'){if(fallback){res.statusCode=503;return res.end('{}');}assert.equal(args.role,'operation');return res.end(JSON.stringify({results:[{...result,name,knowledgeUnit:operationUnit,role:'operation',text}]}));}
  if(req.url==='/role/read')return res.end(JSON.stringify({knowledgeUnit:operationUnit,blocks:[{blockId:10,text}],nextOffset:null,boundary:'explicit-section'}));
  if(req.url.startsWith('/proximity/search'))return res.end(JSON.stringify({results:[{...result,name,text}]}));
  if(req.url.startsWith('/proximity/read'))return res.end(JSON.stringify({blocks:[{blockId:10,text}],nextOffset:null,boundary:'explicit-section'}));
  res.end(JSON.stringify({results:[]}));
 });await new Promise(r=>index.listen(0,'127.0.0.1',r));
 const app={quickResources:()=>({}),chipLookup:()=>null,quickBrowse:()=>[],quickSearch:()=>({records:[]}),resourceMedia:{softwareItems:q=>/HDPlayer/i.test(q)?[{name:'HDPlayer'}]:[]}};
 const api=createOfflineKnowledge({app,knowledge:{cases:()=>[],products:()=>[],evidenceDocuments:()=>[]},resourceBase:'http://127.0.0.1:'+index.address().port,roleIndexEnabled:true});
 const server=http.createServer((req,res)=>api.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const shouldFallback of [false,true]){fallback=shouldFallback;const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'HDPlayer 如何发送节目',mode:'quick',sessionId:'operation-role-'+shouldFallback})});const body=await r.json();assert.equal(r.status,200);assert.equal(body.answerType,'operation-excerpt');assert.match(body.reply,/选择设备后点击发送/);if(!fallback)assert.deepEqual(body.results[0].knowledgeUnit.sourceSpans,unit.sourceSpans);}
  assert.ok(seen.some(x=>x.url==='/role/read'));assert.ok(seen.some(x=>x.url.startsWith('/proximity/read')));
 }finally{server.closeAllConnections();index.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>index.close(r))]);}
});

test('Quick operation reads later pages with exact unit spans, distinct identities and authorized role links',async()=>{
 const name='HDPlayer用户手册.pdf',boundary='explicit-heading-continuous-section;visual-steps-unverified';
 const later='2.U盘更新节目\n电脑插入U盘，点击【控制】->【导出U盘】，选择“节目更新”。\n将U盘插入控制卡，拷贝完成后拔出。\n注意：复制期间勿拔出U盘。';
 const entries=[
  {id:unitId,start:2,text:'前言资料。\n'.repeat(1100)+later,locator:{page:48}},
  {id:'e'.repeat(64),start:12000,text:'6.定时开关机设置\n点击【控制】->【其他设置】->【定时开关机】，设置开机与关机时间。\n该设置只断开视频信号，屏体电源正常通电。',locator:{page:62}}
 ].map(e=>({...e,unit:{...unit,id:e.id,kind:'operation',boundaryBasis:boundary,sourceSpans:[{...unit.sourceSpans[0],start:e.start,end:e.start+e.text.length,locator:e.locator}]}}));
 const seen=[];const index=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');let args={};if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);args=JSON.parse(Buffer.concat(chunks));}seen.push({url:req.url,args});
  if(req.url==='/catalog')return res.end(JSON.stringify({resources:[{name,sha256:hash,locationId:2,availabilityState:'present'}]}));
  if(req.url==='/role/search'){
   assert.deepEqual(args.authorized_keys,[hash]);const e=entries[/定时|开关机/.test(args.q)?1:0];
   return res.end(JSON.stringify({results:[{...result,name,unitId:e.id,role:'operation',knowledgeUnit:e.unit,text:e.text.slice(-300),locator:e.locator}]}));
  }
  if(req.url==='/role/read'){
   assert.deepEqual(args.authorized_keys,[hash]);const e=entries.find(e=>e.id===args.unit);assert.ok(e);const offset=args.offset||0,end=Math.min(offset+6000,e.text.length);
   return res.end(JSON.stringify({unitId:e.id,knowledgeUnit:e.unit,boundary,boundaryWindowLimited:true,totalChars:e.text.length,nextOffset:end<e.text.length?end:null,blocks:[{blockId:10,locator:e.locator,charStart:e.start+offset,charEnd:e.start+end,role:'body',text:e.text.slice(offset,end)}]}));
  }
  return res.end(JSON.stringify({results:[]}));
 });await new Promise(r=>index.listen(0,'127.0.0.1',r));
 const app={quickResources:()=>({}),chipLookup:()=>null,quickBrowse:()=>[],quickSearch:()=>({records:[]}),resourceMedia:{softwareItems:q=>/HDPlayer/i.test(q)?[{name:'HDPlayer'}]:[]}};
 const api=createOfflineKnowledge({app,knowledge:{cases:()=>[],products:()=>[],evidenceDocuments:()=>[]},resourceBase:'http://127.0.0.1:'+index.address().port,roleIndexEnabled:true});
 const server=http.createServer((req,res)=>api.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const denied=await fetch(base+'/v2/offline/role-read?unit='+entries[0].id);assert.equal(denied.status,403);assert.equal(seen.filter(c=>c.url==='/role/read').length,0);
  const answers=[];for(const [i,message]of ['HDPlayer怎么用U盘更新节目','HDPlayer怎么设置定时开关机'].entries()){
   const response=await fetch(base+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,mode:'quick',sessionId:'role-pages-'+i})});assert.equal(response.status,200);const body=await response.json();
   assert.equal(body.answerType,'operation-excerpt');assert.equal(body.results.length,1);assert.equal(body.results[0].knowledgeUnit.complete,false);assert.deepEqual(body.results[0].knowledgeUnit.sourceSpans,entries[i].unit.sourceSpans);
   assert.equal(body.results[0].readUrl,'/v2/offline/role-read?unit='+entries[i].id);answers.push(body);
  }
  assert.match(answers[0].reply,/选择“节目更新”/);assert.match(answers[0].reply,/复制期间勿拔出U盘/);assert.doesNotMatch(answers[0].reply,/前言资料/);assert.match(answers[1].reply,/只断开视频信号/);
  assert.notEqual(answers[0].results[0].evidenceId,answers[1].results[0].evidenceId);assert.ok(seen.some(c=>c.url==='/role/read'&&c.args.unit===entries[0].id&&c.args.offset===6000));
  const readResponse=await fetch(base+answers[0].results[0].readUrl);assert.equal(readResponse.status,200);const read=await readResponse.json();assert.equal(read.unitId,entries[0].id);assert.deepEqual(read.knowledgeUnit.sourceSpans,entries[0].unit.sourceSpans);assert.equal(read.nextOffset,null);assert.equal(read.blocks.length,2);assert.equal(read.blocks[0].charStart,entries[0].start);assert.equal(read.blocks[1].charStart,entries[0].start+6000);assert.equal(read.blocks[1].charEnd,entries[0].start+entries[0].text.length);assert.equal(read.blocks.map(b=>b.text).join(''),entries[0].text);
  assert.equal((await fetch(base+'/v2/offline/role-read?unit='+'f'.repeat(64))).status,403);
 }finally{server.closeAllConnections();index.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>index.close(r))]);}
});
