'use strict';
// Local search and historical-record browsing. No model or diagnostic state machine.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {searchRecords}=require('../../domain/aftersales/case-search.cjs');
const {createOfflineSessions}=require('./offline-session.cjs');
const {consumeCase}=require('../../domain/aftersales/consume-case.cjs');
const {modelId}=require('../../domain/identity/model-id.cjs');
const clean=s=>String(s||'').replace(/[A-Za-z]:[\\/][^\r\n|<>"']+|\\\\[^\r\n|<>"']+/g,'[内部路径]').replace(/(?<!\d)1[3-9]\d{9}(?!\d)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[联系方式]');
const location=l=>Object.fromEntries(Object.entries(l||{}).filter(([k])=>['page','paragraph','table','row','sheet','slide','section','line','part','charStart','charEnd'].includes(k)).map(([k,v])=>[k,typeof v==='string'?clean(v):v]));
function createOfflineKnowledge({knowledge,resourceBase='http://127.0.0.1:4510',sessionDirectory,logs=null,images=null}={}){
 const sessions=createOfflineSessions(sessionDirectory);
 const base=new URL(resourceBase);if(base.protocol!=='http:'||base.hostname!=='127.0.0.1')throw Error('offline resources require loopback');
 const cases=(knowledge?.cases()||[]).map(c=>consumeCase(c,knowledge.evidenceCaseReviews?.()||[]));
 const caseMap=new Map(cases.map(c=>[c.stableId,c]));
 const knownModels=new Set(cases.flatMap(c=>c.modelIds||[]));
 for(const p of knowledge?.products()||[])knownModels.add(p.modelId);
 const documentLinks=new Map();
 for(const p of knowledge?.products()||[])for(const d of [...p.documents||[],...p.firmware||[]]){
  const url=d.url||d.publicUrl;if(url?.startsWith('/')&&!url.startsWith('//'))documentLinks.set(new URL(url,'http://localhost').pathname,{name:d.name||d.file,sha256:d.sha256||d.sourceReference?.originalSha256});
 }
 const originals=new Set((knowledge?.evidenceDocuments()||[]).map(x=>x.document.sha256));
 const normalize=r=>({name:clean(r.name),resourceId:r.resourceId||null,versionId:r.versionId||null,blockId:r.blockId||null,
  evidenceId:r.sha256&&r.blockId?'blk-'+r.sha256.slice(0,16)+'-'+r.ordinal:null,
  text:clean(/\.csv$/i.test(r.name||'')?String(r.text||'').split(' | ').slice(0,3).join(' | '):r.text),
  locator:location(r.locator),versions:r.versions||[],mentionedModels:r.mentionedModels||[],scopeStatus:'原文提及或目录线索，不代表兼容性确认',
  score:r.score,download:(r.locationId||r.locations?.[0]?.id)?'/v2/offline/file?id='+(r.locationId||r.locations[0].id):null,
  readUrl:r.blockId?'/v2/offline/read?block='+r.blockId:null});
 async function request(route){const r=await fetch(resourceBase+route,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('resource service unavailable');return r.json();}
 async function search(q,mode='all'){
  const raw=await request('/search?q='+encodeURIComponent(q)+'&mode='+mode+'&limit=10');
  return {query:q,elapsedMs:raw.elapsedMs,requestedModels:raw.requestedModels||[],results:(raw.results||[]).map(normalize)};
 }
 const refView=r=>({name:clean(r.originalName||path.basename(String(r.file||'').replace(/\\/g,'/'))),locator:typeof r.locator==='object'?location(r.locator):clean(r.locator),sha256:r.originalSha256||r.sha256||null,
  original:r.originalSha256&&originals.has(r.originalSha256)?'/v2/resources/original/'+r.originalSha256:null,
  originalStatus:r.originalSha256&&originals.has(r.originalSha256)?'registered-original':'original-link-not-established'});
 function caseView(c){return {id:c.stableId,title:clean(c.subCategory||c.phenomenon).slice(0,100),phenomenon:clean(c.phenomenon),modelIds:c.modelIds||[],scope:c.scope||{},
  verificationStatus:c.verificationStatus||'unknown',checks:(c.checks||[]).map(x=>({text:clean(x.text),verificationStatus:x.verificationStatus||'unknown'})),
  historicalMeasure:clean(c.historicalSolution),resultStatus:'历史处理记录不等于当前故障已解决',missingEvidence:clean(c.missingEvidence),
  sourceExcerpt:clean(c.sourceExcerpt),excerptKind:(c.sourceReferences||[]).some(r=>r.originalSha256)?'source-linked-excerpt':'existing-case-index-excerpt',sources:(c.sourceReferences||[]).map(refView),referenceOnly:true};}
 function searchCases(q,model,facts={}){
  const explicit=model?modelId(model):null;
  const known=(q.match(/(?:HD[-_ ]?)?[A-Za-z]+[0-9]+[A-Za-z0-9+-]*/g)||[]).map(modelId).filter(id=>knownModels.has(id));
  const models=explicit?[explicit]:(facts.modelIds?.length?facts.modelIds.map(modelId).filter(Boolean):known);
  const ranked=searchRecords(q,cases,{...facts,...(models.length?{modelIds:models}:{})});
  return {query:q,results:ranked.results.slice(0,10).map(r=>({...caseView(r.case),score:r.score,facts:r.facts,applicability:r.applicability})),total:ranked.results.length,excludedByConditions:ranked.excluded,notApplicable:ranked.excludedRecords,
   note:'历史案例用于核对现象和条件，不是自动诊断结论；请对照型号、版本、芯片与现场条件。'};
 }
 async function caseSearchWithDocuments(q,model,facts={}){const result=searchCases(q,model,facts);
  try{const raw=await search([q,model,...facts.modelIds||[]].filter(Boolean).join(' '),'text');result.rawEvidence=raw.results;}
  catch{result.rawEvidence=[];result.rawEvidenceUnavailable=true;}
  return result;
 }
 async function stream(route,res){
  const r=await fetch(resourceBase+route,{signal:AbortSignal.timeout(120000)});
  const contentType=r.headers.get('content-type')||'application/octet-stream';
  const disposition=r.headers.get('content-disposition')||'attachment';
  res.writeHead(r.status,{'Content-Type':contentType,'Content-Disposition':contentType.startsWith('application/pdf')?disposition.replace(/^attachment/i,'inline'):disposition,'X-Content-Type-Options':'nosniff'});
  if(r.body)for await(const chunk of r.body)res.write(chunk);res.end();
 }
 async function handle(req,res){
  const u=new URL(req.url,'http://localhost'),p=u.pathname;
  const chat=p==='/api/ai/chat';
  const legacy=req.method==='GET'&&documentLinks.has(p);
  const original=req.method==='GET'&&p.startsWith('/v2/resources/original/')&&originals.has(p.split('/').pop());
  const image=p==='/api/ocr',logRoute=p==='/api/huidu/log';
  if(!p.startsWith('/v2/offline/')&&!chat&&!legacy&&!original&&!image&&!logRoute)return false;
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value,(_k,v)=>typeof v==='string'?clean(v):v));return true;};
  const host=req.headers.host;if(req.headers.origin&&req.headers.origin!=='http://'+host)return send(403,{error:'origin-not-allowed'});
  try{
   if(image||logRoute){if(req.method!=='POST')return send(405,{error:'method-not-allowed'});let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(image?15*1024*1024:1024*1024))return send(413,{error:'body-too-large'});chunks.push(chunk);}let b;try{b=JSON.parse(Buffer.concat(chunks));}catch{return send(400,{error:'invalid-json'});}
    if(image)return send(200,images?await images.recognize(b):{ok:false,message:'本地图片识别未配置，请输入文字。'});
    if(!logs)return send(503,{error:'log-store-not-configured'});if(!logs.authorized(req.headers['x-upload-key']))return send(403,{error:'upload-key-required'});return send(200,logs.receive(b));}
   if(req.method==='GET'&&p==='/v2/offline/session'){return send(200,sessions.get(u.searchParams.get('id')));}
   if(req.method==='GET'&&p==='/v2/offline/log-status')return send(200,logs?.status()||{configured:false});
   if(legacy){const d=documentLinks.get(p),raw=await request('/search?q='+encodeURIComponent(d.name)+'&mode=files&limit=10');const file=(raw.results||[]).find(r=>r.kind==='file'&&Number.isInteger(r.locationId)&&r.name===d.name&&(!d.sha256||r.sha256===d.sha256));if(!file)return send(404,{error:'original-not-located',message:'索引中尚未定位此版本原件，请使用资料搜索核对版本。'});await stream('/resource?id='+file.locationId,res);return true;}
   if(original){await stream(p,res);return true;}
   if(req.method==='GET'&&p==='/v2/offline/client.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'public/offline-client.js')));return true;}
   if(req.method==='GET'&&p==='/v2/offline/status')return send(200,{mode:'no-model',knowledgeVersion:knowledge?.version,caseCount:cases.length,sourceService:'local-read-only-index'});
   if(req.method==='GET'&&p==='/v2/offline/file'){
    const id=u.searchParams.get('id');if(!/^\d+$/.test(id||''))return send(400,{error:'invalid-resource'});await stream('/resource?id='+id,res);return true;
   }
   if(req.method==='GET'&&p==='/v2/offline/read'){
    const id=u.searchParams.get('block');if(!/^\d+$/.test(id||''))return send(400,{error:'invalid-block'});
    const raw=await request('/read?block='+id);const csv=(raw.locations||[]).some(l=>/\.csv$/i.test(l.path));
    return send(200,{sha256:raw.sha256,blocks:(raw.blocks||[]).map(b=>({blockId:b.id,locator:location(b.locator),text:clean(csv?b.text.split(' | ').slice(0,3).join(' | '):b.text)}))});
   }
   if(req.method==='GET'&&p==='/v2/offline/case'){
    const c=caseMap.get(u.searchParams.get('id'));return c?send(200,caseView(c)):send(404,{error:'case-not-found'});
   }
   if(req.method==='GET'&&['/v2/offline/search','/v2/offline/cases'].includes(p)){
    const q=(u.searchParams.get('q')||'').trim(),mode=u.searchParams.get('mode')||'all';
    if(!q||q.length>240||!['all','files','text'].includes(mode))return send(400,{error:'invalid-query'});
    return send(200,p.endsWith('/cases')?await caseSearchWithDocuments(q,u.searchParams.get('model')):await search(q,mode));
   }
   if(req.method==='POST'&&chat){
    const kind=req.headers['x-v2-offline-knowledge']||'all';if(!['all','files','text','cases'].includes(kind))return send(400,{error:'invalid-search-mode'});
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)return send(413,{error:'body-too-large'});chunks.push(chunk);}
    let input;try{input=JSON.parse(Buffer.concat(chunks));}catch{return send(400,{error:'invalid-json'});}
    if(typeof input.message!=='string'||!input.message.trim()||input.message.length>240)return send(400,{error:'invalid-query',reply:'请输入240字以内的型号、故障现象或检索词。'});
    let state;try{state=sessions.update(input.sessionId||'anon-'+randomUUID(),input);}catch(e){return send(400,{error:e.message});}
    const query=input.continueQuery===true&&state.messages.length>1?state.messages.slice(-2).map(m=>m.query||m.content).join(' '):input.message;
    const data=kind==='cases'?await caseSearchWithDocuments(query,null,state.facts):await search(query,kind);
    state=sessions.recordResult(state.id,{kind,query,evidenceIds:[...data.results,...data.rawEvidence||[]].map(r=>r.id||r.evidenceId||r.resourceId).filter(Boolean)});
    try{logs?.activity({sessionId:state.id,message:input.message,kind,resultCount:data.results.length});}catch{/* Log storage failure must not discard a completed search. */}
    return send(200,{status:'answer',model:'v2-offline-search',reply:data.results.length?(kind==='cases'?'以下是相关历史记录，请先核对适用条件。':'以下是找到的原始资料及正文。'):data.rawEvidence?.length?'未找到对应结构化案例，以下是相关原文参考。':'未找到匹配记录。请补充完整型号、软件版本或更具体的关键词。',kind,...data,sessionState:state});
   }
   return send(404,{error:'offline-route-not-found'});
  }catch{if(!res.headersSent)return send(503,{error:'resource-service-unavailable',reply:'资料服务暂不可用。产品速查和已有工程配单仍可独立使用。'});res.destroy();return true;}
 }
 return {handle,searchCases};
}
module.exports={createOfflineKnowledge};
