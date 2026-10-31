'use strict';
// Expert-only source tools. No intent router and no calls to a language model.
const {createHash}=require('node:crypto');
const {fileUrl}=require('./document-preview.cjs');
const synonyms=[['闪烁','闪屏','频闪'],['颜色异常','颜色不正常','偏色','花屏'],['模组','模块'],['Wi-Fi','WIFI','无线'],['搜不到','搜索不到','找不到']];
function platformConflict(request,source){
 const platforms=text=>[/(?:\bandroid\b|安卓)/i.test(text)?'android':null,/(?:\bios\b|\biphone\w*|\bipad\w*|苹果)/i.test(text)?'ios':null].filter(Boolean);
 const wanted=platforms(request),known=platforms(source);return wanted.length===1&&known.length>0&&!known.includes(wanted[0]);
}
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
function createExpertEvidence({request,searchCases,caseMap,clean,location,defaultModels=[],customerMessage=''}){
 const {componentPairs,coversComponentPair}=require('../../domain/parser/component-pair.cjs'),customerPairs=componentPairs(customerMessage);
 const authorized=new Map(),aliases=new Map(),issued=new Set();let sequence=0;
 const stableId=value=>'evidence-'+createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
 const allowed=args=>{
  if(typeof args.query!=='string'||!args.query.trim()||args.query.length>240)throw Error('expert-invalid-tool');
  const concepts=args.concepts||args.query.split(/[\s，,；;]+/).filter(Boolean).slice(0,6);
  for(const xs of [concepts,args.models||[],args.chips||[]])if(!Array.isArray(xs)||xs.length>6||xs.some(x=>typeof x!=='string'||!x.trim()||x.length>64))throw Error('expert-invalid-tool');
  if(!concepts.length||concepts.some(x=>x.length>32)||args.version!==undefined&&(typeof args.version!=='string'||args.version.length>64))throw Error('expert-invalid-tool');
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
    const text=[...new Set(fields)].join('\n');
    if(platformConflict(customerMessage||args.query,text))continue;
    if(!coversComponentPair(text+'\n'+(raw.scope?.chips||[]).join(' '),customerPairs))continue;
    const near=proximity(text,concepts);
    if(!near||near.matchedConcepts<Math.min(2,concepts.length))continue;
    const sourceChips=raw.scope?.chips||[],versions=[...raw.scope?.softwareVersions||[],...raw.scope?.firmwareVersions||[]].flatMap(v=>String(v).match(/[Vv]?\d+(?:[.]\d+){2,3}/g)||[]).map(v=>v.replace(/^[Vv]/,''));
    if(chips.length&&sourceChips.length&&!chips.some(c=>sourceChips.includes(c)))continue;
    if(args.version&&versions.length&&!versions.includes(args.version.replace(/^[Vv]/,'')))continue;
    const blockId=1_000_000_000+(++sequence),ref=raw.sourceReferences?.[0]||raw.sourceReference||{},name=ref.file?String(ref.file).split(/[\\/]/).at(-1):candidate.title||'历史案例';
    if(args.documents&&!args.documents.includes(name))continue;
    const start=Math.max(0,near.hits[0].start-180),end=Math.min(text.length,near.hits.at(-1).end+300);
    const e={evidenceId:stableId(['case',id]),blockId,name:clean(name),text:clean(text.slice(start,end)),locator:{section:ref.locator||ref.record||id},modelIds:known,scope:raw.scope||{},verificationStatus:raw.verificationStatus||'unknown',referenceOnly:true,download:'/v2/offline/case?id='+encodeURIComponent(id),
     readAvailable:true,sourceKind:'indexed-case-record',caseSemantics:require('../../domain/aftersales/case-advice-contract.cjs').caseAdviceContract(raw),proximity:{...near,contextBoundary:'single-indexed-case',totalContextChars:text.length,excerptStart:start,excerptEnd:end},originalFileLocated:false};
    authorized.set(blockId,{kind:'case',text:clean(text),e});candidates.push(e);
   }
  }
  const params=new URLSearchParams({q:args.query,scope,concepts:JSON.stringify(concepts),models:JSON.stringify(models),chips:JSON.stringify(chips),limit:'4'});if(args.version)params.set('version',args.version);if(args.documents)params.set('documents',JSON.stringify(args.documents));
  const raw=await request('/proximity/search?'+params);
  for(const r of raw.results||[]){const id=stableId(['passage',r.sha256,r.blockId,r.readAnchor]),loc=r.locations?.[0];
   if(kind==='cases'&&(platformConflict(customerMessage||args.query,r.text)||!coversComponentPair(r.text+'\n'+(r.constraints?.chips||[]).join(' '),customerPairs)))continue;
   const e={evidenceId:id,blockId:r.blockId,name:clean(r.name),text:clean(r.text),locator:location(r.locator),modelIds:r.constraints?.mentionedModels||[],scope:r.constraints,verificationStatus:'original-passage-not-compatibility',download:loc?fileUrl(loc.id,r.name):null,readAvailable:true,sourceKind:'parsed-original',proximity:r.proximity,readAnchor:r.readAnchor,originalFileLocated:!!loc};
   // If two cases share a parsed block, each gets its own authorized read handle.
   const handle=1_000_000_000+(++sequence);e.blockId=handle;
   authorized.set(handle,{kind:'original',sourceBlock:r.blockId,anchor:r.readAnchor,e});candidates.push(e);
  }
  candidates.sort((a,b)=>(b.proximity.matchedConcepts-a.proximity.matchedConcepts)||(a.proximity.spanChars-b.proximity.spanChars));
  const selected=candidates.slice(0,4);
  for(const e of selected)issued.add(e.blockId);
  for(const e of selected){const source=authorized.get(e.blockId);if(source.kind!=='original')continue;
   for(const id of new Set([source.sourceBlock,...(e.proximity?.hits||[]).map(h=>h.blockId)].filter(Number.isInteger))){const prior=aliases.get(id);if(prior===undefined)aliases.set(id,e.blockId);else if(prior!==e.blockId&&authorized.get(prior)?.e.evidenceId!==e.evidenceId)aliases.set(id,null);}
  }
  for(const e of selected)e.readBlockIds=[e.blockId,...[...aliases].filter(([,handle])=>handle===e.blockId).map(([id])=>id)];
  return {intent:kind,notice:{concepts,models,chips,version:args.version||null,candidateCount:raw.candidateCount,searchSemantics:raw.semantics,compatibilityConfirmed:false},evidence:selected};
 }
 async function read(args){
  if(aliases.has(args.blockId)&&aliases.get(args.blockId)===null)throw Error('expert-invalid-tool');
  const handle=issued.has(args.blockId)?args.blockId:aliases.get(args.blockId);
  const source=issued.has(handle)?authorized.get(handle):null;if(!source)return null;
  const offset=args.offset||0;if(!Number.isInteger(offset)||offset<0||offset>100000)throw Error('expert-invalid-tool');
  let text,nextOffset,boundary,parts,totalChars,readSegments;
  if(source.kind==='case'){if(offset>source.text.length)throw Error('expert-invalid-tool');text=source.text.slice(offset,offset+6000);totalChars=source.text.length;nextOffset=offset+text.length<totalChars?offset+text.length:null;boundary='single-indexed-case';parts=[{locator:source.e.locator,charStart:offset,charEnd:offset+text.length}];}
  else {const raw=await request('/proximity/read?'+new URLSearchParams({block:String(source.sourceBlock),anchor:String(source.anchor),offset:String(offset)}));const blocks=raw.blocks||[];text=blocks.map(b=>clean(b.text)).join('\n');let position=0;readSegments=blocks.map(b=>{const length=clean(b.text).length,segment={blockId:b.blockId,locator:location(b.locator),charStart:b.charStart,charEnd:b.charEnd,textStart:position,textEnd:position+length};position+=length+1;return segment;});nextOffset=raw.nextOffset;boundary=raw.boundary;parts=readSegments.map(({textStart,textEnd,...part})=>part);totalChars=raw.totalChars;}
  return {intent:'read',notice:{nextOffset:nextOffset??null,totalChars,contextBoundary:boundary},evidence:[{...source.e,evidenceId:source.e.evidenceId+'-read-'+offset,text,readPerformed:true,readOffset:offset,nextOffset:nextOffset??null,contextBoundary:boundary,contextParts:parts,...(readSegments?{readSegments}:{})}]};
 }
 return {search,read};
}
module.exports={createExpertEvidence,proximity};
