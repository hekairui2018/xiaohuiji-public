'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {report}=require('./report.cjs');
const {modelId}=require('../domain/identity/model-id.cjs');
const {documentBelongs}=require('../domain/identity/document-identity.cjs');
const {presentationBelongs,auditOriginalProvenance}=require('../domain/knowledge/original-provenance.cjs');
const norm=x=>String(x||'').replace(/\s+/g,'').toLowerCase();
function auditKnowledge(knowledge,root=path.resolve(__dirname,'../..'),{directory=path.join(root,'v2/data/knowledge'),manifestFile='active-manifest.json'}={}){
 const r=report('knowledge'),sourceFiles=new Map();
 if(!['active-manifest.json','candidate-manifest.json'].includes(manifestFile))throw Error('Invalid knowledge manifest name');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,manifestFile),'utf8'));
 const snapshot=fs.readFileSync(path.join(directory,knowledge.version,'index.json'));
 r.check('knowledge-version-consistency',manifest.versionId===knowledge.version&&crypto.createHash('sha256').update(snapshot).digest('hex')===manifest.sha256&&manifest.versionId==='knowledge-'+manifest.sha256.slice(0,16));
 for(const source of knowledge.sources())try{const bytes=fs.readFileSync(path.join(root,source.file));r.check('source-hash:'+source.file,crypto.createHash('sha256').update(bytes).digest('hex')===source.sha256);if(source.file.endsWith('.json'))sourceFiles.set(source.file,JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));}catch(error){r.check('source-readable:'+source.file,false,error.message);}
 const products=knowledge.products(),cases=knowledge.cases(),index=sourceFiles.get('data/product-index.json'),specs=sourceFiles.get('data/product-specs-index.json');
 r.check('inventory-counts',products.length===knowledge.counts.products&&cases.length===knowledge.counts.cases&&products.length===index?.products.length);
 r.check('unique-product-identities',new Set(products.filter(p=>p.modelId).map(p=>p.modelId)).size===products.filter(p=>p.modelId).length);
 r.check('stable-case-identities',new Set(cases.map(c=>c.stableId)).size===cases.length);
 for(const [a,b]of [['A3','A3L'],['VP620','VP620A'],['R512','R512T'],['133M','133MC']])r.check('near-model-isolation:'+a,knowledge.findProducts(a).every(p=>p.modelId!==modelId(b)));
 for(const p of products){const original=index?.products.find(x=>(x.displayName||x.product)===p.displayName),spec=specs?.products.find(x=>(x.displayName||x.product)===p.displayName);
  r.check('product-origin:'+p.displayName,Boolean(original&&spec&&JSON.stringify(spec.keyParameters||{})===JSON.stringify(p.parameters)));
  r.check('claim-origin:'+p.displayName,p.claims.every(c=>original?.fields?.[c.field]?.includes(c.text)&&c.sourceReference?.sha256));
  r.check('documents-isolated:'+p.displayName,p.documents.every(d=>documentBelongs(d.name,p.modelId)||presentationBelongs(d,p.modelId,sourceFiles)));
  r.check('firmware-isolated:'+p.displayName,p.firmware.every(f=>modelId(f.card)===p.modelId&&f.sourceReference?.sha256));
 }
 for(const c of cases){const raw=sourceFiles.get(c.sourceReference?.file),record=[...(raw?.cases||[]),...(raw?.entries||[])].find(x=>x.id===c.originalId);
  r.check('case-origin:'+c.stableId,Boolean(record));const text=record?[record.troubleshooting,record.solution,record.sourceExcerpt,...Object.values(record.rawFields||{})].filter(v=>typeof v==='string').join('\n'):'';
  r.check('procedure-supported:'+c.stableId,c.checks.every(check=>norm(text).includes(norm(check.text))));
  r.check('workflow-complete:'+c.stableId,c.checks.every(check=>(c.workflow?.nodes||[]).filter(n=>n.parentCheckId===check.checkId).map(n=>n.text).join('')===check.text));
  r.check('historical-solution-supported:'+c.stableId,!c.historicalSolution||norm(text).includes(norm(c.historicalSolution)));
 }
 auditOriginalProvenance(products,cases,sourceFiles,r,knowledge.assets());
 const audit=knowledge.audit();r.check('conflicts-not-silently-resolved',(audit.parameterConflicts||[]).every(c=>c.verificationStatus==='unresolved-source-version-conflict'&&c.decision===null));
 for(const c of audit.parameterConflicts||[])r.pending('parameter-conflict:'+c.modelId,'版本/工况冲突没有足够证据自动选一份当真值',c);
 r.pending('quarantined-applicability','保留隔离资料，自动分类不等于证明附件或硬件变体适用',{count:audit.rejectedDocuments.length});
 r.pending('source-content-completeness','来源一致不等于所有规格参数和硬件版本已独立验证');return r.finish();
}
module.exports={auditKnowledge};
