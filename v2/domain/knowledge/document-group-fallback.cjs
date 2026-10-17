'use strict';
const {sourceClassification}=require('./source-classification.cjs');
const {isSignedDocument}=require('./document-versions.cjs');
// Recover only browse membership, never model identity, applicability or version evidence.
function attachMissingSourceGroups(products,resources){
 const hashes=new Map(),names=new Map();
 function add(map,key,value){if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(value);}
 for(const r of resources){const group=sourceClassification(r).browseGroup;if(!group)continue;add(hashes,r.sha256,group);add(names,r.name,{...group,sha256:r.sha256});}
 function one(groups){return groups?.length&&new Set(groups.map(g=>g.key)).size===1?{key:groups[0].key,label:groups[0].label}:null;}
 for(const p of products){
  for(const d of p.documents){if(d.displayCategory&&d.displayCategory!=='unassigned-documents')continue;
   const hash=d.sha256||(d.sourceReferences||[d.sourceReference]).find(s=>s?.originalName===(d.name||d.file))?.originalSha256;
   const named=names.get(d.name||d.file),exact=hash?hashes.get(hash):named&&new Set(named.map(r=>r.sha256)).size===1?named:null;
   const group=one(exact);if(group){d.displayCategory=group.key;d.sourceGroup=group;d.displayCategoryBasis='registered-original-directory';}
  }
  const byKind=new Map();for(const d of p.documents){if(isSignedDocument(d)||!d.sourceGroup||!d.displayCategory||d.displayCategory==='unassigned-documents')continue;add(byKind,d.kind,d.sourceGroup);}
  for(const d of p.documents){if(d.displayCategory&&d.displayCategory!=='unassigned-documents')continue;const group=one(byKind.get(d.kind));if(group){d.displayCategory=group.key;d.sourceGroup=group;d.displayCategoryBasis='same-product-confirmed-source-category';}}
 }
 return products;
}
module.exports={attachMissingSourceGroups};
