'use strict';
const {sourceLocation}=require('../../domain/knowledge/answer-guidance.cjs');
function createPublicSearch({source,release,lookup}){
 let active=0;
 const clean=s=>String(s||'').replace(/[A-Za-z]:[\\/][^\r\n|<>"']+|\\\\[^\r\n|<>"']+/g,'[内部位置]');
 const view=(r,context,grants=release.availableGrants())=>{const grant=grants.find(g=>g.name===r.name&&g.sha256===r.sha256);if(!grant)return null;
  return {name:r.name,directory:grant.publicDirectory,category:r.category||grant.category,download:release.urlFor(r.name),
   text:clean(context?.text||r.text),location:sourceLocation(r.locator),section:r.knowledgeUnit?.sectionPath||[],
   contentMode:r.bodyParsed?'original-context':'metadata-only',visualContextRequired:!!r.knowledgeUnit?.visualContextRequired,
   ...(r.bodyParsed?{contextId:r.unitId,contextKey:r.sha256,nextOffset:context?.nextOffset??null}:{} )};};
 async function search(query){
  if(typeof query!=='string'||!query.trim()||query.length>240)return {code:400,body:{error:'invalid-public-query'}};
  if(active>=4)return {code:429,body:{error:'public-search-busy'}};active++;
  try{const started=Date.now(),grants=release.availableGrants(),q=lookup?require('../../domain/knowledge/quick-query.cjs').parseQuickQuery(query,lookup):null;
   // Exact identity already constrains the source. It must not let a cover page
   // satisfy a separate technical topic merely by repeating the model name.
   let topic=query;for(const model of q?.models||[]){const token=model.replace(/^HD-/i,'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');topic=topic.replace(new RegExp('(?:HD[-_ ]?)?'+token+'(?![A-Za-z0-9])','ig'),' ');}
   topic=topic.trim()||query;
   const data=await source.search(topic,'files',{role:q?.intent==='parameters'?'parameter':'all',models:q?.models||[],chips:q?.chips||[],limit:32,authorizedDocuments:grants});
   // Filename/directory navigation is independent of body relevance. Use the
   // already loaded public manifest; no filesystem scan or internal catalog.
   const compact=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/[\s_-]/g,'');
   const segments=query.split(/[\\/]+/).map(compact).filter(Boolean);
   const navigation=grants.filter(r=>segments.every(term=>compact(r.publicDirectory+'/'+r.name).includes(term)));
   const exact=navigation.filter(r=>compact(r.name)===compact(query)||compact(r.publicDirectory+'/'+r.name).endsWith(compact(query)));
   const navRows=(exact.length?exact:navigation).map(r=>data.results.find(hit=>hit.sha256===r.sha256)||{...r,category:r.category,bodyParsed:false,text:'',kind:'file'});
   const seen=new Set(),selected=[...navRows,...(exact.length?[]:data.results)].filter(r=>{if(seen.has(r.sha256))return false;seen.add(r.sha256);return true;}).slice(0,10);
   const results=[];for(let i=0;i<selected.length;i+=2){results.push(...await Promise.all(selected.slice(i,i+2).map(async r=>view(r,r.bodyParsed?await source.read(r):null,grants))));}
   return {code:200,body:{results:results.filter(Boolean),elapsedMs:Date.now()-started,scope:'public-release-only'}};
  }finally{active--;}
 }
 async function read({name,sha256,unit,offset}){
  if(!release.availableGrants().some(r=>r.name===name&&r.sha256===sha256)||!/^[a-f0-9]{64}$/.test(unit||'')||!Number.isInteger(offset)||offset<0||offset>100000)return {code:403,body:{error:'context-not-authorized'}};
  try{const r={name,sha256,unitId:unit,bodyParsed:true};return {code:200,body:{result:view(r,await source.read(r,{offset}))}};}catch{return {code:403,body:{error:'context-not-authorized'}};}
 }
 return {search,read};
}
module.exports={createPublicSearch};
