'use strict';
// Small browse representation. Full evidence/history APIs remain unchanged.
const fields=['name','deviceName','deviceNameBasis','url','downloadUrl','clean','btn','available','unavailableReason','unavailableMessage','originalName','fileId','sha256','resourceId','resourceVersionId','versionId','kind','documentVersion','documentLanguage','documentEdition','versionBasis','versionStatus','versionSelection','documentDate','resourceOnly','verificationStatus','associationStatus','applicableModels','associatedModels','scopeEvidence'];
const item=value=>Object.fromEntries([...fields,'materialProperty','materialPropertyLabel','materialProperties','materialPropertyBasis','baseDocumentKind','historyStatus','manufacturerRole','sourceDirectories','sourceAssociations','accessRestricted','accessBasis'].filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
function catalogList(body){
 if(!body.docs)return body;
 const {items,flatGroups,...docs}=body.docs;
 return {...body,docs:{...docs,listOnly:true,groups:docs.groups.map(g=>g.products?{...g,products:g.products.map(p=>({...p,items:p.items.map(item)}))}:{...g,items:(g.items||[]).map(item)})}};
}
module.exports={catalogList};
