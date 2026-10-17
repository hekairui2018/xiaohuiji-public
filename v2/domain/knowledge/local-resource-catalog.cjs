'use strict';
const {modelId}=require('../identity/model-id.cjs');
const {isSignedDocument}=require('./document-versions.cjs');
const {identifyDocument}=require('./document-catalog.cjs');
const {sourceClassification}=require('./source-classification.cjs');
const {selectFirmwareVersions}=require('./firmware-versions.cjs');
// Resource naming is a browse association, never parameter or compatibility evidence.
const fileIdentity=name=>name.replace(/^HD[-_ ]?/i,'').replace(/\s*&\s*/g,' ').replace(/\s+/g,' ').toUpperCase();
function latestFirmware(items){
 return selectFirmwareVersions(items).selected;
}
function augmentProducts(products,resources){
 const presentHashes=new Set(resources.filter(r=>r.availabilityState!=='missing').map(r=>r.sha256).filter(Boolean));
 resources=resources.filter(r=>r.availabilityState!=='missing'||!r.sha256||!presentHashes.has(r.sha256));
 const result=products.map(p=>({...p,documents:(p.documents||[]).map(d=>({...d})),firmware:[...(p.firmware||[])]}));const byId=new Map(result.filter(p=>p.modelId).map(p=>[p.modelId,p]));
 const named=result.filter(p=>!p.modelId&&p.displayName).map(p=>({key:'name:'+fileIdentity(p.displayName),label:fileIdentity(p.displayName),product:p}));
 for(const p of named)byId.set(p.key,p.product);
 const seen=new Map(result.map(p=>[p,new Set(p.documents.map(d=>fileIdentity(d.name||d.file||'')))]));
 const neutral=r=>/中性|(?:^|[\s/_.(-])neutral(?:[\s/_.\s)-]|$)/i.test([...(r.folders||[]),r.name].join('/'));
 const standardNames=new Set(resources.filter(r=>!neutral(r)&&!isSignedDocument({name:[...(r.folders||[]),r.name].join('/')})).map(r=>fileIdentity(r.name)));
 const domains=new Map();for(const r of resources){if(!r.sha256)continue;const domain=sourceClassification(r).domain;if(domain){if(!domains.has(r.sha256))domains.set(r.sha256,new Set());domains.get(r.sha256).add(domain);}}
 for(const r of [...resources].sort((a,b)=>Number(neutral(a))-Number(neutral(b)))){
  const name=r.name,document=identifyDocument({...r,sourceDomainConflict:domains.get(r.sha256)?.size>1},products);
  const kind=/\.bin$/i.test(name)&&r.resourceType==='firmware'?'firmware':document?.kind;
  if(!kind)continue;
  if(kind!=='firmware'&&isSignedDocument({name:[...(r.folders||[]),name].join('/')}))continue;
  if(kind!=='firmware'&&neutral(r)&&standardNames.has(fileIdentity(name)))continue;
  const prefix=name.replace(/^HD[-_ ]?/i,'').replace(/([A-Z]+\d+[A-Z]*)_(Plus|Pro)(?=_|\b)/ig,'$1$2');
  const tokens=kind==='firmware'?prefix.split(/_FPGA|_MCU|_ARM/i)[0].split('_'):prefix.match(/^[A-Z]+\d+[A-Z0-9]*(?:-[A-Z0-9]+)*(?:\s+(?:Pro|Plus))?/i)||[];
  let ids=kind==='firmware'?[...new Set(tokens.map(modelId).filter(id=>id&&!/^HD-V\d+$/.test(id)))]:document.modelIds;
  if(kind!=='firmware')for(const p of named){const value=fileIdentity(name);if(value.startsWith(p.label)&&!/^[A-Z0-9_+-]/i.test(value.slice(p.label.length)))ids.push(p.key);}
  if(kind==='firmware'){ids=ids.filter(id=>byId.has(id));if(!ids.length){const key='local-unassigned-firmware';if(!byId.has(key)){const p={modelId:null,displayName:'其他本地固件（适用型号待核对）',parameters:{},documents:[],firmware:[]};result.push(p);byId.set(key,p);seen.set(p,new Set());}ids=[key];}}
  else if(!ids.length){const key='documents:'+document.collection;if(!byId.has(key)){const p={modelId:null,displayName:document.collection,parameters:{},documents:[],firmware:[],documentCategory:document.category,identityStatus:'document-collection-not-product'};result.push(p);byId.set(key,p);seen.set(p,new Set());}ids=[key];}
  for(const id of ids){let p=byId.get(id);if(!p){p={modelId:id,displayName:id,parameters:{},documents:[],firmware:[],identityStatus:'filename-only-resource-association'};result.push(p);byId.set(id,p);seen.set(p,new Set());}
   if(kind==='firmware'){if(!p.firmware.some(f=>f.file===name))p.firmware.push({file:name,kind:'firmware',status:'local-indexed',publicUrl:'/v2/offline/file?id='+r.locationId,sourceMode:'local',sizeBytes:r.sizeBytes,sha256:r.sha256||null,resourceId:r.resourceId,resourceVersionId:r.versionId,classificationBasis:'registered-firmware-folder-and-model-hint',associationStatus:'filename-candidate',verificationStatus:'resource-only-not-compatibility-verified',resourceOnly:true});}
   else {
    const details={documentMetadata:r.documentMetadata,resourceId:r.resourceId,resourceVersionId:r.versionId,classificationBasis:document.basis,classificationConflict:document.classificationConflict,sourceGroup:document.sourceGroup,sourceRole:document.sourceRole,detectedKind:document.detectedKind,associationStatus:document.associationStatus,resourceOnly:['filename-candidate','model-conflict'].includes(document.associationStatus),sourceLocationId:r.locationId,parseStatus:r.parseStatus||null,displayCategory:document.displayCategory,sourceDomain:document.sourceDomain,sourceDomainConflict:document.sourceDomainConflict};
    Object.assign(details,require('./document-dates.cjs').documentDate(r));
    const matches=p.documents.filter(d=>fileIdentity(d.name||d.file||'')===fileIdentity(name));
    for(const d of matches){if(document.sourceRole||!d.kind||d.kind==='other'||(kind!=='pending'&&r.documentMetadata?.kind)||document.associationStatus==='model-conflict')d.kind=kind;Object.assign(d,details);}
    const hash=d=>d.sha256||(d.sourceReferences||[d.sourceReference]).find(x=>x?.originalName===(d.name||d.file)&&x.originalSha256)?.originalSha256;
    if(matches.some(d=>hash(d)&&hash(d)===r.sha256))continue;
    const unresolved=matches.find(d=>!hash(d));
    if(unresolved){unresolved.sha256=r.sha256;unresolved.sourceLocationId=r.locationId;unresolved.catalogSourceLabel=(r.folders||[]).slice(-2).join(' / ');}
    else p.documents.push({name,kind,sha256:r.sha256,url:document.detectedKind&&r.availabilityState!=='missing'?'/v2/offline/file?id='+r.locationId:null,verificationStatus:document.basis,...details,catalogSourceLabel:(r.folders||[]).slice(-2).join(' / ')});
   }
  }
 }
 for(const p of result){const firmware=selectFirmwareVersions(p.firmware);p.firmware=firmware.selected;p.firmwareHistory=firmware.withheld;p.firmwareCandidates=firmware.pending;const versions=new Map();for(const d of p.documents){const key=fileIdentity(d.name||d.file||'');if(!versions.has(key))versions.set(key,[]);versions.get(key).push(d);}for(const docs of versions.values())if(new Set(docs.map(d=>d.sha256).filter(Boolean)).size>1)for(const d of docs)d.displayQualifier=d.catalogSourceLabel||'内容 '+(d.sha256||'待核对').slice(0,8);}
 return result;
}
module.exports={augmentProducts,latestFirmware};
