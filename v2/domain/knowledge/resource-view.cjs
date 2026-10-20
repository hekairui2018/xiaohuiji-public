'use strict';
// Additive UI/tool contract. Missing identity or scope stays unknown.
function resourceView(item,{kind=item.kind||null,models=item.associatedModels||[]}={}){
 const meta=item.documentMetadata||{},resourceId=item.resourceId||null,versionId=item.resourceVersionId||item.versionId||null;
 const versionStatus=item.versionBasis==='filename-cover-version-conflict'?'conflict':item.versionSelection==='historical'?'historical':item.versionSelection==='latest-in-explicit-document-family'?'latest-confirmed-family':item.documentVersion?'identified-not-compared':'unknown';
 const fileId=item.sha256?'sha256:'+item.sha256:versionId||null;
 const associated=[...new Set(models.filter(Boolean))],explicit=item.applicableModels||meta.coverModels||[];
 const source={fileId,resourceId,versionId,identityStatus:item.sha256?'content-hash':versionId?'registered-version':'unknown',
  sourceDirectory:item.sourceDirectory||null,cloudUrl:item.verifiedCloudUrl||null,cloudMappingStatus:item.verifiedCloudUrl?'registered':'not-registered',
  availability:item.available===true?'available':item.available===false?'unavailable':'unknown'};
 const relations=[...associated.map(model=>({entityType:'product',model,basis:item.classificationBasis||item.associationStatus||'registered-association',status:'associated-not-compatibility'})),
  ...explicit.map(model=>({entityType:'product',model,basis:'original-explicit-model',status:'original-scope-not-hardware-approval'}))];
 return {...item,kind,resourceType:kind,source,relations,resourceId,resourceVersionId:versionId,versionId,
  fileId:item.sha256?'sha256:'+item.sha256:versionId||null,
  associatedModels:[...new Set(models.filter(Boolean))],applicableModels:item.applicableModels||meta.coverModels||[],
  documentVersion:item.documentVersion||null,versionStatus,
  classificationBasis:item.classificationBasis||null,scopeEvidence:item.scopeEvidence||meta.scopeEvidence||[],
  associationStatus:item.associationStatus||'unknown',parseStatus:item.parseStatus||null,
  reviewRequired:item.reviewRequired??(!!item.classificationConflict||!!item.resourceOnly||['filename-candidate','model-conflict','unknown'].includes(item.associationStatus||'unknown')||versionStatus==='conflict')};
}
function paginateDocs(body,{offset=0,limit=null,view='grouped'}={}){
 const docs=body.docs,flat=require('./flat-resource-groups.cjs');
 if(view==='flat')docs.groups=flat.flatCatalogGroups(docs);
 const all=docs.groups.flatMap(g=>g.products?g.products.flatMap(p=>p.items):g.items||[]);
 docs.items=all;
 if(limit!==null){
  const allowed=new Set(all.slice(offset,offset+limit));let cursor=0;
  docs.groups=docs.groups.map(g=>g.products?{...g,products:g.products.map(p=>({...p,items:p.items.filter(()=>allowed.has(all[cursor++]))})).filter(p=>p.items.length)}:{...g,items:g.items.filter(()=>allowed.has(all[cursor++]))}).filter(g=>g.products?g.products.length:g.items.length);
  for(const g of docs.groups){if(g.products){for(const p of g.products)p.count=p.items.length;g.count=g.products.length;g.fileCount=g.products.reduce((n,p)=>n+p.count,0);}else g.count=g.items.length;}
  docs.items=all.slice(offset,offset+limit);
 }
 docs.pagination={offset:limit===null?0:offset,limit,total:all.length,returned:docs.items.length,nextOffset:limit!==null&&offset+limit<all.length?offset+limit:null};
 docs.view=view;docs.flatGroups=flat.flatCatalogGroups(docs);
 return body;
}
module.exports={resourceView,paginateDocs};
