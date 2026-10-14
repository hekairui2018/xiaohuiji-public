'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {modelId}=require('../../domain/identity/model-id.cjs');
function loadKnowledge(dir=path.resolve(__dirname,'../../data/knowledge'),{manifestFile='active-manifest.json'}={}){
 if(!['active-manifest.json','candidate-manifest.json'].includes(manifestFile))throw Error('Invalid knowledge manifest name');
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,manifestFile),'utf8'));
 if(!/^knowledge-[a-f0-9]{16}$/.test(manifest.versionId))throw Error('Invalid knowledge version');
 const bytes=fs.readFileSync(path.join(dir,manifest.versionId,'index.json'));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('Knowledge checksum mismatch');
 const raw=JSON.parse(bytes);if(raw.schemaVersion!=='2.0')throw Error('Invalid knowledge schema');
 const byModel=new Map(),aliases=new Map();
 for(const p of raw.products){if(!p.modelId)continue;if(byModel.has(p.modelId))throw Error('Duplicate knowledge model');byModel.set(p.modelId,p);
  for(const alias of p.aliases){const key=modelId(alias);if(!key)continue;const owners=aliases.get(key)||new Set();owners.add(p.modelId);aliases.set(key,owners);}}
 const caseIds=new Set();for(const c of raw.cases){if(caseIds.has(c.stableId))throw Error('Duplicate stable case ID');caseIds.add(c.stableId);if(c.checks.length&&!c.sourceReference?.sha256)throw Error('Unsourced checks');}
 const clone=x=>structuredClone(x);
 const evidence=[];
 for(const source of raw.sources.filter(s=>s.file.startsWith('v2/data/evidence/knowledge-source-batch-'))){
  const sourceBytes=fs.readFileSync(path.resolve(__dirname,'../../..',source.file));
  if(crypto.createHash('sha256').update(sourceBytes).digest('hex')!==source.sha256)throw Error('Evidence checksum mismatch');
  const bundle=JSON.parse(sourceBytes);for(const document of bundle.documents||[])evidence.push({document,source});
 }
 const reviewFile='v2/data/evidence/knowledge-source-audit-20261014-stage14.json';
 const reviews=[];
 if(raw.sources.some(s=>s.file==='v2/data/evidence/knowledge-source-batch-20261014-stage14.json')){
  const reviewBytes=fs.readFileSync(path.resolve(__dirname,'../../..',reviewFile));
  if(crypto.createHash('sha256').update(reviewBytes).digest('hex')!=='d601908a7a23ed31c85126c4095222828445f7e90c0efe1f1f764f6290e4887b')throw Error('Audited case evidence checksum mismatch');
  // This is the already-audited original excerpt, not a new compatibility rule.
  for(const review of JSON.parse(reviewBytes).caseEvidenceReview||[]){
   const document=evidence.find(e=>e.document.sha256===review.originalSha256)?.document;
   if(review.rawText&&document)reviews.push({...review,sourceReference:{file:reviewFile,sha256:crypto.createHash('sha256').update(reviewBytes).digest('hex'),originalSha256:review.originalSha256,originalPath:document.originalPath,originalName:document.name,locator:review.locator,sourceType:document.sourceType,verificationStatus:'reference_only'}});
  }
 }
 return Object.freeze({version:manifest.versionId,counts:Object.freeze(manifest.counts),
  findProducts(value){const id=modelId(value),owners=aliases.get(id);return clone(byModel.has(id)?[byModel.get(id)]:owners?[...owners].map(key=>byModel.get(key)):[]);},
  evidenceDocuments:()=>clone(evidence),
  evidenceCaseReviews:()=>clone(reviews),
  search(value){const exact=this.findProducts(value);if(exact.length)return exact;const text=String(value||'').toLowerCase();if(!text.trim())return [];return clone(raw.products.filter(p=>[p.displayName,...p.aliases].some(x=>x.toLowerCase().includes(text))));},
  products:()=>clone(raw.products),cases:()=>clone(raw.cases),assets:()=>clone(raw.assets),sources:()=>clone(raw.sources),audit:()=>clone({rejectedDocuments:raw.rejectedDocuments,parameterConflicts:raw.parameterConflicts,receiverEvidence:raw.receiverEvidence,duplicateGroups:raw.duplicateGroups})});
}
module.exports={loadKnowledge};
