'use strict';
const categories=[['spec','规格书'],['manual','说明书'],['video','操作视频']];
function uniqueFiles(items){
 const rows=[],seen=new Map();
 for(const item of items){const key=item.fileId||item.sha256&&'sha256:'+item.sha256||item.resourceVersionId||null;
  if(key&&seen.has(key)){const old=seen.get(key);old.associatedModels=[...new Set([...old.associatedModels||[],...item.associatedModels||[]])];continue;}
  const record={...item,associatedModels:[...item.associatedModels||[]]};rows.push(record);if(key)seen.set(key,record);
 }return rows.sort(require('./document-dates.cjs').newestFirst);
}
function productCategories(product){
 const items=(product.docGroups||[]).flatMap(g=>g.items||[]);
 return {...product,resourceGroups:categories.map(([key,label])=>({key,label,items:uniqueFiles(items.filter(i=>i.kind===key))})),pendingResources:uniqueFiles(items.filter(i=>i.kind==='pending')),resourceLayout:'model-category-files'};
}
function flatCatalogGroups(docs){
 return docs.groups.map(g=>{const items=uniqueFiles(g.products?g.products.flatMap(p=>p.items):g.items||[]);return {key:g.key||g.model,label:g.label||g.model,count:items.length,items};});
}
module.exports={uniqueFiles,productCategories,flatCatalogGroups};
