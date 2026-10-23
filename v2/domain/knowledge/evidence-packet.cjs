'use strict';
const {createHash}=require('node:crypto');

// This module does not search or decide public approval. Only the caller's
// request-scoped authorize/read capabilities can turn a candidate into evidence.
// In particular, a search hit or a quick answer is never an already-read fact.
const strings=(value,max=16)=>Array.isArray(value)?value.filter(v=>typeof v==='string').map(v=>v.slice(0,240)).slice(0,max):[];
const privatePath=s=>typeof s==='string'&&(/(?:^|\s)[A-Za-z]:[\\/]|\\\\|file:\/\//i.test(s)||/^\/(?:home|root|tmp|mnt|Users)\//i.test(s));
const safeText=(s,max=600)=>typeof s==='string'&&!privatePath(s)?s.slice(0,max):undefined;
const token=s=>typeof s==='string'&&/^[\w.:-]{1,180}$/.test(s)?s:undefined;
const locatorKeys=['page','paragraph','slide','row','sheet','section','line','table','heading'];
function locator(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const result={};for(const k of locatorKeys){const v=value[k];if(Number.isFinite(v))result[k]=v;else if(safeText(v,240)!==undefined)result[k]=safeText(v,240);}
 return Object.keys(result).length?result:undefined;
}
const conditionKeys=new Set(['modelId','models','mentionedModels','requestedModels','software','chips','versions','hardwareVersions','firmwareVersions','softwareVersions','additionalConditions','topology','faultScope','kind','value','name','field','unit','status','reason','question','scope','module','screen','cabinet','requirements','providedDevices','environment','controlMode','architecture','pitchMm','physicalWidthMm','physicalHeightMm','pixelWidth','pixelHeight','moduleColumns','moduleRows','columns','rows','scan','numerator','denominator','interface','color','r','g','b','driverFamily','controllerFamily','hdmiOut','posterScreen','meetingScreen','c16Sharing','communication','count','quantity','role']);
function conditions(value,depth=0){
 if(depth>6)return undefined;
 if(typeof value==='string')return safeText(value,600);
 if(typeof value==='boolean'||Number.isFinite(value))return value;
 if(Array.isArray(value))return value.slice(0,32).map(v=>conditions(v,depth+1)).filter(v=>v!==undefined);
 if(!value||typeof value!=='object')return undefined;
 const result={};for(const k of Object.keys(value)){if(conditionKeys.has(k)){const v=conditions(value[k],depth+1);if(v!==undefined)result[k]=v;}else if(k==='path'&&typeof value[k]==='string'&&/^\/(?:module|screen|cabinet|requirements|environment|controlMode|architecture|providedDevices)(?:\/[A-Za-z0-9_-]+)*$/.test(value[k]))result.path=value[k];}
 return result;
}
function unit(value){
 if(!value||typeof value!=='object')return undefined;
 const result={};for(const k of ['id','documentId','kind','role','heading','title','textBoundary','boundaryBasis']){const v=safeText(value[k],500);if(v!==undefined)result[k]=v;}
 for(const k of ['complete','bodyParsed','visualContextRequired'])if(typeof value[k]==='boolean')result[k]=value[k];
 for(const k of ['subjects','models','mentionedModels'])if(Array.isArray(value[k]))result[k]=strings(value[k]).filter(v=>!privatePath(v));
 if(Array.isArray(value.sourceSpans))result.sourceSpans=value.sourceSpans.slice(0,24).map(s=>({...(safeText(s.role,60)?{role:s.role}:{}),...(locator(s.locator)?{locator:locator(s.locator)}:{}),...(Number.isInteger(s.charStart)?{charStart:s.charStart}:{}),...(Number.isInteger(s.charEnd)?{charEnd:s.charEnd}:{})}));
 return result;
}
function parts(values){return (Array.isArray(values)?values:[]).slice(0,80).map(v=>({...(locator(v.locator)?{locator:locator(v.locator)}:{}),...(Number.isInteger(v.charStart)?{charStart:v.charStart}:{}),...(Number.isInteger(v.charEnd)?{charEnd:v.charEnd}:{}),...(Number.isInteger(v.textStart)?{textStart:v.textStart}:{}),...(Number.isInteger(v.textEnd)?{textEnd:v.textEnd}:{})}));}
const metadataOnly=r=>r.kind==='file'||r.type==='document'&&r.bodyParsed!==true||r.bodyParsed===false||r.sourceStatus==='registered-metadata-only'||/metadata-only/.test(r.verificationStatus||'')||/\.(?:bin|exe|msi|apk|zip|rar|7z|mp4|avi|mov|mp3|wav)$/i.test(r.name||'');
const rawPrivateCase=r=>(r.role==='case'||r.sourceKind==='indexed-case-record')&&r.answerOnly!==true;
function identityConflict(row,page){
 for(const k of ['name','sha256','unitId'])if(row[k]!==undefined&&page[k]!==undefined&&row[k]!==page[k])return true;
 if(row.unitId&&page.knowledgeUnit?.id&&row.unitId!==page.knowledgeUnit.id)return true;
 if(row.sha256&&page.knowledgeUnit?.documentId&&row.sha256!==page.knowledgeUnit.documentId)return true;
 return false;
}
function projection(row,id){
 const anonymous=row.answerOnly===true;
 const result={evidenceId:id,name:safeText(row.name,300)||'已授权参考',modelIds:strings(row.modelIds?.length?row.modelIds:row.mentionedModels).filter(v=>!privatePath(v)),compatibilityConfirmed:false};
 for(const k of ['sourceKind','verificationStatus','role','kind','category','contextBoundary','sourceStatus']){const v=safeText(row[k],160);if(v!==undefined)result[k]=v;}
 if(token(row.unitId))result.unitId=row.unitId;
 if(Number.isInteger(row.blockId))result.blockId=row.blockId;
 if(anonymous){result.name='现场参考';result.answerOnly=true;result.referenceOnly=true;if(token(row.answerRef))result.answerRef=row.answerRef;}
 else {if(/^[a-f0-9]{64}$/.test(row.sha256||''))result.sha256=row.sha256;const loc=locator(row.locator);if(loc)result.locator=loc;}
 if(row.referenceOnly===true)result.referenceOnly=true;
 const scope=conditions(row.scope);if(scope!==undefined)result.scope=scope;
 const ku=unit(row.knowledgeUnit);if(ku){if(anonymous){delete ku.documentId;delete ku.id;delete ku.sourceSpans;}result.knowledgeUnit=ku;}
 return result;
}

async function buildEvidencePacket({question={},resolution={},authorize,read,limit=4}={}){
 if(typeof authorize!=='function'||typeof read!=='function')throw Error('evidence-packet-requires-capabilities');
 if(!Number.isInteger(limit)||limit<1||limit>8)throw Error('evidence-packet-invalid-limit');
 const ordering=resolution.quickContext?.ordering||question.orderingContext;
 const missing=[...new Set([...strings(question.decision?.missing),...strings(question.missing),...(ordering?.pending||[]).map(p=>safeText(p.question||p.path,300)).filter(Boolean)])];
 const packet={version:1,question:{text:String(question.original||question.text||question.query||'').slice(0,4000),intent:safeText(question.intent,60)||'unknown',models:strings(question.models),software:strings(question.software),confirmed:conditions(question.confirmed||ordering?.confirmed)||{},assumptions:conditions(resolution.result?.assumptions||question.assumptions||[])||[],missing},evidence:[],outcome:'not-retrieved',gaps:[]};
 const gap=(code,extra={})=>packet.gaps.push({code,...extra});
 const permitted=async row=>{try{return await authorize(row)===true;}catch{return false;}};
 const failures=Array.isArray(resolution.sourceFailures)?resolution.sourceFailures.length:0;
 if(failures)gap('source-search-failed',{count:failures});
 const candidates=Array.isArray(resolution.results)?resolution.results:[];
 const seen=new Set(),usedIds=new Set();let approvedCount=0,unparsed=false;
 for(const row of candidates){
  if(packet.evidence.length>=limit)break;
  if(!row||typeof row!=='object')continue;
  if(rawPrivateCase(row)){gap('raw-case-not-permitted');continue;}
  let authorized=false;try{authorized=await authorize(row)===true;}catch{gap('authorization-unavailable');}
  if(!authorized)continue;
  const key=JSON.stringify([row.answerOnly?row.answerRef:row.sha256,row.unitId||row.evidenceId||row.blockId||row.name]);
  if(seen.has(key))continue;seen.add(key);approvedCount++;
  let id=token(row.evidenceId)||'prepared-'+createHash('sha256').update(key).digest('hex').slice(0,24);
  if(usedIds.has(id))id+='-'+createHash('sha256').update(key).digest('hex').slice(0,12);
  usedIds.add(id);
  if(metadataOnly(row)){
   // Approval grants a file identity, not binary content or compatibility.
   let stillAllowed=false;try{stillAllowed=await authorize(row)===true;}catch{}
   if(!stillAllowed){gap('authorization-revoked');continue;}
   packet.evidence.push({...projection(row,id),text:'',excerpt:'',metadataOnly:true,sourceKind:'file-metadata',readPerformed:false,readAvailable:false,nextOffset:null,contextComplete:false,unitComplete:null,visualRequired:false,verificationStatus:'authorized-file-metadata-only'});
   unparsed=true;continue;
  }
  const pages=[];let offset=0,nextOffset=null,complete=false,rejected=false,readFailed=false;
  for(let pageNumber=0;pageNumber<2;pageNumber++){
   let page;
   try{
    if(!await permitted(row)){gap('authorization-revoked');rejected=true;break;}
    page=await read(row,{offset});
    if(!page||typeof page!=='object'||typeof page.text!=='string')throw Error('invalid-read');
    if(identityConflict(row,page)||pages.length&&identityConflict({...row,...pages[0]},page)){gap('source-identity-conflict');rejected=true;break;}
    if(rawPrivateCase(page)||page.knowledgeUnit?.caseFields&&page.answerOnly!==true){gap('raw-case-not-permitted');rejected=true;break;}
    if(!await permitted({...row,...page})){gap('authorization-revoked');rejected=true;break;}
   }catch{gap('source-read-failed',{evidenceId:id});readFailed=true;break;}
   if(!page.text.trim()){gap('body-not-parsed',{evidenceId:id});unparsed=true;break;}
   const full=typeof page.originalContext==='string'&&page.originalContext? page.originalContext:typeof page.applicabilityText==='string'&&page.applicabilityText?page.applicabilityText:page.text;
   // Oversized reads must be paginated by the source adapter. Do not truncate a
   // prerequisite or an exception while marking the resulting text complete.
   if(full.length>24000){gap('read-page-exceeds-budget',{evidenceId:id});readFailed=true;break;}
   pages.push({...page,text:full});
   nextOffset=page.nextOffset;
   complete=nextOffset===null||nextOffset===undefined&&page.contextComplete===true;
   if(complete){nextOffset=null;break;}
   if(!Number.isInteger(nextOffset)||nextOffset<=offset||nextOffset>10000000){gap('read-pagination-invalid',{evidenceId:id});readFailed=true;nextOffset=null;break;}
   offset=nextOffset;
  }
  if(rejected||!pages.length)continue;
  // Native identity must remain stable even when the initial search row had no
  // unit identifier. Two independent paragraphs must never become one workflow.
  const nativeIds=new Set(pages.map(p=>p.unitId||p.knowledgeUnit?.id).filter(Boolean));
  if(nativeIds.size>1){gap('source-unit-conflict',{evidenceId:id});continue;}
  const last=pages.at(-1),merged={...row,...last},calculation=merged.sourceKind==='validated-ordering-calculation';
  if(calculation&&last.verificationStatus!=='geometry-and-static-rule-checked'){gap('calculation-not-ready',{evidenceId:id});continue;}
  const text=pages.map(p=>p.text).join('\n');
  let excerpt=typeof row.text==='string'&&text.includes(row.text)?row.text:pages[0].text;
  if(typeof last.excerpt==='string'&&text.includes(last.excerpt))excerpt=last.excerpt;
  const unitComplete=typeof merged.knowledgeUnit?.complete==='boolean'?merged.knowledgeUnit.complete:null;
  const visualRequired=pages.some(p=>p.knowledgeUnit?.visualContextRequired===true||p.visualContextRequired===true||p.visualRequired===true);
  const item={...projection(merged,id),text,excerpt,metadataOnly:false,readPerformed:true,readAvailable:!complete&&Number.isInteger(nextOffset),nextOffset:complete?null:nextOffset??null,contextComplete:complete&&!readFailed,unitComplete,visualRequired,readPageCount:pages.length,contextParts:merged.answerOnly?[]:parts((()=>{let start=0;return pages.flatMap(p=>{const offset=start;start+=p.text.length+1;return (p.contextParts||[]).map(part=>({...part,...(Number.isInteger(part.textStart)?{textStart:part.textStart+offset,textEnd:part.textEnd+offset}:{})}));});})())};
  // No compatibility assertion can be promoted just because a file was read.
  if(!item.verificationStatus)item.verificationStatus=calculation?'geometry-and-static-rule-checked':'authorized-source-read';
  if(!item.sourceKind)item.sourceKind='authorized-original-text';
  packet.evidence.push(item);
  if(!item.contextComplete)gap('context-incomplete',{evidenceId:id,...(Number.isInteger(item.nextOffset)?{nextOffset:item.nextOffset}:{})});
  if(unitComplete===false)gap('native-unit-incomplete',{evidenceId:id});
  if(visualRequired)gap('visual-context-required',{evidenceId:id});
 }
 const needsInput=missing.length>0||['clarify','needs-input'].includes(resolution.status);
 const body=packet.evidence.filter(e=>!e.metadataOnly),files=packet.evidence.filter(e=>e.metadataOnly);
 if(needsInput){packet.outcome='needs-input';const clarification=safeText(resolution.question||resolution.reply,1000);if(clarification)packet.clarification=clarification;}
 else if(body.length)packet.outcome=packet.gaps.length?'partial':'answerable';
 else if(files.length&&['resources','files','firmware','software'].includes(question.intent))packet.outcome=packet.gaps.length?'partial':'answerable';
 else if(failures||packet.gaps.some(g=>g.code==='source-read-failed'))packet.outcome='search-failed';
 else if(unparsed)packet.outcome='unparsed';
 else if(!candidates.length&&resolution.status==='not-found'&&['resources','files','firmware','software'].includes(question.intent)&&resolution.catalogCoverage?.complete===true&&safeText(resolution.catalogCoverage.scope,500)){
  packet.outcome='no-record';packet.catalogScope=safeText(resolution.catalogCoverage.scope,500);
 }else packet.outcome='not-retrieved';
 if(!packet.evidence.length&&!packet.gaps.length&&packet.outcome==='not-retrieved')gap('no-qualified-evidence');
 packet.candidateCount=candidates.length;packet.authorizedCandidateCount=approvedCount;
 return packet;
}
module.exports={buildEvidencePacket};
