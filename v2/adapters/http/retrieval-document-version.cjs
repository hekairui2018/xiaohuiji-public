'use strict';
const {describeDocument,isSignedDocument}=require('../../domain/knowledge/document-versions.cjs');
const compare=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return Math.sign(d);}return 0;};
function selectRetrievalDocuments(documents,query=''){
 const documentQuery=/规格书|说明书|手册|文档|资料|pdf|docx?|manual|specification/i.test(query);
 const requested=documentQuery?[...query.matchAll(/(?:\bV\s*|(?:文档|资料|规格书|说明书|手册)版本\s*|版本\s*)(\d+(?:\.\d+)+)/ig)].filter(m=>!/(?:固件|硬件|软件)\s*$/.test(query.slice(0,m.index))).map(m=>m[1].split('.').map(Number)):[];
 const history=/对比|比较|区别|变化|历史版本|历代|compare|difference|history/i.test(query);
 const groups=new Map(),unranked=[];
 for(const document of documents){
  if(!['spec','manual'].includes(document.category)){unranked.push(document);continue;}
  const identity=describeDocument(document);
  if(requested.length&&(!identity.numbers||!requested.some(v=>compare(v,identity.numbers)===0)))continue;
  // Unknown/conflicting document versions are not silently labelled as latest.
  if(!identity.numbers){unranked.push(document);continue;}
  const family=identity.family.replace(/SPEC AND USER MANUAL/g,'使用说明书').replace(/USER MANUAL/g,'使用说明书').replace(/SPECIFICATION/g,'规格书').replace(/\|(?:zh|en|unspecified-or-en)\|/,'|language|').replace(/\|signed$/,'').replace(/(?:已|未)(?:签章|盖章|签字)|\b(?:signed|unsigned)\b/ig,'').replace(/[\s_&]+/g,'');
  const key=document.category+'|'+[...(document.modelIds||[])].sort().join(',')+'|'+family+(history||requested.length>1?'|'+identity.version:'');
  const rows=groups.get(key)||[];rows.push({document,identity});groups.set(key,rows);
 }
 const format=/\bdocx?\b/i.test(query)?'docx':'pdf',language=/[\u4e00-\u9fff]/.test(query)?'zh':'unspecified-or-en';
 const selected=[...unranked];
 for(const rows of groups.values()){
  rows.sort((a,b)=>compare(b.identity.numbers,a.identity.numbers)||Number(b.identity.format===format)-Number(a.identity.format===format)||Number(b.identity.language===language)-Number(a.identity.language===language)||Number(isSignedDocument(a.document))-Number(isSignedDocument(b.document))||Number(b.document.access==='public')-Number(a.document.access==='public')||a.document.name.localeCompare(b.document.name)||String(a.document.documentId).localeCompare(String(b.document.documentId)));
  selected.push(rows[0].document);
 }
 return selected;
}
module.exports={selectRetrievalDocuments};
