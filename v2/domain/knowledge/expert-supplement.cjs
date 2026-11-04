'use strict';
// Private training and field notes. Search returns source-bound candidates;
// neither this index nor OCR establishes product applicability or approval.
const fs=require('node:fs');
const crypto=require('node:crypto');

const normalized=value=>String(value||'').normalize('NFKC').toUpperCase();
function terms(value){
 const words=normalized(value).match(/[A-Z0-9][A-Z0-9._+-]*|[\u3400-\u9fff]+/g)||[];
 return [...new Set(words.flatMap(word=>/^[\u3400-\u9fff]+$/.test(word)
  ?word.length===1?[word]:Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)):[word]))]
  .filter(word=>!new Set(['怎么','如何','什么','请问','一下','有没有','问题','资料','公司','这个','那个','我们','客户']).has(word));
}
function createExpertSupplement({file}){
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(data.schema!=='xiaohuiji-expert-supplement-1'||data.scope!=='private-expert-only'||!Array.isArray(data.entries)||!Array.isArray(data.documents))throw Error('expert-supplement-invalid');
 const docs=new Map(data.documents.map(doc=>[doc.sha256,doc]));
 for(const doc of data.documents){
  if(!fs.existsSync(doc.sourcePath)||crypto.createHash('sha256').update(fs.readFileSync(doc.sourcePath)).digest('hex')!==doc.sha256)throw Error('expert-supplement-source-changed');
 }
 const rows=data.entries.map(entry=>{
  if(!entry.id||!docs.has(entry.sourceSha256)||!Array.isArray(entry.pages)||!entry.pages.length||typeof entry.text!=='string'||typeof entry.imageOcrText!=='string')throw Error('expert-supplement-invalid');
  const full=[entry.text,entry.imageOcrText&&'图片文字识别（待对照原图）：\n'+entry.imageOcrText].filter(Boolean).join('\n');
  return {...entry,full,titleTerms:new Set(terms(entry.title)),bodyTerms:new Set(terms(full)),sourceTerms:new Set(terms(entry.source))};
 });
 const byId=new Map(rows.map(row=>[row.id,row]));
 const frequency=new Map();
 for(const row of rows)for(const term of new Set([...row.titleTerms,...row.bodyTerms]))frequency.set(term,(frequency.get(term)||0)+1);
 function project(row,offset=0){
  if(!Number.isSafeInteger(offset)||offset<0||offset>=row.full.length)throw Error('expert-invalid-offset');
  const chunk=row.full.slice(offset,offset+4400),next=offset+chunk.length<row.full.length?offset+chunk.length:null;
  return {evidenceId:'expert-supplement-'+row.id,name:row.source,title:row.title,text:chunk,
   sourceKind:'expert-supplement-original',sourceFamily:'supplement',sourceEntryId:row.id,
   locator:{pages:row.pages,sections:row.locators},reviewState:row.reviewState,
   applicability:row.applicability,imageOcrNeedsVisualCheck:row.imageOcrNeedsVisualCheck,
   readPerformed:true,readAvailable:true,contextComplete:offset===0&&next===null,nextOffset:next,
   recommendationVerified:false,match:{sourceDocument:row.source,sourcePages:row.pages,
    meaning:'培训或现场材料的候选证据；仅原文记载，不代表所有设备、版本或现场都适用。'}};
 }
 function search(query,{limit=2}={}){
  if(typeof query!=='string'||!query.trim()||query.length>240)throw Error('expert-invalid-query');
  const requested=terms(query);
  if(!requested.length)return [];
  const upper=normalized(query),explicit=data.documents.filter(doc=>{
   const stem=normalized(doc.name.replace(/\.(?:pptx|pdf)$/i,''));
   return stem.length>=8&&upper.includes(stem);
  }).map(doc=>doc.name);
  return rows.filter(row=>!explicit.length||explicit.includes(row.source)).map(row=>{
   let score=0,hits=0;
   const focused=requested.filter(token=>!row.sourceTerms.has(token));
   const active=focused.length?focused:requested;
   for(const token of active){
    const rarity=Math.max(1.5,Math.log(1+rows.length/(1+(frequency.get(token)||0))));
    if(row.titleTerms.has(token)){score+=2*rarity;hits++;}
    else if(row.bodyTerms.has(token)){score+=rarity;hits++;}
    else if(row.sourceTerms.has(token))score+=.1;
   }
   if(row.pages[0]===1&&row.full.length<300)score-=12;
   return {row,score,hits};
  }).filter(item=>item.score>=(requested.length===1?3:6)&&item.hits>=Math.min(2,requested.length))
   .sort((a,b)=>b.score-a.score||b.hits-a.hits||a.row.id.localeCompare(b.row.id))
   .slice(0,Math.max(1,Math.min(4,limit))).map(item=>project(item.row));
 }
 function read(record,offset=0){const row=byId.get(record.sourceEntryId);return row?project(row,offset):null;}
 return {search,read,counts:{documents:docs.size,entries:rows.length,ocrImages:data.coverage?.imageOcr||0}};
}
module.exports={createExpertSupplement};
