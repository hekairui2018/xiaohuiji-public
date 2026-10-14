'use strict';
// Offline derivation only: preserves originals, no external model/network.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {modelId}=require('../domain/identity/model-id.cjs');
const {documentBelongs,mentionsModel}=require('../domain/identity/document-identity.cjs');
const {compileWorkflow}=require('../domain/aftersales/compile-workflow.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const norm=x=>String(x||'').replace(/\s+/g,'').toLowerCase();
function buildKnowledge(root=path.resolve(__dirname,'../..')){
 const sources=[];
 const read=relative=>{const bytes=fs.readFileSync(path.join(root,relative));sources.push({file:relative.replace(/\\/g,'/'),sha256:hash(bytes)});return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));};
 const products=read('data/product-index.json').products,specs=read('data/product-specs-index.json').products;
 const firmwares=read('data/firmware-manifest.json').items;
 const assets={software:read('data/software-downloaders-manifest.json').items,manuals:read('data/software-manuals-manifest.json').items,videos:read('data/video-manifest.json').items};
 // Build-time business reference only: export static records, never invoke old services.
 const softwareFile='backend/software-catalog.cjs';sources.push({file:softwareFile,sha256:hash(fs.readFileSync(path.join(root,softwareFile)))});
 const modulePath=require.resolve(path.join(root,softwareFile));delete require.cache[modulePath];const {SOFTWARE}=require(modulePath);
 assets.softwareCatalog=SOFTWARE.map(s=>({...s,sourceReference:sources.at(-1)}));
 const receiverEvidence=read('v2/data/evidence/r708-pdf-audit.json');
 const identityEvidence=read('v2/data/evidence/document-identity-pdf-audit.json');
 for(const evidence of identityEvidence){if(hash(fs.readFileSync(path.join(root,evidence.file)))!==evidence.sha256)throw Error('PDF identity evidence is stale');sources.push({file:evidence.file,sha256:evidence.sha256});}
 const corpus=read('data/aftersales/aftersales-cases.json').cases;
 const sourceCases=new Map();
 for(const file of fs.readdirSync(path.join(root,'data/aftersales/sources')).filter(x=>x.endsWith('.json')).sort()){
  const relative='data/aftersales/sources/'+file,raw=read(relative);
  for(const c of [...(raw.cases||[]),...(raw.entries||[])])if(c.id)sourceCases.set(file+'|'+c.id,{raw:c,reference:sources.at(-1)});
 }
 const productKey=name=>modelId(name)||'literal:'+name;
 const specMap=new Map(specs.map((p,index)=>[productKey(p.product),{...p,index}]));const rejectedDocuments=[];
 const records=products.map((p,index)=>{
  const id=modelId(p.product),s=specMap.get(productKey(p.product))||{},documents=[];
  for(const name of s.specificationFiles||[]){
   if(!documentBelongs(name,id)){rejectedDocuments.push({modelId:id,productDisplayName:p.displayName||p.product,file:name,reason:'exact-model-not-present'});continue;}
   const local=path.join(root,'frontend/official-files',name);
   const remote=(s.officialPdfLinks||[]).find(url=>{try{return decodeURIComponent(url.split('/').pop())===name;}catch{return false;}});
   const identity=identityEvidence.find(e=>e.file.endsWith('/'+name)&&mentionsModel(e.pages[0].text,id));
   documents.push({name,kind:/说明|手册|Instructions/i.test(name)?'manual':/规格|Specification/i.test(name)?'spec':'other',url:fs.existsSync(local)?'/official-files/'+encodeURIComponent(name):remote||null,sourceReference:{...sources[1],record:s.index},verificationStatus:identity?'pdf-header-model-verified-not-all-parameters':'indexed-not-content-verified',identityEvidence:identity?{file:identity.file,sha256:identity.sha256,page:1}:null});
  }
  const claims=[];
  for(const [field,values]of Object.entries(p.fields||{}))for(const text of [...new Set(values||[])])claims.push({claimId:hash(id+'|'+field+'|'+norm(text)).slice(0,20),field,text,sourceReference:{...sources[0],record:index},verificationStatus:'indexed-not-content-verified'});
  return {modelId:id,model:id?.replace(/^HD-/,''),displayName:p.displayName||p.product,aliases:[...new Set([p.product,...(p.aliases||[])])],claims,parameters:s.keyParameters||{},documents,firmware:firmwares.filter(f=>modelId(f.card)===id).map(f=>({...f,sourceReference:sources[2],verificationStatus:'manifest-model-match-not-hardware-compatibility'})),sourceReferences:[sources[0],sources[1]]};
 });
 const parameterConflicts=[];
 for(const p of products){const indexed=(p.facts||[]).join('\n');const pwm=[...indexed.matchAll(/PWM chip[:\s]+(\d+)\s*\*\s*(\d+)/gi)];
  const photo=(p.selector||[]).find(s=>s.label==='芯片推荐')?.text?.match(/PWM[≤<＝=]*(\d+)/);
  if(photo&&pwm.length&&pwm.some(m=>Number(m[1])!==Number(photo[1])))parameterConflicts.push({modelId:modelId(p.product),field:'PWM-recommended-width',claims:[...pwm.map(m=>({text:m[0],source:'indexed-specification-fact'})),{text:photo[0],source:'photo-selector'}],sourceReference:sources[0],verificationStatus:'unresolved-source-version-conflict',decision:null});
 }
 const duplicateGroups=new Map(),cases=[],knownModels=new Set(records.map(p=>p.modelId).filter(Boolean));
 for(const c of corpus){
  const found=sourceCases.get(c.sourceFile+'|'+c.originalId);
  const stableId='case-'+hash(c.sourceFile+'|'+c.originalId+'|'+(c.source?.locator||'')).slice(0,24);
  const sourceText=found?[found.raw.troubleshooting,found.raw.solution,found.raw.sourceExcerpt,...Object.values(found.raw.rawFields||{})].filter(x=>typeof x==='string').join('\n'):'';
  const support=text=>Boolean(found&&text&&!/【.*未/.test(text)&&norm(sourceText).includes(norm(text)));
  const checkText=c.troubleshooting||'',solution=c.solution||'';
  const supported=support(checkText)&&/检查|确认|测试|尝试|关闭|开启|断开|拔|换|调整|改|降低|设置|升级|重新|连接|加载|查看|排查/.test(checkText),solutionSupported=support(solution);
  const symptomText=[c.customerWording,c.phenomenon,c.title].filter(Boolean).join('\n');
  const mentionedModels=(symptomText.match(/(?<![A-Z0-9])(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+-]*/gi)||[]).map(modelId).filter(id=>knownModels.has(id));
  const displayDomain=/黑电平|灰阶|不够纯黑|偏色|色偏|水波纹|摩尔纹|花屏|横线|竖线|鬼影|拖影|闪烁/.test(symptomText);
  const signature=hash(norm(symptomText)+'|'+norm(checkText)+'|'+norm(solution));
  if(!duplicateGroups.has(signature))duplicateGroups.set(signature,[]);duplicateGroups.get(signature).push(stableId);
  cases.push({stableId,legacyId:c.id,originalId:c.originalId,duplicateGroup:signature,domain:displayDomain?'display':c.domain,originalDomain:c.domain,domainEvidence:displayDomain?'explicit-display-phenomenon':'original-classification',subCategory:c.subCategory,recordType:c.recordType,
   modelIds:[...new Set([...(c.products||[]),...(found?.raw.deviceInfo?.products||[])].map(modelId).filter(Boolean).concat(mentionedModels))],
   phenomenon:symptomText,terms:[...new Set([...(c.keywords||[]),...(found?.raw.phenomenonTerms||[])])],
   scope:{chips:c.chips||[],pitches:c.pitches||[],scans:c.scans||[],softwareVersions:c.softwareVersions||[],firmwareVersions:c.firmwareVersions||[]},
   possibleCause:found?.raw.finalCause&&!/【.*未/.test(found.raw.finalCause)?found.raw.finalCause:null,
   checks:supported?[{checkId:'check-'+hash(stableId+'|'+norm(checkText)).slice(0,24),text:checkText,verificationStatus:'literal-source-supported'}]:[],
   historicalSolution:solutionSupported?solution:null,solutionStatus:solutionSupported?'historical-source-supported-not-universal-rule':'source-support-unresolved',
   caseStatus:found?.raw.caseStatus||'unknown',sourceReference:found?{...found.reference,originalId:c.originalId,locator:c.source?.locator||null}:null,
   sourceExcerpt:found?.raw.sourceExcerpt||null,missingEvidence:!found?'original-record-not-found':!supported?'executable-check-not-literally-supported':null});
 }
 for(const c of cases)c.workflow=compileWorkflow(c.checks);
 const buildProvenance=['v2/tools/build-knowledge.cjs','v2/domain/aftersales/compile-workflow.cjs','v2/domain/identity/model-id.cjs','v2/domain/identity/document-identity.cjs'].map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))}));
 const result={schemaVersion:'2.0',sources,buildProvenance,products:records,cases,assets,rejectedDocuments,parameterConflicts,receiverEvidence,duplicateGroups:[...duplicateGroups].filter(([,ids])=>ids.length>1).map(([signature,ids])=>({signature,ids})),policy:'Historical evidence, never universal engineering rules'};
 return result;
}
function saveKnowledge(root=path.resolve(__dirname,'../..')){
 const result=buildKnowledge(root),bytes=Buffer.from(JSON.stringify(result,null,2)+'\n'),sha256=hash(bytes),versionId='knowledge-'+sha256.slice(0,16);
 const dir=path.join(root,'v2/data/knowledge',versionId);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'index.json');
 if(fs.existsSync(file)&&hash(fs.readFileSync(file))!==sha256)throw Error('Existing knowledge version differs');
 if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});
 const manifest={versionId,sha256,counts:{products:result.products.length,cases:result.cases.length,sourceSupportedChecks:result.cases.filter(c=>c.checks.length).length,sourceSupportedSolutions:result.cases.filter(c=>c.historicalSolution).length,rejectedDocuments:result.rejectedDocuments.length}};
 fs.writeFileSync(path.join(root,'v2/data/knowledge/active-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(require.main===module)console.log(JSON.stringify(saveKnowledge(),null,2));
module.exports={buildKnowledge,saveKnowledge};
