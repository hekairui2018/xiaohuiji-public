'use strict';
// Add original-source associations to the existing schema. Never activate or rewrite facts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {mentionsModel,documentBelongs}=require('../domain/identity/document-identity.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const norm=x=>String(x||'').replace(/\s+/g,'').toLowerCase();
const TARGETS=new Set(['HD-R712','HD-R716','HD-A3L','HD-VP620A','HD-C16L','HD-C16H']);
const EXPERIENCE_TYPES=new Set(['engineering','training','project']);
function append(record,ref){
 const refs=record.sourceReferences||[record.sourceReference].filter(Boolean);
 const added=!refs.some(r=>JSON.stringify(r)===JSON.stringify(ref));if(added)refs.push(ref);
 record.sourceReferences=refs;return added;
}
function enrich(base,evidence,evidenceReference){
 const next=structuredClone(base),counts={products:0,documents:0,claims:0,cases:0,firmware:0,software:0,officialDocuments:0,engineeringDocuments:0,trainingDocuments:0,projectDocuments:0,unknownFirmware:0,aiSummary:0};
 const targets=evidence.targetModels?new Set(evidence.targetModels):TARGETS;
 const proof=(doc,page,sourceType,status)=>({...evidenceReference,originalSha256:doc.sha256,originalPath:doc.originalPath,originalName:doc.name,page:page.page, ...(page.locator?{locator:page.locator}:{}),documentVersion:doc.pages[0].text.match(/\bV\d+(?:\.\d+)+/i)?.[0]||null,sourceType,verificationStatus:status,verificationScope:sourceType==='official'?'literal statement / model identity in this document version, not hardware approval':'historical record / scoped document reference, not a universal rule'});
 for(const p of next.products){
  const specs=evidence.documents.filter(d=>d.sourceType==='official'&&d.verificationStatus==='verified'&&d.format==='.pdf'&&targets.has(p.modelId)&&documentBelongs(d.name,p.modelId)&&mentionsModel(d.pages[0].text,p.modelId)&&d.pages.some(pg=>/深圳市灰度科技|Shenzhen\s+Huidu/i.test(pg.text)));
  for(const d of specs){
   const identity=proof(d,d.pages[0],'official','verified');append(p,identity);
   let document=p.documents.find(x=>x.name===d.name);const created=!document;
   if(!document){document={name:d.name,kind:'spec',url:null,sourceReference:identity,sourceType:'official',verificationStatus:'verified',identityEvidence:null};p.documents.push(document);}
   const added=append(document,identity);document.sourceType='official';if(created||added){counts.documents++;counts.officialDocuments++;}
  }
  for(const c of p.claims){
   if(evidence.claimPriorityFields&&!evidence.claimPriorityFields.includes(c.field)&&!/(?:chip|firmware|PWM|HUB|USB|HDMI|limit|maximum|芯片|固件|兼容|限制|不支持|选配|最大|输入|输出)/i.test(c.text))continue;
   const hits=specs.flatMap(d=>d.pages.filter(pg=>norm(pg.text).includes(norm(c.text))).map(pg=>({d,pg})));
   if(!hits.length)continue;
   let changed=false;for(const {d,pg} of hits)changed=append(c,{...proof(d,pg,'official','verified'),excerpt:c.text,conditions:pg.text.split('\n').filter(line=>/实际带载|actual.*load|打折|折叠|选配|optional/i.test(line))})||changed;
   c.sourceType='official';if(c.verificationStatus==='indexed-not-content-verified')c.verificationStatus='verified';if(changed)counts.claims++;
  }
  for(const d of evidence.documents.filter(d=>d.format==='.pptx'&&EXPERIENCE_TYPES.has(d.sourceType))){
   const pages=d.pages.filter(pg=>mentionsModel(pg.text,p.modelId));if(!pages.length)continue;
   for(const pg of pages){const ref={...proof(d,pg,d.sourceType,'reference_only'),applicability:'page-discusses-model; other pages and other devices are not automatically applicable'};
    let doc=p.documents.find(x=>x.name===d.name);
    if(!doc){doc={name:d.name,kind:'presentation',url:null,sourceReference:ref,sourceType:d.sourceType,verificationStatus:'reference_only',identityEvidence:null};p.documents.push(doc);counts.documents++;counts[d.sourceType+'Documents']++;}
    append(doc,ref);append(p,ref);
   }
  }
  for(const f of p.firmware){const physical=evidence.firmware.filter(x=>x.modelId===p.modelId&&x.file===f.file);
   if(!physical.length)continue;
   let changed=false;for(const file of physical)changed=append(f,{...evidenceReference,originalPath:file.path,originalSha256:file.sha256,sourceType:'unknown',verificationStatus:'reference_only',verificationScope:'exact filename / byte hash only; issuer, chip, hardware and compatibility remain unverified'})||changed;
   // Folder/file name alone does not establish manufacturer authorship.
   f.sourceType='unknown';if(changed){counts.firmware++;counts.unknownFirmware++;}
  }
 }
 for(const c of next.cases){
  if(evidence.casePriority&&!evidence.casePriority.includes(c.legacyId))continue;
  const excerpt=norm(c.sourceExcerpt);if(excerpt.length<30)continue;
  const matches=evidence.documents.filter(d=>['.pptx','.docx'].includes(d.format)&&EXPERIENCE_TYPES.has(d.sourceType)).flatMap(d=>d.pages.filter(pg=>(!pg.caseId||pg.caseId===c.legacyId)&&(norm(pg.text).includes(excerpt)||(pg.partialRecord&&c.checks.some(ch=>ch.checkId===pg.supportedCheckId&&norm(pg.text).includes(norm(ch.text)))))).map(pg=>({d,pg,supported:!pg.partialRecord&&c.checks.every(ch=>norm(pg.text).includes(norm(ch.text)))&&(!c.historicalSolution||norm(pg.text).includes(norm(c.historicalSolution)))&&(c.modelIds||[]).every(id=>mentionsModel(pg.text,id))&&['chips','pitches','scans','softwareVersions','firmwareVersions'].every(field=>(c.scope[field]||[]).every(value=>pg.text.includes(value)))})));
  if(!matches.length)continue;
  let changed=false;for(const {d,pg,supported} of matches){
   const annotation=(evidence.caseAnnotations||[]).find(a=>a.legacyId===c.legacyId&&a.originalSha256===d.sha256&&a.page===pg.page&&norm(pg.text).includes(norm(a.conditionText)));
   if(annotation)for(const [field,values]of Object.entries(annotation.scope)){
    if(!c.scope[field]?.length&&values.every(v=>pg.text.includes(v)))c.scope[field]=[...values];
   }
   changed=append(c,{...proof(d,pg,d.sourceType,supported?'verified_by_case':'reference_only'),excerpt:pg.partialRecord?c.checks.find(ch=>ch.checkId===pg.supportedCheckId).text:c.sourceExcerpt,...(pg.partialRecord?{supportedField:'checks',supportedCheckId:pg.supportedCheckId}:{}),conditions:annotation?.conditionText||null})||changed;
  }
  // Preserve an already complete record when a later source only supports a fragment.
  if(c.verificationStatus!=='verified_by_case')c.sourceType=matches.find(m=>m.supported)?.d.sourceType||matches[0].d.sourceType;
  if(matches.some(m=>m.supported))c.verificationStatus='verified_by_case';else if(c.verificationStatus!=='verified_by_case')c.verificationStatus='reference_only';if(changed)counts.cases++;
 }
 for(const group of ['software','manuals'])for(const asset of next.assets[group]||[]){
  const physical=(evidence.software||[]).filter(raw=>raw.group===group&&raw.resourceKey===asset.ossKey&&raw.file===asset.file&&raw.sizeBytes===asset.sizeBytes);
  let changed=false;for(const raw of physical){const ref={...evidenceReference,originalPath:raw.path,originalSha256:raw.sha256,originalName:raw.file,sourceType:'unknown',verificationStatus:'reference_only',verificationScope:'exact existing asset filename and size / byte hash only; publisher, downloadable URL equality and compatibility remain unverified'};
   if(!asset.sourceReference){asset.sourceReference=ref;changed=true;}changed=append(asset,ref)||changed;
  }
  if(changed){asset.sourceType='unknown';asset.verificationStatus='reference_only';counts.software++;}
 }
 counts.products=next.products.filter((p,i)=>JSON.stringify(p)!==JSON.stringify(base.products[i])).length;
 // Count affected document records once when several versions/copies share a filename.
 const changedDocuments=next.products.flatMap((p,i)=>p.documents.filter(d=>JSON.stringify(d)!==JSON.stringify(base.products[i].documents.find(old=>old.name===d.name))));
 counts.documents=changedDocuments.length;
 for(const type of ['official','engineering','training','project'])counts[type+'Documents']=changedDocuments.filter(d=>d.sourceType===type).length;
 if(!next.sources.some(s=>s.file===evidenceReference.file&&s.sha256===evidenceReference.sha256))next.sources.push(evidenceReference);
 return {next,counts};
}
function saveCandidate(root=path.resolve(__dirname,'../..'),{evidenceFile='v2/data/evidence/knowledge-source-batch-20261014.json',incremental=false}={}){
 const manifestFile=path.join(root,'v2/data/knowledge/active-manifest.json'),activeBefore=fs.readFileSync(manifestFile),active=JSON.parse(activeBefore);
 if(!incremental&&fs.existsSync(path.join(root,'v2/data/knowledge-next/candidate-manifest.json')))throw Error('Candidate already exists; append explicit incremental evidence instead of rebuilding from active');
 const parent=incremental?JSON.parse(fs.readFileSync(path.join(root,'v2/data/knowledge-next/candidate-manifest.json'))):active;
 const baseBytes=fs.readFileSync(path.join(root,incremental?'v2/data/knowledge-next':'v2/data/knowledge',parent.versionId,'index.json'));
 if(hash(baseBytes)!==parent.sha256)throw Error('Base checksum mismatch');
 if(!/^v2\/data\/evidence\/[^/\\]+\.json$/.test(evidenceFile))throw Error('Use a versioned evidence JSON');
 const evidenceBytes=fs.readFileSync(path.join(root,evidenceFile)),reference={file:evidenceFile,sha256:hash(evidenceBytes)};
 const {next,counts}=enrich(JSON.parse(baseBytes),JSON.parse(evidenceBytes),reference),bytes=Buffer.from(JSON.stringify(next,null,2)+'\n'),sha256=hash(bytes),versionId='knowledge-'+sha256.slice(0,16);
 const dir=path.join(root,'v2/data/knowledge-next',versionId);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'index.json');
 if(fs.existsSync(file)&&hash(fs.readFileSync(file))!==sha256)throw Error('Candidate collision');if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});
 const candidate={...active,versionId,sha256,baseVersion:active.versionId,baseSHA256:active.sha256,parentVersion:parent.versionId,parentSHA256:parent.sha256,counts:{...active.counts},associationCounts:counts,activated:false};
 fs.writeFileSync(path.join(root,'v2/data/knowledge-next/candidate-manifest.json'),JSON.stringify(candidate,null,2)+'\n');
 if(!fs.readFileSync(manifestFile).equals(activeBefore))throw Error('Active manifest unexpectedly changed');return candidate;
}
if(require.main===module)console.log(JSON.stringify(saveCandidate(undefined,process.argv[2]?{evidenceFile:process.argv[2],incremental:true}:{}),null,2));
module.exports={enrich,saveCandidate};
