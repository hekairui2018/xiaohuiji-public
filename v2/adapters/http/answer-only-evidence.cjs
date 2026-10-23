'use strict';
const {randomUUID}=require('node:crypto');
// Q&A-only projections. Original identity/path/locators never reach a model or browser.
function createAnswerOnlyEvidence({source,documents}){
 const handles=new Map(),names=documents.map(r=>r.name);
 const redact=value=>{let text=String(value||'');for(const name of names)text=text.split(name).join('').split(name.replace(/\.[^.]+$/,'')).join('');
  return text.replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n|<>"']+|\\\\[^\r\n|<>"']+/g,'').replace(/https?:\/\/\S+|\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|127\.0)\.\d{1,3}\.\d{1,3}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)/gi,'[已隐藏]');};
 function project(raw,context){
  const unit=context?.knowledgeUnit||raw.knowledgeUnit,fields=unit?.caseFields||unit?.faqFields;
  if(!fields||unit.boundaryBasis?.includes('prefix-not-record'))return null;
  const text=unit.caseFields?[fields.moduleInformation,fields.chips?.join('、'),fields.phenomenon,fields.solution].filter(Boolean).join('\n'):[fields.question,fields.siteInformation,fields.answer].filter(Boolean).join('\n');
  if(!text.trim()||unit.caseFields&&!fields.solution)return null;
  const key=raw.answerRef||randomUUID();
  if(!handles.has(key)){handles.set(key,raw);if(handles.size>500)handles.delete(handles.keys().next().value);}
  return {name:'现场参考',answerOnly:true,answerRef:key,unitId:key,evidenceId:'reference-'+key,role:'reference',kind:'passage',bodyParsed:true,
   text:redact(text),modelIds:raw.mentionedModels||[],sourceKind:'indexed-case-record',referenceOnly:true,compatibilityConfirmed:false,
   knowledgeUnit:{complete:false,bodyParsed:true,caseMatch:raw.caseMatch},readAvailable:true,readPerformed:!!context,
   ...(context?{nextOffset:context.nextOffset,totalChars:context.totalChars}:{}),sourceStatus:'conditional-reference'};
 }
 async function search(query,kind,options={}){
  if(!['cases','faq'].includes(kind))return {results:[]};
  const data=await source.search(query,kind,{...options,limit:4});
  return {results:data.results.map(r=>project(r)).filter(Boolean)};
 }
 async function read(row,options){const raw=handles.get(row.answerRef);if(!raw)throw Error('reference-not-authorized');const data=await source.read(raw,options);return project({...raw,answerRef:row.answerRef},data);}
 return {search,read,redact,allowed:row=>!!row.answerOnly&&handles.has(row.answerRef)};
}
module.exports={createAnswerOnlyEvidence};
