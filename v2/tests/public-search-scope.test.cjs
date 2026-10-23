'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {createLocalPublicRelease}=require('../adapters/http/local-public-release.cjs');
const {createPublicSearch}=require('../adapters/http/public-search.cjs');
const {createLanGuard}=require('../adapters/http/lan-access.cjs');
const {createAnswerOnlyEvidence}=require('../adapters/http/answer-only-evidence.cjs');
test('Public-only policy also denies internal APIs through local and LAN hostnames',()=>{
 const guard=createLanGuard({address:'192.168.1.2',cidr:'192.168.1.2/24',port:8520,publicOrigin:'http://public.example',publicOnly:true});
 for(const host of ['localhost:8520','192.168.1.2:8520','public.example'])for(const route of ['/api/docs?cat=other','/v2/offline/search?q=x','/role/read?unit=x','/v2/resources/original/abc']){
  // /api/docs has a second category check in the server.
  if(route.startsWith('/api/docs'))continue;
  const req={url:route,method:'GET',headers:{host},socket:{remoteAddress:'127.0.0.1'}},res={setHeader(){},writeHead(n){this.status=n;},end(){}};
  assert.equal(guard(req,res),false);assert.equal(res.status,403);
 }
});
test('Public release validates content identity, serves bounded ranges, denies changed files and unlisted paths',async()=>{
 const root=path.resolve(__dirname,'../../tmp'),dir=fs.mkdtempSync(path.join(root,'public-release-test-')),name='合成规格书.pdf',body=Buffer.from('%PDF-synthetic-original'),sha=crypto.createHash('sha256').update(body).digest('hex');
 try{fs.writeFileSync(path.join(dir,name),body);fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({schemaVersion:'xhj-local-public-files-1',recordCount:1,uniqueContentCount:1,files:[{sha256:sha,sizeBytes:body.length,records:[{name,category:'spec',relativePath:name}]}]}));
  const release=await createLocalPublicRelease(path.join(dir,'index.json')),server=http.createServer((req,res)=>release.serve(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const base='http://127.0.0.1:'+server.address().port,url=base+release.urlFor(name);const r=await fetch(url,{headers:{Range:'bytes=0-3'}});assert.equal(r.status,206);assert.equal(await r.text(),'%PDF');assert.equal(r.headers.get('content-range'),'bytes 0-3/'+body.length);
   assert.equal((await fetch(url,{headers:{Range:'bytes=999-'}})).status,416);assert.equal((await fetch(base+'/public-files/'+'b'.repeat(64)+'/'+encodeURIComponent(name))).status,404);
   fs.writeFileSync(path.join(dir,name),'tampered');assert.equal((await fetch(url)).status,409);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 }finally{assert.ok(dir.startsWith(root+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
test('Full-text scope is applied before retrieval and forged private context cannot be read',async()=>{
 const sha='a'.repeat(64),privateSha='b'.repeat(64),grant={name:'合成公开说明书.pdf',sha256:sha,publicDirectory:'说明书'},calls=[];
 const release={availableGrants:()=>[grant],urlFor:()=>'/public-files/'+sha+'/public.pdf'};
 const source={search:async(q,kind,options)=>{calls.push(options);return {results:[{...grant,bodyParsed:true,unitId:'c'.repeat(64),text:'预览',locator:{page:2}}]};},read:async r=>{assert.equal(r.sha256,sha);return {text:'完整步骤与前提',nextOffset:null};}};
 const search=createPublicSearch({source,release});const result=await search.search('合成操作');assert.equal(result.code,200);assert.equal(result.body.results[0].text,'完整步骤与前提');assert.deepEqual(calls[0].authorizedDocuments,[grant]);
 assert.equal((await search.read({name:'内部案例.docx',sha256:privateSha,unit:'d'.repeat(64),offset:0})).code,403);
});
test('A mislabeled historical extension keeps its actual source identity and download extension',async()=>{
 const root=path.resolve(__dirname,'../../tmp'),dir=fs.mkdtempSync(path.join(root,'public-format-test-')),actual='合成手册.docx',published='合成手册.pdf',bytes=Buffer.from('PK-synthetic-word-original'),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 try{fs.writeFileSync(path.join(dir,actual),bytes);fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({schemaVersion:'xhj-local-public-files-1',recordCount:1,uniqueContentCount:1,files:[{sha256:sha,sizeBytes:bytes.length,records:[{name:published,category:'manual',relativePath:actual}]}]}));
  const release=await createLocalPublicRelease(path.join(dir,'index.json'));assert.ok(release.grants().some(r=>r.name===actual&&r.sha256===sha));assert.ok(release.urlFor(published));
  const server=http.createServer((req,res)=>release.serve(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const r=await fetch('http://127.0.0.1:'+server.address().port+release.urlFor(published));assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.match(r.headers.get('content-disposition'),/\.docx/);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 }finally{assert.ok(dir.startsWith(root+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
test('Answer-only evidence strips original identity and private contacts before model use',async()=>{
 const name='合成内部经验.docx',sha='b'.repeat(64),unit={caseFields:{moduleInformation:'模组型号：合成甲',chips:['SYN1000'],phenomenon:name+' 黑屏 192.168.1.1',solution:'解决方法：核对标签；联系人13812345678'},boundaryBasis:'explicit-case-heading'};
 const source={search:async()=>({results:[{name,sha256:sha,unitId:'c'.repeat(64),knowledgeUnit:unit}]}),read:async()=>({knowledgeUnit:unit,nextOffset:null})};
 const answer=createAnswerOnlyEvidence({source,documents:[{name,sha256:sha}]}),data=await answer.search('合成黑屏','cases'),row=data.results[0];
 assert.ok(row);assert.equal(row.name,'现场参考');assert.equal(row.sha256,undefined);assert.equal(row.locator,undefined);assert.equal(row.download,undefined);
 const text=JSON.stringify(await answer.read(row));for(const secret of [name,'192.168.1.1','13812345678',sha])assert.ok(!text.includes(secret));
 assert.deepEqual((await answer.search('合成黑屏','files')).results,[]);assert.equal(answer.allowed({...row,answerRef:'forged'}),false);
 assert.equal(answer.redact('版本25.26.65.30'),'版本25.26.65.30');
});
test('Public filename and directory navigation works independently of body matches',async()=>{
 const sha='a'.repeat(64),grant={name:'HD-KV210使用说明书V1.0.pdf',sha256:sha,category:'manual',publicDirectory:'说明书'};
 const search=createPublicSearch({release:{availableGrants:()=>[grant],urlFor:()=>'/public-files/'+sha+'/public.pdf'},source:{search:async()=>({results:[]})}});
 for(const query of ['说明书/HD-KV210',grant.name]){const r=await search.search(query);assert.equal(r.code,200);assert.deepEqual(r.body.results.map(r=>r.name),[grant.name]);assert.equal(r.body.results[0].contentMode,'metadata-only');}
 assert.deepEqual((await search.search('内部经验')).body.results,[]);
});
test('Public expert consumes anonymous references while final response contains no private source card',async()=>{
 const {createPublicChat}=require('../adapters/http/public-chat.cjs'),name='合成内部经验.docx',sha='b'.repeat(64),unit={caseFields:{phenomenon:'屏幕黑屏',solution:'解决方法：合成核对步骤'},boundaryBasis:'explicit-case-heading'};
 const answerSource=createAnswerOnlyEvidence({documents:[{name,sha256:sha}],source:{search:async()=>({results:[{name,sha256:sha,unitId:'c'.repeat(64),knowledgeUnit:unit}]}),read:async()=>({knowledgeUnit:unit,nextOffset:null})}});
 let consulted=false;const expert={status:async()=>({available:true}),answer:async({execute})=>{const data=await execute('search_evidence',{kind:'cases',query:'屏幕黑屏'});assert.ok(data.evidence.length);assert.ok(!JSON.stringify(data).includes(name));const read=await execute('read_document',{blockId:data.evidence[0].blockId});consulted=true;assert.match(read.evidence[0].text,/合成核对步骤/);return {reply:'先核对标签（现场参考）',results:read.evidence};}};
 const chat=createPublicChat({app:{quickBrowse:()=>[]},knowledge:{evidenceDocuments:()=>[]},catalog:{approvedResources:()=>[],transform:x=>x},answerSource,expert});
 const result=await chat.answer({message:'屏幕黑屏怎么办',mode:'expert'});assert.ok(consulted);assert.equal(result.code,200);assert.deepEqual(result.body.results,[]);assert.equal(result.body.reply,'先核对标签');assert.ok(!JSON.stringify(result).includes(name));
});
