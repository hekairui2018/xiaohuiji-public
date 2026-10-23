'use strict';
// Expert-only source tools. No intent router and no calls to a language model.
const {createHash}=require('node:crypto');
const {fileUrl}=require('./document-preview.cjs');
const synonyms=[['闪烁','闪屏','频闪'],['颜色异常','颜色不正常','偏色','花屏'],['模组','模块'],['Wi-Fi','WIFI','无线'],['搜不到','搜索不到','找不到']];
function proximity(text,concepts){
 const lower=text.toLowerCase(),hits=[];
 for(const [index,c]of concepts.entries())for(const term of new Set([c,...synonyms.find(g=>g.some(x=>c.toLowerCase().includes(x.toLowerCase())))||[]])){
  const pattern=/^[a-z0-9][a-z0-9_.+-]*$/i.test(term)?new RegExp('(?<![a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![a-z0-9])','gi'):null;
  if(pattern){for(const m of lower.matchAll(pattern))hits.push({concept:index,term,start:m.index,end:m.index+m[0].length});}
  else {let at=-1;while((at=lower.indexOf(term.toLowerCase(),at+1))>=0){hits.push({concept:index,term,start:at,end:at+term.length});if(hits.length>1000)break;}}
 }
 hits.sort((a,b)=>a.start-b.start);let best=null;
 for(let i=0;i<hits.length;i++){const within=hits.slice(i).filter(h=>h.start-hits[i].start<=900),coverage=new Set(within.map(h=>h.concept)).size,span=within.at(-1).end-hits[i].start;if(!best||coverage>best.matchedConcepts||coverage===best.matchedConcepts&&span<best.spanChars)best={matchedConcepts:coverage,spanChars:span,hits:within};}
 return best;
}
function createExpertEvidence({request,searchCases,caseMap,clean,location,defaultModels=[],roleIndexEnabled=false,roleRequest}){
 const authorized=new Map(),aliases=new Map(),issued=new Set();let sequence=0;
 const stableId=value=>'evidence-'+createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
 const allowed=args=>{
  if(typeof args.query!=='string'||!args.query.trim()||args.query.length>240)throw Error('expert-invalid-tool');
  const concepts=args.concepts||args.query.split(/[\s，,；;]+/).filter(Boolean).slice(0,6);
  for(const xs of [concepts,args.models||[],args.chips||[]])if(!Array.isArray(xs)||xs.length>6||xs.some(x=>typeof x!=='string'||!x.trim()||x.length>64))throw Error('expert-invalid-tool');
  if(!concepts.length||concepts.some(x=>x.length>32)||args.version!==undefined&&(typeof args.version!=='string'||args.version.length>64))throw Error('expert-invalid-tool');
  if(args.documents!==undefined&&(!Array.isArray(args.documents)||args.documents.length>4||args.documents.some(x=>typeof x!=='string'||!x.trim()||x.length>512)))throw Error('expert-invalid-tool');
  const models=args.models||defaultModels,norm=x=>x.toUpperCase().replace(/^HD[-_ ]?/,'');
  const topical=concepts.filter(c=>!models.some(m=>norm(m)===norm(c)));
  return {concepts:topical.length?topical:concepts,models,chips:args.chips||[]};
 };
 async function search(args){
  const {concepts,models,chips}=allowed(args),kind=args.kind,scope=kind==='resources'||kind==='files'?'text':kind==='products'?'products':kind;
  if(!['cases','text','faq','products','firmware'].includes(scope))throw Error('expert-invalid-tool');
  const candidates=[];
  if(kind==='cases'){
   const found=new Map();
   for(const q of [args.query,...concepts.slice(0,4)])for(const c of searchCases(q,null,{}).results||[])found.set(c.id,c);
   for(const [id,candidate]of found){const raw=caseMap.get(id);if(!raw)continue;
    const known=raw.modelIds||[],normalize=x=>x.toUpperCase().replace(/^HD[-_ ]?/,'');
    if(models.length&&known.length&&!models.some(m=>known.some(k=>normalize(k)===normalize(m))))continue;
    const fields=[raw.sourceExcerpt,raw.historicalSolution,raw.possibleCause,...(raw.checks||[]).map(c=>c.text||c.action)].filter(Boolean);
    const text=[...new Set(fields)].join('\n');const near=proximity(text,concepts);
    if(!near||near.matchedConcepts<Math.min(2,concepts.length))continue;
    const sourceChips=raw.scope?.chips||[],versions=[...raw.scope?.softwareVersions||[],...raw.scope?.firmwareVersions||[]].flatMap(v=>String(v).match(/[Vv]?\d+(?:[.]\d+){2,3}/g)||[]).map(v=>v.replace(/^[Vv]/,''));
    if(chips.length&&sourceChips.length&&!chips.some(c=>sourceChips.includes(c)))continue;
    if(args.version&&versions.length&&!versions.includes(args.version.replace(/^[Vv]/,'')))continue;
    const blockId=1_000_000_000+(++sequence),ref=raw.sourceReferences?.[0]||raw.sourceReference||{},name=ref.file?String(ref.file).split(/[\\/]/).at(-1):candidate.title||'历史案例';
    if(args.documents&&!args.documents.includes(name))continue;
    const start=Math.max(0,near.hits[0].start-180),end=Math.min(text.length,near.hits.at(-1).end+300);
    const e={evidenceId:stableId(['case',id]),blockId,name:clean(name),text:clean(text.slice(start,end)),locator:{section:ref.locator||ref.record||id},modelIds:known,scope:raw.scope||{},verificationStatus:raw.verificationStatus||'unknown',referenceOnly:true,download:'/v2/offline/case?id='+encodeURIComponent(id),
     readAvailable:true,sourceKind:'indexed-case-record',proximity:{...near,contextBoundary:'single-indexed-case',totalContextChars:text.length,excerptStart:start,excerptEnd:end},originalFileLocated:false};
    authorized.set(blockId,{kind:'case',text:clean(text),e});candidates.push(e);
   }
  }
  const params=new URLSearchParams({q:args.query,scope,concepts:JSON.stringify(concepts),models:JSON.stringify(models),chips:JSON.stringify(chips),limit:'4'});if(args.version)params.set('version',args.version);if(args.documents)params.set('documents',JSON.stringify(args.documents));
  let raw,roleUsed=false;
  // In the Python contract an omitted document filter means unrestricted names;
  // [] explicitly permits none. File navigation must also include metadata roles.
  if(roleIndexEnabled&&roleRequest&&!chips.length&&!args.version){try{raw=await roleRequest('/role/search',{q:args.query,role:kind==='files'?'all':({products:'parameter',cases:'case'})[scope]||scope,concepts,models,...(args.documents!==undefined?{documents:args.documents}:{}),limit:4});if(!Array.isArray(raw.results)||raw.results.some(r=>!r.knowledgeUnit?.id||r.unitId!==r.knowledgeUnit.id||!Array.isArray(r.knowledgeUnit.sourceSpans)))throw Error('role-index-invalid');roleUsed=true;}catch{raw=null;}}
  if(!raw)raw=await request('/proximity/search?'+params);
  // The role index has source-bound case boundaries. Do not mix its units with
  // older derived case records whose original boundaries were not verified.
  if(roleUsed&&kind==='cases')candidates.length=0;
  for(const r of raw.results||[]){const id=stableId(roleUsed?['unit',r.sha256,r.unitId]:['passage',r.sha256,r.blockId,r.readAnchor]),loc=r.locations?.[0],readAvailable=Number.isInteger(r.blockId)&&r.blockId>0;
   const e={evidenceId:id,blockId:r.blockId,name:clean(r.name),text:clean(r.text),locator:location(r.locator),modelIds:r.constraints?.mentionedModels||[],scope:r.constraints,verificationStatus:'original-passage-not-compatibility',download:loc?fileUrl(loc.id,r.name):null,readAvailable,sourceKind:roleUsed?'role-index-original':'parsed-original',proximity:r.proximity||{matchedConcepts:0,spanChars:0},readAnchor:r.readAnchor,originalFileLocated:!!loc,...(roleUsed?{knowledgeUnit:r.knowledgeUnit,role:r.role,unitId:r.unitId,sha256:r.sha256}: {})};
   // If two cases share a parsed block, each gets its own authorized read handle.
   const handle=1_000_000_000+(++sequence);e.blockId=handle;
   if(readAvailable)authorized.set(handle,{kind:roleUsed?'role':'original',sourceBlock:r.blockId,anchor:r.readAnchor,e});else e.blockId=null;candidates.push(e);
  }
  candidates.sort((a,b)=>(b.proximity.matchedConcepts-a.proximity.matchedConcepts)||(a.proximity.spanChars-b.proximity.spanChars));
  const selected=candidates.slice(0,4);
  for(const e of selected)if(e.blockId)issued.add(e.blockId);
  for(const e of selected){const source=authorized.get(e.blockId);if(!source||source.kind!=='original')continue;
   for(const id of new Set([source.sourceBlock,...(e.proximity?.hits||[]).map(h=>h.blockId)].filter(Number.isInteger))){const prior=aliases.get(id);if(prior===undefined)aliases.set(id,e.blockId);else if(prior!==e.blockId&&authorized.get(prior)?.e.evidenceId!==e.evidenceId)aliases.set(id,null);}
  }
  for(const e of selected)e.readBlockIds=[e.blockId,...[...aliases].filter(([,handle])=>handle===e.blockId).map(([id])=>id)].filter(Number.isInteger);
  return {intent:kind,notice:{concepts,models,chips,version:args.version||null,candidateCount:raw.candidateCount,searchSemantics:raw.semantics,roleIndexUsed:roleUsed,compatibilityConfirmed:false},evidence:selected};
 }
 async function read(args){
  if(aliases.has(args.blockId)&&aliases.get(args.blockId)===null)throw Error('expert-invalid-tool');
  const handle=issued.has(args.blockId)?args.blockId:aliases.get(args.blockId);
  const source=issued.has(handle)?authorized.get(handle):null;if(!source)return null;
  const offset=args.offset||0;if(!Number.isInteger(offset)||offset<0||offset>100000)throw Error('expert-invalid-tool');
  let text,nextOffset,boundary,parts,totalChars,knowledgeUnit;
  if(source.kind==='case'){if(offset>source.text.length)throw Error('expert-invalid-tool');text=source.text.slice(offset,offset+6000);totalChars=source.text.length;nextOffset=offset+text.length<totalChars?offset+text.length:null;boundary='single-indexed-case';parts=[{locator:source.e.locator,charStart:offset,charEnd:offset+text.length}];}
  else {const raw=source.kind==='role'?await roleRequest('/role/read',{unit:source.e.unitId,offset}):await request('/proximity/read?'+new URLSearchParams({block:String(source.sourceBlock),anchor:String(source.anchor),offset:String(offset)}));
   if(source.kind==='role'){knowledgeUnit=raw.knowledgeUnit;if(knowledgeUnit?.id!==source.e.unitId||knowledgeUnit.kind!==source.e.knowledgeUnit.kind||!require('node:util').isDeepStrictEqual(knowledgeUnit.sourceSpans,source.e.knowledgeUnit.sourceSpans))throw Error('expert-unit-identity-mismatch');}
   text=(raw.blocks||[]).map(b=>clean(b.text)).join('\n');nextOffset=raw.nextOffset;boundary=raw.boundary;parts=(raw.blocks||[]).map(b=>({blockId:b.blockId,locator:location(b.locator),charStart:b.charStart,charEnd:b.charEnd}));totalChars=raw.totalChars;}
  return {intent:'read',notice:{nextOffset:nextOffset??null,totalChars,contextBoundary:boundary},evidence:[{...source.e,...(knowledgeUnit?{knowledgeUnit}:{}),evidenceId:source.e.evidenceId+'-read-'+offset,text,readPerformed:true,readOffset:offset,nextOffset:nextOffset??null,contextBoundary:boundary,contextParts:parts}]};
 }
 return {search,read};
}
module.exports={createExpertEvidence,proximity};
