'use strict';
// Search facts are evidence projections, never generated fault diagnoses.
const {retrieve}=require('./retrieval.cjs');
const {modelId}=require('../identity/model-id.cjs');
const fields=['modelIds','chips','scans','pitches','softwareVersions','firmwareVersions','hardwareVersions','software','faultScope','temporalPattern','timeRelations','recentOperations','knownNormal','knownAbnormal','deniedInformation'];
const norm=s=>String(s||'').replace(/\s+/g,'').toUpperCase();
function labelled(text,label){return String(text||'').split(/\r?\n/).filter(l=>new RegExp('^(?:'+label+')[：:]').test(l)).map(l=>l.replace(/^[^：:]+[：:]\s*/,''));}
function projectFacts(c){
 const text=c.sourceExcerpt||'',sentences=text.split(/[。\n]/).map(s=>s.trim()).filter(Boolean),scope=c.scope||{};
 const found=patterns=>sentences.filter(s=>patterns.test(s));
 return {originalCustomerExpression:c.originalCustomerExpression||null,phenomenon:c.phenomenon||null,
  modelIds:c.modelIds||[],chips:scope.chips||[],scans:scope.scans||[],pitches:scope.pitches||[],
  softwareVersions:scope.softwareVersions||[],firmwareVersions:scope.firmwareVersions||[],hardwareVersions:scope.hardwareVersions||[],software:labelled(text,'软件'),
  faultScope:found(/局部|部分区域|整屏|全屏/),temporalPattern:found(/间歇|偶发|持续|一直/),
  timeRelations:found(/之前|之后|以后|以前|升级后|更换后|重启后/),recentOperations:[...labelled(text,'最近操作|近期操作'),...found(/最近|刚刚|升级后|更换后|重启后/)],
  knownNormal:labelled(text,'已知正常|正常条件'),knownAbnormal:labelled(text,'已知异常|异常条件'),deniedInformation:labelled(text,'明确否认|已排除|否定信息'),
  checks:(c.checks||[]).map(x=>({text:x.text,verificationStatus:x.verificationStatus||'unknown'})),
  checkResults:labelled(text,'检查结果|排查结果|观察结果'),engineeringJudgement:c.possibleCause||null,
  measures:c.historicalSolution||null,recordedResult:labelled(text,'处理结果|本次结果|最终结果'),
  applicability:scope,notApplicable:labelled(text,'不适用条件|不适用'),dataStatus:c.verificationStatus||'unknown',
  note:'字段仅投影既有记录和明确原文标签；缺项未知。处理结果中的动作描述不等于已恢复。'};
}
function validateFacts(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid-facts');const out={};
 for(const [key,value]of Object.entries(input)){if(!fields.includes(key)||!Array.isArray(value)||value.length>10||value.some(s=>typeof s!=='string'||s.length>100))throw Error('invalid-facts');out[key]=value.map(s=>s.trim()).filter(Boolean);}
 return out;
}
function searchRecords(query,cases,facts={}){
 facts=validateFacts(facts);const models=(facts.modelIds||[]).map(modelId).filter(Boolean);
 // Lexical recall may use the complete original request. Conditions are checked separately.
 const ranked=retrieve({symptoms:[query],providedDevices:[]},cases);let excluded=0;const excludedRecords=[];
 const results=[];
 for(const r of ranked){
  const evidence=projectFacts(r.case),conflicts=[],missing=[],matches=[];
  for(const key of ['modelIds','chips','scans','pitches','softwareVersions','firmwareVersions','hardwareVersions','software']){
   const requested=key==='modelIds'?models:facts[key]||[];if(!requested.length)continue;
   const known=evidence[key]||[];
   if(!known.length){missing.push(key);continue;}
   if(!requested.some(v=>known.some(k=>norm(k)===norm(v))))conflicts.push(key);else matches.push(key);
  }
  // These are explicit, caller-provided descriptions, not interpretations of words like 闪屏.
  for(const key of ['faultScope','temporalPattern','timeRelations','recentOperations','knownNormal','knownAbnormal']){
   const category=(s)=>/不是|并非|否认/.test(s)?null:key==='faultScope'?/局部|部分区域/.test(s)?'local':/整屏|全屏/.test(s)?'whole':null:key==='temporalPattern'?/间歇|偶发/.test(s)?'intermittent':/持续|一直/.test(s)?'persistent':null:null;
   for(const value of facts[key]||[]){const wanted=category(value),recorded=(evidence[key]||[]).map(category).filter(Boolean);
    if(wanted&&recorded.length&&!recorded.includes(wanted))conflicts.push(key);
    else if((evidence[key]||[]).some(s=>norm(s).includes(norm(value)))||wanted&&recorded.includes(wanted))matches.push(key);else missing.push(key);}
  }
  for(const denied of facts.deniedInformation||[]){
   // Exclude only a recorded cause/required condition, never an arbitrary mention in checks.
   if([evidence.engineeringJudgement,...(r.case.scope?.additionalConditions||[])].filter(Boolean).some(s=>norm(s)===norm(denied)))conflicts.push('explicit-denial');
   else missing.push('denial-not-confirmed-in-record');
  }
  if(conflicts.length){excluded++;excludedRecords.push({id:r.case.stableId,status:'not-applicable',conflictingFields:[...new Set(conflicts)]});continue;}
  const needs=[...new Set([...missing,...['modelIds','chips','scans','softwareVersions'].filter(k=>!(evidence[k]||[]).length)])];
  results.push({...r,score:r.score+matches.length*10,facts:evidence,applicability:{status:needs.length?'conditional-reference':'direct-reference',matchedFields:[...new Set(matches)],missingFields:needs,notDiagnosis:true}});
 }
 results.sort((a,b)=>b.score-a.score||a.case.stableId.localeCompare(b.case.stableId));
 return {results,excluded,excludedRecords,queryFacts:facts};
}
module.exports={projectFacts,validateFacts,searchRecords};
