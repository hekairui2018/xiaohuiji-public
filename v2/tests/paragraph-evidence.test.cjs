'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createParagraphEvidence}=require('../adapters/http/paragraph-evidence.cjs');
const {createPublicChat}=require('../adapters/http/public-chat.cjs');
const hash='a'.repeat(64),other='b'.repeat(64),unit='c'.repeat(64),name='合成软件规格书.pdf';
const table='六、推荐配置\nCPU | 8核16线程\n内存 | 16G\n显卡 | 4G';

test('Paragraph transport applies caller scope before retrieval and rechecks reads after revocation',async t=>{
 let grants=[{name,sha256:hash}],requests=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;
  const args=JSON.parse(body);requests.push({path:req.url,args});
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify(req.url==='/role/search'?{results:[
   {name,sha256:hash,unitId:unit,blockId:1,kind:'passage',role:'parameter',text:table,locations:[{name,path:'G:/PRIVATE/PATH'}],knowledgeUnit:{bodyParsed:true}},
   {name:'私密.txt',sha256:other,unitId:'d'.repeat(64),kind:'passage',text:'PRIVATE-CANARY',locations:[{name:'私密.txt'}]}
  ]}:{unitId:unit,knowledgeUnit:{id:unit,documentId:hash,subjects:['software-host-computer']},blocks:[{text:table,locator:{page:5}}],nextOffset:null,totalChars:table.length,boundary:'native-table'}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const source=createParagraphEvidence({resourceBase:'http://127.0.0.1:'+server.address().port,authorizedDocuments:async()=>grants});
 const found=await source.search('推荐电脑配置','products');
 assert.deepEqual(requests[0].args.authorized_keys,[hash]);assert.equal(requests[0].args.role,'parameter');
 assert.equal(found.results.length,1);assert.ok(!JSON.stringify(found).includes('PRIVATE'));
 const read=await source.read(found.results[0]);assert.equal(read.text,table);assert.deepEqual(read.knowledgeUnit.subjects,['software-host-computer']);
 grants=[];await assert.rejects(()=>source.read(found.results[0]),/not-authorized/);assert.equal(requests.length,2);
});

test('Public expert reads the indexed section with request-local handles; binaries stay metadata-only',async()=>{
 let reads=0;
 const source={search:async(q,kind,options)=>{
  assert.deepEqual(options.authorizedDocuments,[{name,sha256:hash}]);
  return {results:[{name,sha256:hash,unitId:unit,blockId:1,bodyParsed:true,text:table,knowledgeUnit:{subjects:['software-host-computer']}},
   {name:'internal.txt',sha256:other,text:'PRIVATE-CANARY'}]};
 },read:async(r)=>{assert.equal(r.unitId,unit);reads++;return {text:table,knowledgeUnit:{subjects:['software-host-computer'],visualContextRequired:false},nextOffset:null,totalChars:table.length,contextBoundary:'native-table'};}};
 const expert={answer:async({execute})=>{
  const found=await execute('search_evidence',{query:'推荐电脑配置',kind:'products',documents:[name]});
  assert.equal(found.evidence.length,1);const handle=found.evidence[0].blockId;
  assert.notEqual(handle,1);await assert.rejects(()=>execute('read_document',{blockId:1}),/invalid-tool/);
  const read=await execute('read_document',{blockId:handle});assert.equal(read.notice.contextBoundary,'native-table');
  assert.equal(read.evidence[0].readPerformed,true);return {reply:read.evidence[0].text,results:read.evidence};
 }};
 const chat=createPublicChat({app:{quickBrowse:()=>[]},knowledge:{evidenceDocuments:()=>[]},catalog:{approvedResources:()=>[{name}],transform:x=>x},
  verifiedDocuments:[{name,sha256:hash}],evidenceSource:source,expert});
 const result=await chat.answer({message:'推荐电脑配置',mode:'expert'});
 assert.equal(result.code,200);assert.match(result.body.reply,/CPU/);assert.equal(reads,1);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('Public firmware search never offers binary body reading or claims compatibility',async()=>{
 const name='R712_V1.0.bin';let read=false;
 const source={search:async()=>({results:[{name,sha256:hash,unitId:unit,bodyParsed:false,kind:'file',compatibilityConfirmed:false}]}),read:async()=>{read=true;throw Error('binary-body-not-available');}};
 const expert={answer:async({execute})=>{const r=await execute('search_evidence',{query:'R712',kind:'firmware'});assert.equal(r.evidence[0].readAvailable,false);assert.equal(r.evidence[0].blockId,undefined);assert.equal(r.evidence[0].compatibilityConfirmed,false);return {reply:'仅找到文件候选，适用性需核对。',results:r.evidence};}};
 const chat=createPublicChat({app:{quickBrowse:()=>[]},knowledge:{evidenceDocuments:()=>[]},catalog:{approvedResources:()=>[{name}],transform:x=>x},verifiedDocuments:[{name,sha256:hash}],evidenceSource:source,expert});
 assert.equal((await chat.answer({message:'查R712固件',mode:'expert'})).code,200);assert.equal(read,false);
});

test('Paragraph transport cannot connect to an external or credential-bearing origin',()=>{
 for(const url of ['https://example.com','http://192.168.1.2','http://u:p@127.0.0.1'])assert.throws(()=>createParagraphEvidence({resourceBase:url,authorizedDocuments:()=>[]}),/loopback/);
});

test('A read parameter unit replaces its earlier search preview during evidence deduplication',()=>{
 const {rank}=require('../adapters/http/quick-retrieval.cjs');
 const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
 const p={modelId:'HD-C2',displayName:'C2',aliases:['C2'],documents:[]};
 const lookup={products:()=>[p],findProducts:q=>String(q).replace(/^HD-/,'')==='C2'?[p]:[],chipLookup:()=>null,softwareItems:()=>[],isSoftware:()=>false};
 const q=parseQuickQuery('C2图层数量有限制吗',lookup),row={name:'C2规格书.pdf',text:'图层数量无限制',modelIds:['HD-C2'],sha256:hash,evidenceId:unit};
 const r=rank(q,[{source:'search-preview',rows:[{...row,type:'passage'}]},{source:'original-read',rows:[{...row,type:'parameter',field:'original-parameter-context'}]}],lookup);
 assert.equal(r.length,1);assert.equal(r[0].candidate.type,'parameter');assert.ok(r[0].sources.has('search-preview'));assert.ok(r[0].sources.has('original-read'));
});

test('An explicit unlimited quantity is answered from a read paragraph without a numeric value',async()=>{
 const {createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
 const p={modelId:'HD-C2',displayName:'C2',aliases:['C2'],parameters:{},documents:[]};
 const lookup={products:()=>[p],findProducts:q=>String(q).replace(/^HD-/,'')==='C2'?[p]:[]};
 const knowledgeUnit={id:unit,kind:'parameter',textBoundary:'native-paragraph-table-or-task;not-visually-reviewed'};
 const row={name:'C2规格书.pdf',text:'支持任意添加图层，无数量限制；',modelIds:['HD-C2'],sha256:hash,evidenceId:unit,unitId:unit,knowledgeUnit};
 const app={quickBrowse:()=>[p],quickResources:()=>({}),quickSearch:()=>({records:[p]}),chipLookup:()=>null,resourceMedia:{softwareItems:()=>[]}};
 const api=createQuickRetrieval({app,knowledge:lookup,search:async()=>({results:[row]}),searchCases:async()=>({results:[]}),searchContext:async()=>[row],readContext:async()=>({text:row.text,knowledgeUnit,contextComplete:true})});
 const r=await api.answer('C2图层数量有限制吗');assert.match(r.reply,/无数量限制/);assert.equal(r.answerType,'parameter-answer');assert.doesNotMatch(r.reply,/未找到/);
});

test('Expert preserves source module ranking instead of reordering by symptom keyword count',async()=>{
 const {createExpertEvidence}=require('../adapters/http/expert-evidence.cjs');
 const rows=[{name:'同模组案例.docx',blockId:1,unitId:'1'.repeat(64),caseMatch:{score:140},proximity:{matchedConcepts:1,spanChars:30}},
  {name:'普通症状案例.docx',blockId:2,unitId:'2'.repeat(64),caseMatch:{score:3},proximity:{matchedConcepts:2,spanChars:10}}].map(r=>({...r,sha256:hash,text:'合成案例',role:'case',knowledgeUnit:{id:r.unitId,sourceSpans:[]}}));
 const tools=createExpertEvidence({roleIndexEnabled:true,roleRequest:async()=>({results:rows}),request:async()=>{throw Error('legacy-called');},searchCases:()=>({results:[]}),caseMap:new Map(),clean:x=>x,location:x=>x});
 const result=await tools.search({query:'合成模组 黑屏',kind:'cases',concepts:['黑屏']});
 assert.equal(result.evidence[0].name,'同模组案例.docx');assert.equal(result.evidence[0].caseMatch.score,140);
});
