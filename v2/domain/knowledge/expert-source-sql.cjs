'use strict';
// Read the prepared private databases. No imports, reparsing, or parallel index.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const compact=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9\u3400-\u9fff.]/g,'');
const tokens=s=>[...new Set((String(s).toUpperCase().match(/[A-Z0-9][A-Z0-9._+-]*|[\u3400-\u9fff]+/g)||[]).flatMap(t=>/^[\u3400-\u9fff]+$/.test(t)?Array.from({length:Math.max(1,t.length-1)},(_,i)=>t.slice(i,i+2)):[t]))];
const modulePitches=s=>[...new Set([...String(s).toUpperCase().matchAll(/(?<![A-Z0-9])P(\d+(?:\.\d+)?)(?![A-Z0-9.])/g)].map(m=>Number(m[1])))];

function objectHit(text,anchor){
 if(/^P\d+(?:\.\d+)?$/.test(anchor))return modulePitches(text).includes(Number(anchor.slice(1)));
 const escaped=anchor.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 // Match complete module values; abbreviated numeric chips may match registered manufacturer prefixes.
 const pattern=/^\d/.test(anchor)?'(?<![0-9])'+escaped+'(?![0-9])':'(?<![A-Z0-9])(?:HD[- ]?)?'+escaped.replace(/^HD/,'')+'(?![A-Z0-9]|[.]\\d)';
 return new RegExp(pattern).test(String(text).toUpperCase());
}
function createExpertSourceSql({directory,semanticIndex=null,embed=null}){
 const root=fs.realpathSync(directory),stores=new Map(),resources=new Map();
 const parse=s=>{try{return JSON.parse(s);}catch{return [];}};
 const inside=file=>{const real=fs.realpathSync(file),rel=path.relative(root,real);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('expert-source-path');return real;};
 const url=(family,type,id)=>'/v2/offline/expert-source/'+type+'?'+new URLSearchParams({family,id});
 try{for(const family of ['aftersales','tender']){
  const db=new DatabaseSync(inside(path.join(root,family+'.private.sqlite')),{readOnly:true});db.exec('PRAGMA query_only=ON');
  const rows=db.prepare("SELECT e.*,d.name source_name,d.sha256 source_sha256 FROM entries e JOIN documents d ON d.id=e.document_id WHERE e.kind!='context' OR e.rule IN ('parent-section-context','unattached-product-context')").all();
  const entities=db.prepare('SELECT entry_id,kind,value,basis FROM entry_entities').all(),byEntry=new Map();
  for(const e of entities){const a=byEntry.get(e.entry_id)||[];a.push(e);byEntry.set(e.entry_id,a);}
  for(const r of rows){r.entities=byEntry.get(r.id)||[];r.searchText=compact(r.source_name+' '+(r.category||'')+' '+r.title+' '+r.context_text+' '+r.body);}
  const assetRows=db.prepare('SELECT sha256,path FROM assets').all();
  for(const a of assetRows)resources.set(family+':'+a.sha256,{file:inside(path.join(root,a.path)),sha:a.sha256,name:path.basename(a.path)});
  for(const d of db.prepare('SELECT name,source_path,sha256 FROM documents').all())resources.set(family+':'+d.sha256,{file:d.source_path,sha:d.sha256,name:d.name});
  stores.set(family,{db,rows});
 }}catch(e){for(const s of stores.values())s.db.close();throw e;}
 function get(family,id){const store=stores.get(family),r=store?.rows.find(r=>r.id===id);if(!r)return null;
  const blocks=store.db.prepare('SELECT eb.role,eb.start_char,eb.end_char,eb.sequence,b.locator,b.text FROM entry_blocks eb JOIN blocks b ON b.id=eb.block_id WHERE eb.entry_id=? ORDER BY eb.role,eb.sequence').all(id);
  const assets=store.db.prepare('SELECT DISTINCT a.sha256,b.locator FROM entry_blocks eb JOIN block_assets ba ON ba.block_id=eb.block_id JOIN assets a ON a.id=ba.asset_id JOIN blocks b ON b.id=eb.block_id WHERE eb.entry_id=?').all(id).map(a=>({...a,url:url(family,'file',a.sha256)}));
  return {...r,blocks,assets};
 }
 function project(r,family,match={},offset=0,size=5000){
  const full=r.context_text+'\n\n'+r.body,chunk=full.slice(offset,offset+size),next=offset+chunk.length<full.length?offset+chunk.length:null;
  const original=url(family,'file',r.source_sha256),entryUrl=url(family,'entry',r.id);
  return {evidenceId:'expert-'+family+'-'+r.id,name:r.source_name,title:r.title,text:chunk,sourceKind:family==='tender'?'expert-tender-sql-original':'expert-aftersales-sql-original',sourceFamily:family,sourceEntryId:r.id,
   modelIds:r.entities.filter(e=>e.kind==='model'&&e.basis!=='literal-body-mention').map(e=>e.value),entities:r.entities,locator:{section:r.title,part:r.blocks.map(b=>b.locator).join('; ')},sha256:r.source_sha256,
   download:original,preview:entryUrl,readPerformed:true,readAvailable:true,contextComplete:next===null&&offset===0,nextOffset:next,
   reviewState:r.review_state,outcomeState:r.outcome_state,outcomeEvidence:parse(r.outcome_evidence_json),recommendationVerified:false,entryKind:r.kind,
   caseSemantics:family==='aftersales'?require('../aftersales/case-advice-contract.cjs').caseAdviceContract({stableId:r.id,sourceExcerpt:r.body}):undefined,
   assets:r.assets,match,caseRecord:family==='aftersales'?{title:r.title,conditions:r.context_text,originalText:r.body,outcomeState:r.outcome_state,outcomeEvidence:parse(r.outcome_evidence_json),anchors:r.blocks.map(b=>({role:b.role,locator:b.locator,start:b.start_char,end:b.end_char})),assets:r.assets}:undefined};
 }
 function search(family,query,{models=[],chips=[],limit=3,semanticScores=null,problemDomain='unspecified'}={}){
  if(typeof query!=='string'||!query.trim()||query.length>240)throw Error('expert-invalid-query');
  const store=stores.get(family);if(!store)return [];
  const wordTokens=tokens(query).filter(t=>!['有没有','类似','案例','记录','现场','模组','芯片','客户','问题','查询','查找','请问','怎么','处理'].includes(t));
  const latin=[...new Set([...models,...chips,...(query.toUpperCase().match(/(?:HD[- ]?)?[A-Z]+\d+[A-Z0-9.-]*|\b\d{4,}[A-Z]*\b|\bP\d+(?:\.\d+)?\b/g)||[])].map(s=>compact(String(s).replace(/^HD[-_ ]/i,''))))];
  const relatedFloor=semanticScores?Math.max(0.4,Math.max(...semanticScores.values())-0.08):Infinity;
  const categoryTags=new Set(store.rows.flatMap(r=>tokens((r.category||'')+' '+path.parse(r.source_name).name)).filter(t=>/^[A-Z]{3,}$/.test(t)));
  const requestedCategories=wordTokens.filter(t=>categoryTags.has(t));
  if(!['display','equipment','unspecified'].includes(problemDomain))throw Error('expert-invalid-problem-domain');
  const roles=store.rows.flatMap(r=>r.entities);
  const weights=problemDomain==='display'?{chip:140,module:100,device:60}:problemDomain==='equipment'?{chip:60,module:80,device:140}:{chip:90,module:90,device:90};
  const anchorRoles=new Map(latin.map(a=>[a,/^P\d/.test(a)?'module':roles.some(e=>e.kind==='chip'&&objectHit(e.value,a))?'chip':'device']));
  const role=a=>anchorRoles.get(a);
  const scored=[];
  for(const r of store.rows){
   if(requestedCategories.length&&!requestedCategories.some(t=>objectHit((r.category||'')+' '+r.source_name,t)))continue;
   const explicit=r.entities.filter(e=>e.kind==='chip'&&e.basis!=='literal-body-mention').map(e=>compact(e.value));
   const heading=r.title+' '+r.context_text,body=r.title+' '+r.body;
   const matched=latin.filter(a=>objectHit(body,a)||objectHit(heading,a)&&(!/^\d{4,}/.test(a)||!explicit.length||explicit.some(c=>objectHit(c,a))));
   const recordedPitches=modulePitches(body),differentObjects=latin.filter(a=>/^P\d+(?:\.\d+)?$/.test(a)&&!matched.includes(a)&&recordedPitches.length).map(a=>({requested:a,recorded:recordedPitches.map(p=>'P'+p),basis:'literal-original-module-pitch'}));
   const similarity=semanticScores?.get(r.id)??0,phenomenonRelated=similarity>=relatedFloor;
   const symptomHits=phenomenonRelated?1:0;
   const hits=wordTokens.filter(t=>r.searchText.includes(compact(t))).length;
   if(family==='aftersales'&&latin.length&&!matched.length&&!symptomHits)continue;
   if(!hits&&!matched.length&&!symptomHits)continue;
   const score=matched.reduce((n,a)=>n+weights[role(a)],0)+similarity*120+Math.min(hits,12)+(r.kind==='context'?-20:0);
   scored.push({r,score,match:{objectMatches:matched,differentObjects,unconfirmedObjects:latin.filter(a=>!matched.includes(a)&&!differentObjects.some(d=>d.requested===a)),requestedObjects:latin,semanticRelated:!!symptomHits,phenomenonRelated:null,objectConfirmed:!!matched.length,relation:matched.length?(symptomHits?'对象线索命中、内容相近，现象需核对':'同对象线索，现象需核对'):'内容相近，对象不同或未记录，现象需核对',semanticSimilarity:semanticScores?similarity:null,rankingFocus:problemDomain,objectWeights:weights,allConditionsConfirmed:false}});
  }
  const groups=new Set();let ranked=scored.sort((a,b)=>b.score-a.score||a.r.id.localeCompare(b.r.id)).filter(s=>{if(groups.has(s.r.entry_group))return false;groups.add(s.r.entry_group);return true;});
  if(family==='aftersales'&&semanticScores&&limit>3){
   const primary=ranked.slice(0,limit-2),seen=new Set(primary.map(s=>s.r.entry_group));
   const related=[...ranked].sort((a,b)=>(b.match.semanticSimilarity||0)-(a.match.semanticSimilarity||0)).filter(s=>!seen.has(s.r.entry_group)).slice(0,2);
   ranked=[...primary,...related].sort((a,b)=>b.score-a.score);
  }
  const selected=new Set();return ranked.filter(s=>{if(selected.has(s.r.entry_group))return false;selected.add(s.r.entry_group);return true;}).slice(0,Math.min(6,Math.max(1,limit))).map(s=>project(get(family,s.r.id),family,s.match,0,limit>3?1200:5000));
 }
 function read(record,offset=0){if(!Number.isSafeInteger(offset)||offset<0)throw Error('expert-invalid-offset');const r=get(record.sourceFamily,record.sourceEntryId);if(!r)return null;return project(r,record.sourceFamily,record.match,offset);}
 let vectorManifest=null;const vectorStores=new Map();
 if(semanticIndex){
  vectorManifest=JSON.parse(fs.readFileSync(path.join(semanticIndex,'manifest.private.json'),'utf8'));
  for(const family of stores.keys()){
   const info=vectorManifest.families[family],bytes=fs.readFileSync(path.join(semanticIndex,family+'.f32'));
   const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
   if(hash(bytes)!==info.vectorSha256||hash(fs.readFileSync(path.join(root,family+'.private.sqlite')))!==info.databaseSha256||bytes.length!==info.entries.length*info.dimensions*4)throw Error('expert-source-vector-mismatch');
   vectorStores.set(family,{info,values:new Float32Array(new Uint8Array(bytes).buffer)});
  }
 }
 async function retrieve(family,query,options={}){
  if(!semanticIndex)return search(family,query,options);
  if(typeof embed!=='function')throw Error('expert-source-embedding-unavailable');
  const phenomenonQuery=family==='aftersales'?query.replace(/(?:HD[- ]?)?[A-Z]*[0-9]+[A-Z0-9._+-]*/gi,' ').replace(/\s+/g,' ').trim():query;
  const result=await embed(phenomenonQuery||query),store=vectorStores.get(family);
  if(result.modelSha256!==vectorManifest.modelSha256||!store||result.vector?.length!==store.info.dimensions||result.vector.some(v=>!Number.isFinite(v)))throw Error('expert-source-embedding-mismatch');
  const scores=new Map(),{info,values}=store;
  for(let row=0;row<info.entries.length;row++){let score=0;for(let col=0;col<info.dimensions;col++)score+=result.vector[col]*values[row*info.dimensions+col];scores.set(info.entries[row],Math.max(scores.get(info.entries[row])??-1,score));}
  return search(family,query,{...options,semanticScores:scores});
 }
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function serve(req,res){
  if(req.v2Public||req.method!=='GET'||req.headers?.['sec-fetch-site']==='cross-site'||req.headers?.origin&&req.headers.origin!=='http://'+req.headers.host){res.writeHead(403);res.end();return;}
  const u=new URL(req.url,'http://localhost'),family=u.searchParams.get('family'),id=u.searchParams.get('id');
  if(!stores.has(family)){res.writeHead(404);res.end();return;}
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
  if(u.pathname.endsWith('/entry')){const r=get(family,id);if(!r){res.writeHead(404);res.end();return;}res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'"});res.end('<!doctype html><meta charset="utf-8"><title>'+escape(r.title)+'</title><style>body{max-width:1000px;margin:24px auto;padding:20px;font:16px/1.7 sans-serif}pre{white-space:pre-wrap}img{max-width:100%}</style><h1>'+escape(r.title)+'</h1><p>'+escape(r.source_name)+' · 原文候选，历史处理不代表当前适用</p><pre>'+escape(r.context_text+'\n\n'+r.body)+'</pre>'+r.assets.map(a=>'<p>'+escape(a.locator)+'</p><img alt="原文附件" src="'+escape(a.url)+'">').join(''));return;}
  const item=resources.get(family+':'+id);if(!item||!fs.existsSync(item.file)){res.writeHead(404);res.end();return;}
  const bytes=fs.readFileSync(item.file);if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha){res.writeHead(409);res.end('Source fingerprint changed');return;}
  const ext=path.extname(item.name).toLowerCase(),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.pdf':'application/pdf'}[ext]||'application/octet-stream';
  res.writeHead(200,{...headers,'Content-Type':mime,'Content-Length':bytes.length,'Content-Disposition':(mime.startsWith('image/')?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(item.name)});res.end(bytes);
 }
 return {search,retrieve,read,serve,counts:Object.fromEntries([...stores].map(([k,s])=>[k,{entries:s.rows.filter(r=>r.kind!=='context').length,documents:s.db.prepare('SELECT count(*) n FROM documents').get().n}])),close(){for(const s of stores.values())s.db.close();}};
}
module.exports={createExpertSourceSql};
