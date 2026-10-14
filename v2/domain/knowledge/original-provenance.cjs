'use strict';
const {mentionsModel}=require('../identity/document-identity.cjs');
const norm=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
const EXPERIENCE_TYPES=new Set(['engineering','training','project']);
function resolveOriginal(ref,sourceFiles){
 if(!ref.originalSha256||!ref.originalPath)return null;
 const bundle=sourceFiles.get(ref.file),document=bundle?.documents?.find(d=>d.sha256===ref.originalSha256&&d.originalPath===ref.originalPath);
 const page=document?.pages?.find(p=>ref.page===null?p.locator&&p.locator===ref.locator:p.page===ref.page);return page?{document,page}:null;
}
function presentationBelongs(doc,id,sourceFiles){
 if(doc.kind!=='presentation'||!EXPERIENCE_TYPES.has(doc.sourceType)||doc.verificationStatus!=='reference_only')return false;
 return (doc.sourceReferences||[]).some(ref=>{const original=resolveOriginal(ref,sourceFiles);return original&&original.document.format==='.pptx'&&original.document.sourceType===doc.sourceType&&ref.sourceType===doc.sourceType&&original.document.name===doc.name&&mentionsModel(original.page.text,id)&&ref.verificationStatus==='reference_only';});
}
function auditOriginalProvenance(products,cases,sourceFiles,r,assets={}){
 for(const p of products){
  for(const c of p.claims.filter(c=>c.verificationStatus==='verified'))r.check('original-claim:'+c.claimId,c.sourceType==='official'&&(c.sourceReferences||[]).some(ref=>{const original=resolveOriginal(ref,sourceFiles);return original&&original.document.format==='.pdf'&&original.document.sourceType==='official'&&original.document.verificationStatus==='verified'&&ref.sourceType==='official'&&ref.verificationStatus==='verified'&&mentionsModel(original.document.pages[0].text,p.modelId)&&/深圳市灰度科技|Shenzhen\s+Huidu/i.test(original.document.pages.map(pg=>pg.text).join('\n'))&&norm(original.page.text).includes(norm(c.text));}));
  for(const f of p.firmware)for(const ref of (f.sourceReferences||[]).filter(ref=>ref.originalSha256))r.check('original-firmware:'+p.modelId+':'+f.file,ref.sourceType==='unknown'&&ref.verificationStatus==='reference_only'&&sourceFiles.get(ref.file)?.firmware?.some(raw=>raw.modelId===p.modelId&&raw.file===f.file&&raw.sha256===ref.originalSha256&&raw.path===ref.originalPath));
 }
 for(const group of ['software','manuals'])for(const asset of assets[group]||[]){
  const citations=(asset.sourceReferences||[]).filter(ref=>ref.originalSha256);
  if(citations.length)r.check('asset-citation-policy:'+group+':'+asset.file,asset.sourceType==='unknown'&&asset.verificationStatus==='reference_only'&&citations.some(ref=>JSON.stringify(ref)===JSON.stringify(asset.sourceReference)));
  for(const ref of citations)r.check('original-asset:'+group+':'+asset.file,ref.sourceType==='unknown'&&ref.verificationStatus==='reference_only'&&sourceFiles.get(ref.file)?.software?.some(raw=>raw.group===group&&raw.resourceKey===asset.ossKey&&raw.file===asset.file&&raw.sizeBytes===asset.sizeBytes&&raw.sha256===ref.originalSha256&&raw.path===ref.originalPath));
 }
 for(const c of cases)for(const ref of (c.sourceReferences||[]).filter(ref=>ref.originalSha256&&EXPERIENCE_TYPES.has(ref.sourceType))){
  const original=resolveOriginal(ref,sourceFiles),supported=original&&original.document.sourceType===ref.sourceType&&(!original.page.caseId||original.page.caseId===c.legacyId)&&norm(original.page.text).includes(norm(ref.excerpt||c.sourceExcerpt));
  r.check('case-original-citation:'+c.legacyId+':'+(ref.locator||ref.page),Boolean(supported));
  if(ref.supportedField==='checks')r.check('case-original-check:'+c.legacyId,Boolean(supported&&ref.verificationStatus==='reference_only'&&c.checks.some(ch=>ch.checkId===ref.supportedCheckId&&norm(ch.text)===norm(ref.excerpt))));
  if(ref.verificationStatus==='reference_only')r.pending('case-incomplete-record:'+c.legacyId,'Only cited original fields are supported; other fields/conditions or rewrites still require verification');
 }
 for(const c of cases.filter(c=>c.verificationStatus==='verified_by_case'))r.check('original-case:'+c.stableId,EXPERIENCE_TYPES.has(c.sourceType)&&(c.sourceReferences||[]).some(ref=>{const original=resolveOriginal(ref,sourceFiles);return original&&EXPERIENCE_TYPES.has(original.document.sourceType)&&ref.sourceType===original.document.sourceType&&ref.verificationStatus==='verified_by_case'&&norm(c.sourceExcerpt).length>=30&&norm(original.page.text).includes(norm(c.sourceExcerpt))&&c.checks.every(ch=>norm(original.page.text).includes(norm(ch.text)))&&(!c.historicalSolution||norm(original.page.text).includes(norm(c.historicalSolution)))&&(!ref.conditions||norm(original.page.text).includes(norm(ref.conditions)))&&(c.modelIds||[]).every(id=>mentionsModel(original.page.text,id))&&['chips','pitches','scans','softwareVersions','firmwareVersions'].every(field=>(c.scope[field]||[]).every(value=>original.page.text.includes(value)));}));
}
module.exports={resolveOriginal,presentationBelongs,auditOriginalProvenance};
