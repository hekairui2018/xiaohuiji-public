'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {modelId}=require('../domain/identity/model-id.cjs');
const {documentBelongs}=require('../domain/identity/document-identity.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function audit(){
 const prior=require('../data/knowledge/knowledge-ed5bf2cf82aa5239/index.json'),knowledge=loadKnowledge();
 const products=JSON.parse(fs.readFileSync('data/product-index.json')).products,specs=JSON.parse(fs.readFileSync('data/product-specs-index.json')).products;
 const legacyId=name=>{const old=prior.products.find(p=>p.displayName===name||p.aliases.includes(name));return old?.modelId||null;};
 const oldSpecMap=new Map(specs.map(s=>[legacyId(s.product),s]));
 const remaining=new Map();prior.rejectedDocuments.forEach(r=>{const key=r.modelId+'|'+r.file;remaining.set(key,(remaining.get(key)||0)+1);});
 const rows=[],ownerCache=new Map(),pdfEvidence=require('../data/evidence/document-identity-pdf-audit.json');
 for(const p of products){const oldId=legacyId(p.product),oldSpec=oldSpecMap.get(oldId);for(const file of oldSpec?.specificationFiles||[]){const key=oldId+'|'+file;
  if(!remaining.get(key))continue;remaining.set(key,remaining.get(key)-1);
  const id=modelId(p.product),current=knowledge.products().find(x=>x.displayName===(p.displayName||p.product));
  if(!ownerCache.has(file))ownerCache.set(file,products.filter(x=>documentBelongs(file,modelId(x.product))).map(x=>x.product));
  let category,decision;
  if(oldSpec.product!==p.product&&!oldId){category='invalid-null-source-join';decision='corrected-source-join-not-document-approval';}
  else if(documentBelongs(file,id)){category='exact-pro-plus-identity-format';decision='restore-exact-identity-only';}
  else if(/USB无线|4G模块|Quectel|LTE.*模块/.test(file)){category='accessory-applicability';decision='hold-until-applicability-evidence';}
  else if(/\([A-Z]\)/i.test(file)){category='hardware-variant';decision='hold-until-version-evidence';}
  else if(ownerCache.get(file).length){category='other-exact-model';decision='keep-separated';}
  else{category='identity-not-established';decision='hold-until-source-evidence';}
  const evidence=pdfEvidence.find(d=>d.file.endsWith('/'+file));
  rows.push({auditId:'doc-'+hash(p.product+'|'+file+'|'+rows.length).slice(0,20),product:p.product,modelId:id,file,category,decision,filenameOwners:ownerCache.get(file),
   previousSourceProduct:oldSpec.product,currentSourceProduct:specs.find(s=>s.product===p.product)?.product||null,currentDocumentAttached:Boolean(current?.documents.some(d=>d.name===file)),pdfEvidence:evidence?{file:evidence.file,sha256:evidence.sha256,pages:evidence.pages.map(p=>p.page)}:null});
 }}
 if(rows.length!==prior.rejectedDocuments.length||[...remaining.values()].some(n=>n!==0))throw Error('Quarantine reconciliation incomplete');
 const byCategory={};for(const row of rows)byCategory[row.category]=(byCategory[row.category]||0)+1;
 const sourceFiles=['data/product-index.json','data/product-specs-index.json','v2/data/knowledge/knowledge-ed5bf2cf82aa5239/index.json','v2/data/evidence/document-identity-pdf-audit.json'];
 return {schemaVersion:'2.0',baselineCount:rows.length,currentQuarantine:knowledge.counts.rejectedDocuments,byCategory,sources:sourceFiles.map(file=>({file,sha256:hash(fs.readFileSync(file))})),rows};
}
if(require.main===module){const report=audit();fs.writeFileSync('v2/data/evidence/document-association-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({baseline:report.baselineCount,current:report.currentQuarantine,byCategory:report.byCategory},null,2));}
module.exports={audit};
