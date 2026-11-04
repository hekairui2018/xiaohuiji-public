'use strict';
// Only complete answer fields are visible. Never expose tool JSON or reasoning.
function endValue(text,start){
 let quoted=false,escape=false,depth=0;
 for(let i=start;i<text.length;i++){
  const c=text[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"'){quoted=false;if(depth===0)return i+1;}continue;}
  if(c==='"'){quoted=true;continue;}if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){if(--depth===0)return i+1;}else if(depth===0&&/[,}\s]/.test(c))return i;
 }return -1;
}
function completeArray(text,start){
 const items=[];let at=start+1;
 while(at<text.length){while(/[\s,]/.test(text[at]||'')&&at<text.length)at++;if(text[at]===']')return items;const end=endValue(text,at);if(end<0)break;try{items.push(JSON.parse(text.slice(at,end)));}catch{break;}at=end;}
 return items;
}
function answerParts(text){
 if(typeof text!=='string'||text.length>200000)return null;let at=0;while(/\s/.test(text[at]||'')&&at<text.length)at++;if(text[at++]!=='{')return null;
 const fields={};
 while(at<text.length){
  while(/[\s,]/.test(text[at]||'')&&at<text.length)at++;if(text[at]!=='"')break;const keyEnd=endValue(text,at);if(keyEnd<0)break;let key;try{key=JSON.parse(text.slice(at,keyEnd));}catch{break;}
  at=keyEnd;while(/\s/.test(text[at]||'')&&at<text.length)at++;if(text[at++]!==':')break;while(/\s/.test(text[at]||'')&&at<text.length)at++;
  const end=endValue(text,at);if(end<0){if(text[at]==='[')fields[key]=completeArray(text,at);break;}
  try{if(Object.hasOwn(fields,key))return null;fields[key]=JSON.parse(text.slice(at,end));}catch{break;}at=end;
 }
 return fields.action==='answer'?fields:null;
}
function answerPreview(content,{packet,evidence,message='',history=[],models=[],allowGeneral=false}){
 // Historical actions can still require a whole-answer review; do not publish that draft.
 if([...evidence.values()].some(e=>e.sourceFamily==='aftersales'||e.caseSemantics?.historyOnly))return '';
 const parsed=answerParts(content);if(!parsed)return '';const decoded=packet.decode({...parsed,claims:parsed.claims||[],generalAdvice:parsed.generalAdvice||[]}),parts=[];
 const safe=text=>{if(typeof text!=='string'||!text.trim()||text.length>4000)return false;const result=require('../domain/safety/technical-safety.cjs').guardTechnicalAnswer({reply:text});return result.reply===text&&!result.safety;};
 const readable=text=>{for(const [id,row] of evidence)text=text.split(id).join(row.name||'原文资料');return /\b(?:s\d+|blk-[a-f0-9]+|evidence-[a-f0-9]+|case-[a-f0-9]+)\b/.test(text)?null:text;};
 const claims=decoded.claims;if(!Array.isArray(claims)||claims.length>8)return '';
 for(const c of claims){
  if(!safe(c.text)||!Array.isArray(c.evidenceIds)||c.evidenceIds.some(id=>!evidence.has(id)))break;
  if(!c.evidenceIds.length&&(!allowGeneral||evidence.size||models.length||/(?:公司|灰度|我司|资料|手册|规格书|历史案例)|\b[A-Z][A-Za-z_-]*\d/i.test(c.text)))break;
  const refs=c.evidenceIds.map(id=>evidence.get(id));if(refs.some(e=>e.conflict||e.unknown||e.scopeGap||e.readAvailable&&!e.readPerformed||e.sourceKind==='validated-ordering-calculation'&&e.verificationStatus!=='geometry-and-static-rule-checked'))break;
  if(/(?:兼容|通用|互刷|替换)/.test(c.text)&&!refs.some(e=>e.compatibilityConfirmed===true))break;
  if(models.some(model=>c.text.toUpperCase().includes(model.toUpperCase().replace(/^HD-/,''))&&!refs.some(e=>[...(e.modelIds||[]),...(e.scope?.mentionedModels||[])].some(m=>m.toUpperCase().replace(/^HD-/,'')===model.toUpperCase().replace(/^HD-/,'')))))break;
  try{require('./answer-integrity.cjs').validateClaimNumbers([c],evidence,{message,history});}catch{break;}
  const text=readable(c.text);if(!text)break;parts.push(text);
 }
 // Do not jump past a withheld claim to publish later advice out of context.
 if(parts.length===claims.length&&Array.isArray(decoded.generalAdvice))for(const text of decoded.generalAdvice.slice(0,6)){
  if(!safe(text)||/\d\s*(?:万点|点|像素|HUB75|路输出|个网口)|(?:不低于|不高于|设为|设置为|调到|调为)\s*[Vv]?\d|(?:公司|历史案例|资料).{0,30}(?:记录|显示|表明|要求|解决)|兼容|互刷/.test(text))break;
  const rendered=readable(text);if(!rendered)break;parts.push(rendered);
 }
 const reply=parts.join('\n\n');return safe(reply)?reply:'';
}
module.exports={answerParts,answerPreview};
