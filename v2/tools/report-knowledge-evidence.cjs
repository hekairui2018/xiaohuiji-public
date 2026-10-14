'use strict';
// Coverage of existing records, not a new knowledge store or a comparison verdict.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {resolveOriginal}=require('../domain/knowledge/original-provenance.cjs');
const norm=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
const refs=record=>(record.sourceReferences||[record.sourceReference].filter(Boolean));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function readSnapshot(root,directory,manifestName){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,directory,manifestName)));
 const bytes=fs.readFileSync(path.join(root,directory,manifest.versionId,'index.json'));
 if(hash(bytes)!==manifest.sha256)throw Error('Snapshot checksum mismatch');
 return {manifest,knowledge:JSON.parse(bytes)};
}
function coverage(base,next,sourceFiles){
 const productKey=p=>JSON.stringify([p.modelId,p.displayName]);
 const oldProducts=new Map(base.products.map(p=>[productKey(p),p])),oldCases=new Map(base.cases.map(c=>[c.stableId,c]));
 const difference=(record,old)=>refs(record).filter(r=>r.originalSha256&&!refs(old||{}).some(o=>JSON.stringify(o)===JSON.stringify(r)));
 const delta={newProducts:0,newCases:0,products:0,claims:0,documents:0,cases:0,firmware:0,software:0,newlyVerifiedClaims:0},added=[];
 const collect=(record,old,key)=>{const changes=difference(record,old);if(changes.length){delta[key]++;added.push(...changes);}return changes;};
 const missingFields=[],parameterCoverage=[],modelRecords=[];
 for(const p of next.products){
  const old=oldProducts.get(productKey(p));if(!old){delta.newProducts++;continue;}
  const productChanges=difference(p,old);added.push(...productChanges);if(JSON.stringify(p)!==JSON.stringify(old))delta.products++;
  for(const c of p.claims){const prior=old.claims.find(x=>x.claimId===c.claimId);collect(c,prior,'claims');if(c.verificationStatus==='verified'&&prior?.verificationStatus!=='verified')delta.newlyVerifiedClaims++;}
  for(const d of p.documents)collect(d,old.documents.find(x=>x.name===d.name),'documents');
  for(const f of p.firmware)collect(f,old.firmware.find(x=>x.file===f.file),'firmware');
  const fields={};
  for(const field of ['productSeries','load','resolution','interfaces','syncSupport','support']){
   const value=p.parameters[field],present=Boolean(String(value||'').trim());
   // A related verified claim does not establish an entire concatenated parameter value.
   const supporting=p.claims.flatMap(refs).filter(r=>r.sourceType==='official'&&r.verificationStatus==='verified').filter(r=>{const raw=resolveOriginal(r,sourceFiles);return raw&&present&&norm(raw.page.text).includes(norm(value));});
   fields[field]={present,wholeValueOriginalSupport:supporting.map(r=>({file:r.file,originalSha256:r.originalSha256,page:r.page}))};
   if(!present)missingFields.push({modelId:p.modelId,field,reason:'absent-in-existing-parameters'});
   else if(!supporting.length)missingFields.push({modelId:p.modelId,field,reason:'existing-value-not-whole-statement-verified'});
  }
  parameterCoverage.push({modelId:p.modelId,fields});
  modelRecords.push({modelId:p.modelId,series:p.parameters.productSeries||null,aliases:p.aliases,verifiedClaimCount:p.claims.filter(c=>c.verificationStatus==='verified').length,sourceVersions:[...new Set(p.documents.flatMap(refs).filter(r=>r.originalSha256).map(r=>r.documentVersion||'version-not-established'))],firmwareFiles:p.firmware.map(f=>({file:f.file,chipHint:f.chipHint||null,hardwareFromFile:f.hwFromFile||null,hardwareFromTable:f.hwFromTable||null,originalFileLocated:refs(f).some(r=>r.originalSha256),compatibilityVerified:false}))});
 }
 for(const c of next.cases)if(oldCases.has(c.stableId))collect(c,oldCases.get(c.stableId),'cases');else delta.newCases++;
 for(const group of ['software','manuals'])for(const asset of next.assets[group]||[])collect(asset,(base.assets[group]||[]).find(a=>a.ossKey===asset.ossKey),'software');
 const originalSources=new Map(added.map(r=>[r.originalSha256,{sha256:r.originalSha256,sourceType:r.sourceType,verificationStatus:r.verificationStatus,path:r.originalPath}]));
 const sourceCounts={official:0,engineering:0,training:0,project:0,ai_summary:0,unknown:0};for(const source of originalSources.values())sourceCounts[source.sourceType]=(sourceCounts[source.sourceType]||0)+1;
 const caseVerification={verified:0,reference_only:0,unknown:0};
 for(const c of next.cases){const citations=refs(c).filter(r=>r.originalSha256);const state=citations.some(r=>r.verificationStatus==='verified_by_case')?'verified':citations.length?'reference_only':'unknown';caseVerification[state]++;}
 const groups={A3_A4_A4L:modelRecords.filter(p=>/^HD-A(?:3L?|4L?)$/.test(p.modelId||'')),C:modelRecords.filter(p=>/^HD-C\d/.test(p.modelId||'')),VP:modelRecords.filter(p=>/^HD-VP\d/.test(p.modelId||'')),receivers:modelRecords.filter(p=>/^HD-R\d/.test(p.modelId||''))};
 return {schemaVersion:'2.0',delta,sourceCountUnit:'unique original SHA256 newly associated in this batch',sourceCounts,newOriginalSources:[...originalSources.values()],existingCounts:{products:next.products.length,cases:next.cases.length,claims:next.products.reduce((n,p)=>n+p.claims.length,0)},verifiedClaims:next.products.reduce((n,p)=>n+p.claims.filter(c=>c.verificationStatus==='verified').length,0),caseVerification,caseVerificationScope:'verified maps existing verified_by_case to complete historical-source support, not customer resolution; unknown means no new raw citation, not false knowledge',parameterCoverage,missingFieldCounts:{absent:missingFields.filter(f=>f.reason==='absent-in-existing-parameters').length,wholeValueUnverified:missingFields.filter(f=>f.reason==='existing-value-not-whole-statement-verified').length},missingFields,modelGroups:groups,parameterConflicts:next.parameterConflicts,quarantinedDocuments:next.rejectedDocuments.length,activationAssessment:{ready:false,reasons:['Unresolved version/parameter conflicts retained','Whole parameter values and hardware/firmware applicability remain incompletely verified','Candidate success does not authorize changing active-manifest']}};
}
function run(root,output,sourceAuditFile){
 const {manifest,knowledge}=readSnapshot(root,'v2/data/knowledge-next','candidate-manifest.json');
 const baseBytes=fs.readFileSync(path.join(root,'v2/data/knowledge-next',manifest.parentVersion,'index.json'));
 if(hash(baseBytes)!==manifest.parentSHA256)throw Error('Parent checksum mismatch');
 const sources=new Map();for(const source of knowledge.sources){if(!source.file.endsWith('.json'))continue;const bytes=fs.readFileSync(path.join(root,source.file));if(hash(bytes)!==source.sha256)throw Error('Source checksum mismatch');sources.set(source.file,JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));}
 const report={candidateVersion:manifest.versionId,parentVersion:manifest.parentVersion,activeUnchanged:readSnapshot(root,'v2/data/knowledge','active-manifest.json').manifest.versionId===manifest.baseVersion,...coverage(JSON.parse(baseBytes),knowledge,sources)};
 if(sourceAuditFile){
  if(!/^v2\/data\/evidence\/[^/\\]+\.json$/.test(sourceAuditFile))throw Error('Use a local versioned evidence audit');
  const bytes=fs.readFileSync(path.join(root,sourceAuditFile));report.sourceAudit={file:sourceAuditFile,sha256:hash(bytes),...JSON.parse(bytes)};
 }
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
if(require.main===module){const report=run(path.resolve(__dirname,'../..'),process.argv[2],process.argv[3]);console.log(JSON.stringify({delta:report.delta,sourceCounts:report.sourceCounts,verifiedClaims:report.verifiedClaims,caseVerification:report.caseVerification,missingFields:report.missingFields.length},null,2));}
module.exports={coverage,run};
