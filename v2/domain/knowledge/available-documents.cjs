'use strict';
// A missing original is a retained reference, not a downloadable document or
// proof that another version supersedes it. Transient failures stay visible.
const missingReasons=new Set(['original-not-registered','registered-original-unavailable-or-changed']);
const missing=item=>item.available===false&&missingReasons.has(item.unavailableReason);
function separateProductReferences(product){
 const records=[];
 product.docGroups=(product.docGroups||[]).map(group=>({...group,items:group.items.filter(item=>{if(!missing(item))return true;records.push({...item,categoryLabel:group.label});return false;})})).filter(group=>group.items.length);
 product.specGroups=product.docGroups.filter(g=>g.key!=='firmware');product.firmwareGroup=product.docGroups.find(g=>g.key==='firmware')||null;
 product.unavailableResources=records;
 product.deviceName=require('./device-name.cjs').selectedDeviceName(product.specGroups.flatMap(g=>g.items));
 const documents=product.specGroups.flatMap(g=>g.items).filter(item=>item.available!==false);
 product.specFiles=documents.map(d=>d.name);product.specLinks=documents.map(d=>d.url);
 return product;
}
function separateCatalogReferences(groups){
 const unavailableRecords=[],result=[];
 for(const group of groups){const products=[];for(const product of group.products||[]){const items=product.items.filter(item=>{if(!missing(item))return true;unavailableRecords.push({...item,model:product.model,categoryLabel:group.label});return false;});if(items.length)products.push({...product,items,count:items.length,deviceName:require('./device-name.cjs').selectedDeviceName(items)});}
  if(products.length)result.push({...group,products,count:products.length,fileCount:products.reduce((n,p)=>n+p.count,0)});
 }
 return {groups:result,unavailableRecords};
}
module.exports={separateProductReferences,separateCatalogReferences};
