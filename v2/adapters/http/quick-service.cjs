'use strict';
const labels={spec:'规格书',manual:'使用说明书',firmware:'固件',other:'其他资料',pending:'待确认资料'};
// Reuse the existing pure display classifier, without importing V1 services or routing.
const {DOC_CATEGORIES,classifyDocModel}=require('../../../backend/doc-category.cjs');
const DOCUMENT_CATEGORIES=[...DOC_CATEGORIES,{key:'lcd',label:'LCD 产品 · 软件与操作'},{key:'software-cloud',label:'软件 · APP · 云平台'},{key:'unassigned-documents',label:'通用资料 · 适用产品待核对'}];
const {selectDocumentVersions,isSignedDocument}=require('../../domain/knowledge/document-versions.cjs');
const {resourceView,paginateDocs}=require('../../domain/knowledge/resource-view.cjs');
const {augmentProducts}=require('../../domain/knowledge/local-resource-catalog.cjs');
const unavailableMessages={'original-not-registered':'尚未在原始资料索引中登记此文件','same-name-content-conflict':'同名文件存在不同内容，尚未确认对应原件','registered-content-hash-missing':'登记文件缺少内容哈希，暂不能确认原件','registered-content-does-not-match-source':'登记文件与已有来源哈希不一致','registered-original-unavailable-or-changed':'登记原件已不可访问或发生变化，需重新核对','resource-service-unavailable':'资料服务暂不可用，不能确认原件链接','invalid-document-identity':'文件身份信息不完整或无效','resource-resolution-unavailable':'无法确认此文件对应的原件'};
function documentLabel(name){
 let label=String(name||'').replace(/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv)$/i,'').replace(/_/g,' ').replace(/\s+/g,' ').trim();
 // Brand formatting only; never remove product suffixes, hardware tags or versions.
 label=label.replace(/^HD[-\s]+(?=[A-Z]+\d)/i,'HD-');
 if(/^[A-Z]+\d[A-Z0-9+-]*(?=[\u4e00-\u9fff\s]|$)/i.test(label))label='HD-'+label;
 return label;
}
const link=d=>{const url=d.url||d.publicUrl||null,name=d.name||d.file,clean=(d.kind==='firmware'?name:documentLabel(name))+(d.displayQualifier?' · '+d.displayQualifier:'');return {name,url,clean:d.resourceOnly?clean+'（兼容性待核对）':clean,btn:clean,verificationStatus:d.verificationStatus||'unknown',resourceOnly:!!d.resourceOnly,kind:d.kind,resourceId:d.resourceId||null,resourceVersionId:d.resourceVersionId||null,classificationBasis:d.classificationBasis||null,classificationEvidence:d.documentMetadata?.evidence||[],parseStatus:d.parseStatus||null,applicableModels:d.documentMetadata?.coverModels||[],scopeEvidence:d.documentMetadata?.scopeEvidence||[],associationStatus:d.associationStatus||'snapshot-association',versionBasis:d.versionBasis||null,documentVersion:d.documentVersion||null,documentLanguage:d.documentLanguage||null,versionSelection:d.versionSelection||null,available:Boolean(url),unavailableReason:url?null:'original-not-registered'};};
function productView(p){
 const documents=selectDocumentVersions(p.documents||[]).selected;
 const groups=['spec','manual','other','pending'].map(kind=>({key:kind,label:labels[kind],items:documents.filter(d=>d.kind===kind).map(link)})).filter(g=>g.items.length);
 const fw=(p.firmware||[]).filter(f=>['uploaded','local-indexed'].includes(f.status)&&f.publicUrl);if(fw.length)groups.push({key:'firmware',label:'固件',items:fw.map(link)});
 return {name:p.displayName||p.model,modelId:p.modelId||null,aliases:p.aliases||[],features:{series:p.parameters?.productSeries||'',load:p.parameters?.load||'',resolution:p.parameters?.resolution||'',outputs:p.parameters?.interfaces||''},specGroups:groups.filter(g=>g.key!=='firmware'),firmwareGroup:groups.find(g=>g.key==='firmware')||null,docGroups:groups,specFiles:documents.map(d=>d.name),specLinks:documents.map(d=>d.url)};
}
function createQuickService(app,{resolveDocuments,localCatalog}={}){
 const assets=app.quickResources();
 // Empty search is deliberately not a wildcard; browse uses known product identities.
 const all=()=>app.quickSearch('').records.length?app.quickSearch('').records:app.quickBrowse();
 let augmentedSource=null,augmentedProducts=null;
 const localProducts=async()=>{const resources=await localCatalog();if(augmentedSource!==resources){augmentedProducts=augmentProducts(all(),resources);augmentedSource=resources;}return augmentedProducts;};
 return {
  async search(q){let records=app.quickSearch(q).records;if(localCatalog){const augmented=await localProducts();const ids=new Set(records.map(p=>p.modelId).filter(Boolean)),names=new Set(records.map(p=>p.displayName));records=augmented.filter(p=>(p.modelId&&ids.has(p.modelId))||names.has(p.displayName)||String(p.displayName).toUpperCase()===String(q).toUpperCase()||String(p.modelId).replace(/^HD-/,'')===String(q).toUpperCase());}const results=records.map(productView),chip=app.chipLookup(q,records.map(p=>({modelId:p.modelId}))),series=new Set(records.map(p=>p.parameters?.productSeries).filter(Boolean)),seen=new Set(records.map(p=>p.modelId));
   if(resolveDocuments){
    const documents=records.flatMap(p=>{const docs=selectDocumentVersions(p.documents||[]).selected;return ['spec','manual','other','pending'].flatMap(kind=>docs.filter(d=>d.kind===kind));}),views=results.flatMap(p=>p.specGroups.flatMap(g=>g.items));
    const resolutions=await resolveDocuments(documents);
    for(let i=0;i<views.length;i++){Object.assign(views[i],resolutions[i]||{url:null,available:false,unavailableReason:'resource-resolution-unavailable'});views[i].unavailableMessage=views[i].available?null:unavailableMessages[views[i].unavailableReason]||'暂无法提供已确认的原件';}
    for(const p of results){for(const g of p.specGroups)g.items=g.items.filter(d=>d.unavailableReason!=='signed-edition-hidden');p.specGroups=p.specGroups.filter(g=>g.items.length);p.docGroups=p.docGroups.filter(g=>g.items.length);const docs=p.specGroups.flatMap(g=>g.items);p.specFiles=docs.map(d=>d.name);p.specLinks=docs.map(d=>d.url);}
   }
   const relatedChips=series.size?all().filter(p=>p.modelId&&!seen.has(p.modelId)&&series.has(p.parameters?.productSeries)).slice(0,12).map(p=>({label:p.displayName,q:p.displayName,relation:'same-source-product-series-not-compatibility'})):[];
   for(const p of results)for(const g of p.docGroups)g.items=g.items.map(d=>resourceView(d,{models:[p.modelId]}));
   return {query:q,count:results.length,productCount:results.length,results,relatedChips,chipFirmware:chip?.view||null};},
  async software(q){const rows=app.resourceMedia.softwareItems(q),body={query:q,software:rows.length?{isList:!q,items:rows}:null};
   if(localCatalog){const resources=await localCatalog(),packages=require('../../domain/knowledge/software-packages.cjs').softwarePackages(resources,q);require('../../domain/knowledge/media-catalog.cjs').attachLocalSoftware(body,resources);if(rows.length||packages.packages.length||packages.historicalPackages.length)body.software={...body.software,isList:!q,items:body.software?.items||[],...packages};body.catalogStatus=localCatalog.status?.()||null;}
   for(const item of body.software?.items||[])Object.assign(item,resourceView({...item,url:item.downloadUrl,available:!!item.downloadUrl,classificationBasis:'existing-software-registration',associationStatus:'registered-software-not-hardware-compatibility'},{kind:'software'}));return body;},
  videos(q){return {query:q,video:app.resourceMedia.videoCategory(q)};},
  async docs(cat,{includeHistory=false,historyOnly=cat==='history',websiteOnly=false,offset=0,limit=null}={}){let total=0,historyCount=0;const grouped=[],buckets=new Map(),sourceDocuments=[],views=[];
   for(const p of localCatalog?await localProducts():all()){
    const selection=selectDocumentVersions((p.documents||[]).filter(d=>(cat==='history'||d.kind===cat)&&(!(websiteOnly||historyOnly)||!isSignedDocument(d))),{includeHistory:includeHistory||historyOnly});historyCount+=selection.withheld.length;
    const documents=cat==='firmware'?(historyOnly?p.firmwareHistory||[]:includeHistory?[...p.firmware||[],...p.firmwareHistory||[]]:p.firmware||[]).filter(f=>['uploaded','local-indexed'].includes(f.status)&&f.publicUrl):historyOnly?[...selection.selected.filter(d=>d.versionSelection==='historical'),...(cat==='history'?p.firmwareHistory||[]:[])]:[...selection.selected,...(cat==='pending'?p.firmwareCandidates||[]:[])],items=documents.map(d=>resourceView({...link(d),sha256:d.sha256||null,parseStatus:d.parseStatus||null},{models:[p.modelId]}));if(!items.length)continue;
    const name=p.displayName||p.model||p.modelId,product={model:name,label:name,count:items.length,items};total+=items.length;grouped.push(product);
    sourceDocuments.push(...documents);views.push(...items);
    const metadata=[p.parameters?.productSeries,...(p.claims||[]).map(c=>c.text)].filter(Boolean).join(' '),category=p.documentCategory||classifyDocModel(name,metadata);
    const categories=new Map();for(let i=0;i<documents.length;i++){const key=documents[i].displayCategory||category;if(!categories.has(key))categories.set(key,[]);categories.get(key).push(items[i]);}
    for(const [key,categoryItems] of categories){if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({...product,items:categoryItems,count:categoryItems.length});}
   }
   if(cat!=='firmware'&&resolveDocuments){
    const positions=sourceDocuments.map((d,i)=>d.kind==='firmware'?-1:i).filter(i=>i>=0),resolutions=await resolveDocuments(positions.map(i=>sourceDocuments[i]));for(let n=0;n<positions.length;n++)Object.assign(views[positions[n]],resolutions[n]||{url:null,available:false,unavailableReason:'resource-resolution-unavailable'});
   }
   for(const item of views)item.unavailableMessage=item.available?null:unavailableMessages[item.unavailableReason]||'暂无法提供已确认的原件';
   let hiddenSignedCount=0;for(const product of grouped){const before=product.items.length;product.items=product.items.filter(d=>d.unavailableReason!=='signed-edition-hidden');hiddenSignedCount+=before-product.items.length;product.count=product.items.length;}total-=hiddenSignedCount;
   const groups=cat==='firmware'?grouped:DOCUMENT_CATEGORIES.filter(c=>buckets.has(c.key)).map(c=>{const products=buckets.get(c.key).map(p=>({...p,items:p.items.filter(d=>d.unavailableReason!=='signed-edition-hidden')})).filter(p=>p.items.length).sort((a,b)=>a.model.localeCompare(b.model,'zh-Hans-CN',{numeric:true}));return {key:c.key,label:c.label,products,count:products.length,fileCount:products.reduce((n,p)=>n+p.items.length,0)};}).filter(g=>g.count);
   const visible=grouped.flatMap(p=>p.items),identity=d=>d.sha256||d.resourceVersionId||'unresolved:'+d.name;
   const uniqueFileCount=new Set(visible.map(identity)).size,uniqueAvailableFileCount=new Set(visible.filter(d=>d.available).map(identity)).size;
   for(const item of views)Object.assign(item,resourceView(item,{models:item.associatedModels}));
   return paginateDocs({cat,catalogStatus:localCatalog?.status?.()||null,docs:{associationCount:total,uniqueFileCount,uniqueAvailableFileCount,modelCount:grouped.filter(p=>p.items.length).length,total,groups,includeHistory:includeHistory||historyOnly,historyOnly,hiddenSignedCount,hiddenHistoricalCount:historyCount,versionPolicy:'explicit-document-family-only; unversioned originals retained; firmware variants remain separate'}},{offset,limit});}
 };
}
module.exports={createQuickService,productView,documentLabel};
