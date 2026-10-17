'use strict';
const {modelId}=require('../identity/model-id.cjs');
const {documentBelongs}=require('../identity/document-identity.cjs');
const {sourceClassification}=require('./source-classification.cjs');
const formats=/\.(pdf|docx?|pptx?|xlsx?|wps|txt|md)$/i;
function identifyDocument(resource,products=[]){
 const name=resource.name||'',intro=resource.documentIntro||'',meta=resource.documentMetadata||{},source=sourceClassification(resource);
 if(!formats.test(name)&&!source.formatConflict)return null;
 let kind=/规格书|产品规格|技术规格|(?<![A-Za-z])specifications?(?![A-Za-z])/i.test(name)?'spec':/说明书|操作说明|操作指南|使用说明|用户手册|操作手册|产品手册|使用手册|系统操作手册|调试手册|调试指导手册|调试说明|连接说明|(?<![A-Za-z])manual(?![A-Za-z])|\b(?:user|operation|installation|programming|hardware)\s+guide\b/i.test(name)?'manual':null;
 const filenameKind=kind,bodyKind=meta.certificate?'other':meta.kind||null;
 let basis=kind?'filename-role-hint':null,classificationConflict=null;
 if(source.kind){
  kind=source.kind;basis=source.basis;
  if(source.formatConflict){kind='pending';classificationConflict='source-folder-file-format-conflict';}
  else if(bodyKind&&source.exclusive&&bodyKind!==source.kind){kind='pending';classificationConflict='source-folder-original-content-conflict';}
  if(classificationConflict)basis=classificationConflict;
 }else if(bodyKind){kind=bodyKind;basis=meta.classificationStatus||'original-title-confirmed';}
 else if(/certificate|认证证书|检测报告|合格证|test report/i.test(name)){kind='other';basis='certificate-document-not-specification';}
 if(!kind&&/^\s*(?:PRODUCT\s+SPECIFICATIONS?|产品规格书|技术规格书)\s*$/im.test(intro)){kind='spec';basis='cached-original-cover';}
 if(!kind&&/^\s*(?:用户手册|产品说明书|使用说明书|USER\s+MANUAL|PRODUCT\s+MANUALS?)\s*$/im.test(intro)){kind='manual';basis='cached-original-cover';}
 if(!kind&&meta.coverModels?.length){kind='pending';basis='original-model-role-unconfirmed';}
 if(!kind)return null;
 const ids=new Set(products.filter(p=>p.modelId&&documentBelongs(name,p.modelId)).map(p=>p.modelId));
 // Leading explicit board/chip labels also cover numeric LCD models. Versions,
 // years and unknown model mentions in instruction prose are not product IDs.
 const prefix=name.replace(/^HD[-_ ]?/i,'');
 const token=/^(?:[A-Z]+\d+[A-Z0-9]*|\d+[A-Z]{1,3}\d*)(?:[-_][A-Z0-9]+)*(?:\s+(?:PRO|PLUS|MAX|MINI|LITE))?(?![A-Z0-9])/i.exec(prefix)?.[0];
 if(kind!=='other'&&token&&!/^V\d|^HD20(?:18|20)$/i.test(token)){const id=modelId(token);if(id)ids.add(id);}
 let modelConflict=false;
 if(meta.coverModels?.length){const known=new Set(products.map(p=>p.modelId).filter(Boolean)),originalIds=meta.coverModels.map(modelId).filter(id=>id&&(kind!=='other'||meta.classificationStatus==='manual-review'||known.has(id)));modelConflict=ids.size>0&&originalIds.length>0&&![...ids].some(id=>originalIds.includes(id));if(originalIds.length)ids.clear();if(!modelConflict)for(const id of originalIds)ids.add(id);else {kind='pending';basis='filename-original-model-conflict';}}
 if(!ids.size&&basis==='cached-original-cover')for(const line of intro.split(/\r?\n/).slice(0,12)){
  const t=line.trim();if(/^(?:HD[-_ ]?)?(?:[A-Z]+\d+[A-Z0-9]*(?:[-_][A-Z0-9]+)*|\d+[A-Z][A-Z0-9]*)(?:\s+(?:Pro|Plus))?$/i.test(t)&&!/^V\d/i.test(t)){const id=modelId(t);if(id)ids.add(id);}
 }
 const context=[name,...resource.folders||[]].join(' / '),software=/HD\s*(?:Set|Player|Show|Sign|2018|2020)|LCDPlayer|Magic\s*Player|ToolBox|云平台|小灰云|屏掌控|LedArt|APP\b|SDK/i.test(context);
 const lcd=source.domain==='lcd';
 return {kind,modelIds:source.component&&meta.classificationStatus!=='manual-review'?[]:[...ids],basis,classificationConflict,detectedKind:source.detectedKind,filenameKind,originalKind:bodyKind,sourceGroup:source.browseGroup,sourceRole:source.kind,sourceDomain:source.domain,sourceDomainConflict:source.domainConflict,displayCategory:source.browseGroup?.key||(lcd?'lcd':null),associationStatus:source.component&&meta.classificationStatus!=='manual-review'?'component-source-directory-not-product-identity':modelConflict?'model-conflict':meta.classificationStatus==='manual-review'?'manual-reviewed-association':meta.coverModels?.length?'original-cover-model':'filename-candidate',collection:source.component==='communication-module'?'通讯模块及天线':source.component==='battery'?'电池':software?(lcd?'LCD 软件与操作':'软件 · APP · 云平台'):kind==='pending'?(lcd?'LCD 待确认资料':'待确认资料'):kind==='other'?(lcd?'LCD 认证 · 培训 · 技术参考':'认证 · 培训 · 技术参考'):kind==='spec'?(lcd?'LCD 规格书（适用产品待核对）':'其他规格书（适用产品待核对）'):(lcd?'LCD 通用操作手册（适用产品待核对）':'通用操作手册（适用产品待核对）'),category:source.browseGroup?.key||(lcd?'lcd':software?'software-cloud':'unassigned-documents')};
}
module.exports={identifyDocument};
