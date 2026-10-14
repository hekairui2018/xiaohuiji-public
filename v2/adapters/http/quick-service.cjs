'use strict';
const labels={spec:'规格书',manual:'使用说明书',firmware:'固件',other:'资料'};
const link=d=>({name:d.name||d.file,url:d.url||d.publicUrl,clean:d.name||d.file,btn:d.name||d.file,kind:d.kind});
function productView(p){
 const groups=['spec','manual','other'].map(kind=>({key:kind,label:labels[kind],items:(p.documents||[]).filter(d=>d.kind===kind).map(link)})).filter(g=>g.items.length);
 const fw=(p.firmware||[]).filter(f=>f.status==='uploaded'&&f.publicUrl);if(fw.length)groups.push({key:'firmware',label:'固件',items:fw.map(link)});
 return {name:p.displayName||p.model,aliases:p.aliases||[],features:{series:p.parameters?.productSeries||'',load:p.parameters?.load||'',resolution:p.parameters?.resolution||'',outputs:p.parameters?.interfaces||''},specGroups:groups.filter(g=>g.key!=='firmware'),firmwareGroup:groups.find(g=>g.key==='firmware')||null,docGroups:groups,specFiles:(p.documents||[]).map(d=>d.name),specLinks:(p.documents||[]).map(d=>d.url)};
}
function createQuickService(app){
 const assets=app.quickResources();
 // Empty search is deliberately not a wildcard; browse uses known product identities.
 const all=()=>app.quickSearch('').records.length?app.quickSearch('').records:app.quickBrowse();
 return {
  search(q){const records=app.quickSearch(q).records,results=records.map(productView),chip=app.chipLookup(q,records.map(p=>({modelId:p.modelId}))),series=new Set(records.map(p=>p.parameters?.productSeries).filter(Boolean)),seen=new Set(records.map(p=>p.modelId));
   const relatedChips=series.size?all().filter(p=>p.modelId&&!seen.has(p.modelId)&&series.has(p.parameters?.productSeries)).slice(0,12).map(p=>({label:p.displayName,q:p.displayName,relation:'same-source-product-series-not-compatibility'})):[];
   return {query:q,count:results.length,productCount:results.length,results,relatedChips,chipFirmware:chip?.view||null};},
  software(q){const rows=app.resourceMedia.softwareItems(q);return {query:q,software:rows.length?{isList:!q,items:rows}:null};},
  videos(q){return {query:q,video:app.resourceMedia.videoCategory(q)};},
  docs(cat){let total=0;const grouped=[];for(const p of all()){const items=cat==='firmware'?(p.firmware||[]).filter(f=>f.status==='uploaded'&&f.publicUrl).map(link):(p.documents||[]).filter(d=>d.kind===cat).map(link);if(!items.length)continue;total+=items.length;grouped.push({model:p.displayName,label:p.displayName,count:items.length,items});}
   return {cat,docs:{modelCount:grouped.length,total,groups:cat==='firmware'?grouped:[{key:'products',label:'产品资料',count:grouped.length,fileCount:total,products:grouped}]}};}
 };
}
module.exports={createQuickService,productView};
