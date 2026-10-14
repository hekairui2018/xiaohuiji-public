'use strict';
// Fixed source-backed business comparisons. Failures are retained; no fixture adjustment or activation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),vm=require('node:vm');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{loadDataset}=require('../adapters/data/load-dataset.cjs'),{createApp}=require('../app/bootstrap.cjs');
const {formatReply}=require('../adapters/http/dialogue-service.cjs'),{createAcceptance}=require('../acceptance/index.cjs'),{resolveOriginal}=require('../domain/knowledge/original-provenance.cjs'),{mentionsModel}=require('../domain/identity/document-identity.cjs'),{report}=require('../acceptance/report.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),norm=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
const refs=r=>r?.sourceReferences||[r?.sourceReference].filter(Boolean);
function sourceMap(knowledge,root){const result=new Map();for(const source of knowledge.sources().filter(s=>s.file.startsWith('v2/data/evidence/knowledge-source-batch-'))){const bytes=fs.readFileSync(path.join(root,source.file));if(hash(bytes)!==source.sha256)throw Error('Evidence checksum mismatch');result.set(source.file,JSON.parse(bytes));}return result;}
function productProjection(result){return (result.records||result.knowledge?.records||[]).map(p=>({modelId:p.modelId,parameters:p.parameters,claims:(p.claims||[]).map(c=>c.text),documents:(p.documents||[]).map(d=>({name:d.name,kind:d.kind,url:d.url}))}));}
async function product(sample,app,knowledge,sources){
 const r=report('product'),raw=sample.kind==='revision'?await app.resourceLookup(sample.query,{providedDevices:sample.providedDevices}):await app.dialogue(sample.query||sample.input.topic),quick=await app.quickLookup({modelId:sample.model}),p=quick.records[0],reply=sample.kind==='revision'?formatReply({resources:raw}):formatReply(raw);
 r.check('exact-model-recognized',quick.status==='found'&&quick.records.length===1&&p.modelId==='HD-'+sample.model);
 if(sample.kind!=='revision')r.check('natural-language-near-model-isolation',raw.operation==='consultation'&&raw.normalizedDemand?.providedDevices?.length===1&&raw.normalizedDemand.providedDevices[0].modelId==='HD-'+sample.model);
 const proofCount=(p?.claims||[]).filter(c=>refs(c).some(ref=>{const original=resolveOriginal(ref,sources);return ref.sourceType==='official'&&ref.verificationStatus==='verified'&&original?.document.sourceType==='official'&&mentionsModel(original.document.pages[0].text,p.modelId)&&norm(original.page.text).includes(norm(c.text));})).length;
 if(sample.kind==='model'){if(proofCount)r.check('claims-have-independent-original-citations',true,{count:proofCount});else r.pending('original-claim-support-not-established','No complete original citation for this model in the returned knowledge; not proof that its values are false');}
 if(sample.kind==='contamination')r.check('no-foreign-device-text-in-load-or-reply',!String(p?.parameters?.load||'').includes(sample.forbiddenText)&&!reply.includes(sample.forbiddenText),{forbiddenText:sample.forbiddenText,source:sample.source});
 if(sample.kind==='version'){
  r.check('requested-edition-height-answered',new RegExp('\\b'+sample.expectedHeight+'\\b').test(reply),sample.evidence);
  // Commas in numbers and an equivalent original language edition are not source errors.
  const linked=(raw.knowledge?.records||[]).flatMap(p=>p.claims).some(c=>c.text.replace(/,/g,'').includes(String(sample.expectedHeight))&&refs(c).some(ref=>{const original=resolveOriginal(ref,sources);return original&&ref.sourceType==='official'&&ref.verificationStatus==='verified'&&ref.documentVersion===sample.expectedVersion&&mentionsModel(original.document.pages[0].text,'HD-'+sample.model)&&norm(original.page.text).includes(norm(c.text));}));
  r.check('requested-edition-answer-bound-to-original',linked,sample.evidence);
  r.pending('edition-hardware-applicability','Original editions disagree; hardware and firmware applicability is not established');
 }
 if(sample.kind==='revision')r.check('unknown-hardware-not-assumed-compatible',raw.status===sample.expectedStatus&&!raw.items?.length);
 return {audit:r.finish(),raw,quick,reply,originalClaimCount:proofCount,projection:productProjection(quick)};
}
async function aftersales(sample,app,knowledge,originals){
 const raw=await app.dialogue(sample.input),r=report('aftersales'),d=raw.diagnosis,target=knowledge.cases().find(c=>c.stableId===sample.stableId),reply=formatReply(raw);
 r.check('no-premature-final-cause',raw.status!=='ready'&&!d?.conclusion);
 r.check('requires-more-observations',raw.status==='needs_input'&&Boolean(raw.missing_parameters?.length));
 const invariant=createAcceptance({dataset:loadDataset(),knowledge}).aftersales(raw,sample.input);r.check('existing-diagnosis-invariants',invariant.automaticPassed);
 if(sample.rawReference.length){
  const supported=sample.rawReference.some(ref=>{const original=resolveOriginal(ref,originals);if(!original)return false;
   if(sample.expected.verificationStatus==='reference_only')return ref.verificationStatus==='reference_only'&&norm(original.page.text).includes(norm(ref.excerpt||target.sourceExcerpt));
   return ref.verificationStatus==='verified_by_case'&&norm(original.page.text).includes(norm(target.sourceExcerpt))&&target.checks.every(c=>norm(original.page.text).includes(norm(c.text)))&&(!target.historicalSolution||norm(original.page.text).includes(norm(target.historicalSolution)))&&target.modelIds.every(id=>mentionsModel(original.page.text,id))&&Object.values(sample.expected.scope).every(values=>values.every(v=>original.page.text.includes(v)));
  });r.check('frozen-case-evidence-independently-supported',supported);
 }
 let next=null,nextReply=null,rejected=null,resolution=null;const simulatedPath=[];
 if(d?.activeCaseId){r.check('scope-before-execution',d.state==='confirm-scope'&&d.checks.some(c=>c.checkId===d.activeCaseId+'-scope'&&c.scope));
  const confirmed={...sample.input,observations:[{checkId:d.activeCaseId+'-scope',result:'pass'}]};next=await app.dialogue(confirmed);nextReply=formatReply(next);
  rejected=await app.dialogue({...sample.input,observations:[{checkId:d.activeCaseId+'-scope',result:'fail'}]});r.check('negative-scope-does-not-resolve-fault',rejected.status==='needs_input'&&!rejected.diagnosis?.conclusion&&rejected.diagnosis?.activeCaseId!==d.activeCaseId);
  let flow=next;const observations=[...confirmed.observations];
  for(let step=0;step<12&&flow.diagnosis?.activeCaseId===d.activeCaseId&&flow.status!=='ready';step++){
   simulatedPath.push({state:flow.diagnosis.state,activeCheckId:flow.diagnosis.activeCheckId});
   const checkId=flow.diagnosis.state==='verify-phenomenon'?d.activeCaseId+'-resolution':flow.diagnosis.activeCheckId;if(!checkId)break;
   const previous=observations.find(o=>o.checkId===checkId);if(previous?.result==='pass')break;if(previous)previous.result='pass';else observations.push({checkId,result:'pass'});
   flow=await app.dialogue({...sample.input,observations});
  }
  resolution=flow;
  if(flow.status==='ready')r.check('simulated-resolution-is-customer-observation-only',flow.diagnosis.conclusion?.kind==='customer-observation'&&createAcceptance({dataset:loadDataset(),knowledge}).aftersales(flow,{...sample.input,observations}).automaticPassed);
  else r.pending('simulation-not-converged','The source flow did not converge within a bounded simulated path; no hardware success assumed');
 }
 const found=d?.candidates?.find(c=>c.caseId===sample.stableId);
 if(['verified_by_case','reference_only'].includes(sample.expected.verificationStatus))r.check('original-verification-state-exposed',Boolean(found?.verificationStatus===sample.expected.verificationStatus),{expected:sample.expected.verificationStatus,actual:found?.verificationStatus||null});
 if(sample.rawReference.length)r.check('raw-source-citation-exposed',Boolean(d?.sourceReferences?.some(ref=>ref.originalSha256)||found?.sourceReferences?.some(ref=>ref.originalSha256)));
 if(!target.checks.length)r.pending('historical-record-not-executable','Target record has historical solution/source evidence but no structured checks; replay does not establish an executable diagnosis',{caseId:sample.id,historicalSolutionPresent:Boolean(target.historicalSolution)});
 if(sample.id==='AS-0306'){
  const scopeText=JSON.stringify(d?.checks?.find(c=>c.checkId?.endsWith('-scope'))?.scope||{});r.check('required-raw-chip-and-scan-conditions-asked',['LS9932','LS9708P','64S'].every(x=>scopeText.includes(x)),{source:'stage13/14 original Word record, not inferred compatibility'});
 }
 r.pending('actual-field-resolution','Multiround pass/fail inputs are simulations, not hardware or customer solution proof');
 return {audit:r.finish(),raw,reply,next,nextReply,rejected,resolution,simulatedPath,targetCase:{stableId:target.stableId,verificationStatus:target.verificationStatus||'unknown',scope:target.scope,checkCount:target.checks.length,sourceReferences:refs(target)},sourceRecordInTop3:Boolean(found),projection:{status:raw.status,diagnosis:d,reply,nextReply,resolutionStatus:resolution?.status,resolutionState:resolution?.diagnosis?.state}};
}
async function ordering(sample,app,knowledge,dataset){
 const raw=await app.dialogue(sample.input),ssm=await app.exportSsm(sample.input),r=report('ordering');
 let referenceAssessment=null;
 if(sample.input.architecture==='direct'){
  const bytes=fs.readFileSync(path.resolve(__dirname,'../../reference/official-selection-tool/official-selection-bundle.js'));if(hash(bytes)!==dataset.source.sha256)throw Error('Official JS checksum mismatch');
  const source=bytes.toString(),start=source.indexOf('C=k=>{if(["D10"'),end=source.indexOf(';return{PublicFilterSendingCard',start);if(start<0||end<=start)throw Error('Official async selector not located');
  const d=sample.input,m=dataset.modules().find(m=>m.dotPitch.spacing===d.module.pitchMm&&m.resolution[0]===d.module.pixelWidth&&m.resolution[1]===d.module.pixelHeight&&m.scanningMethod===d.module.scan.denominator+'S'),device=dataset.findProducts(d.providedDevices[0].modelId)[0],val=value=>({value});
  const original=vm.runInNewContext('('+source.slice(start+2,end)+')',{r:val(d.screen.moduleColumns),i:val(d.screen.moduleRows),v:val(m.dotPitch.spacing),s:val(d.screen.moduleRows*m.resolution[1]),o:val(d.screen.moduleColumns*m.size[0]),t:val({long:m.size[0],width:m.size[1]}),d:val({model:''}),console},{timeout:1000});
  const officialFits=original(device);referenceAssessment={officialFits,sourceSHA256:dataset.source.sha256,moduleId:m.id,fixtureExpectationValid:sample.expectedStatus!=='ready'||officialFits};
  if(sample.expectationCorrection)r.check('corrected-expectation-bound-to-original',officialFits===sample.expectationCorrection.officialFits&&sample.expectationCorrection.source.sha256===dataset.source.sha256,sample.expectationCorrection);
  r.check('engine-obeys-original-direct-selection',officialFits===Boolean(raw.status==='ready'));
 }
 if(sample.expectedStatus==='protected'){
  const safe=raw.status!=='ready'||raw.plan.cells.every(c=>c.columns*raw.plan.module.resolution[0]<=128&&c.rows*raw.plan.module.resolution[1]<=512);r.check('R708-disputed-profile-not-assumed',safe);
 }else r.check('fixed-scenario-status',raw.status===sample.expectedStatus,{expected:sample.expectedStatus,actual:raw.status});
 if(raw.status==='ready'){
  r.check('BOM-port-topology-and-device-constraints',createAcceptance({dataset,knowledge}).ordering(raw).automaticPassed);
  const grid=sample.input.cabinet?{cols:sample.input.cabinet.moduleColumns*sample.input.cabinet.columns,rows:sample.input.cabinet.moduleRows*sample.input.cabinet.rows}:{cols:sample.input.screen.moduleColumns,rows:sample.input.screen.moduleRows};
  r.check('independent-pixel-arithmetic',raw.plan.screen.pixelWidth===grid.cols*sample.input.module.pixelWidth&&raw.plan.screen.pixelHeight===grid.rows*sample.input.module.pixelHeight&&raw.plan.screen.points===grid.cols*grid.rows*sample.input.module.pixelWidth*sample.input.module.pixelHeight);
  r.check('independent-module-BOM',raw.bom.find(b=>b.kind==='module')?.quantity===grid.cols*grid.rows);
  if(raw.plan.architecture==='direct')r.check('no-fictitious-direct-SSM',ssm.status==='unsupported');else r.check('SSM-structure-CRC-grid-and-coordinates',ssm.status==='ready'&&ssm.acceptance.automaticPassed);
  if(sample.gridReference){const bytes=fs.readFileSync(path.resolve(__dirname,'../..',sample.gridReference.file));if(hash(bytes)!==sample.gridReference.sha256)throw Error('Real engineering fixture checksum mismatch');const original=require('../domain/ordering/output/ssm-codec.cjs').gridEnvelope(bytes.toString()).gridXml;r.check('actual-HDSet-engineering-grid-byte-identical',ssm.status==='ready'&&ssm.gridXml.trim()===original.trim(),sample.gridReference);}
 }else r.check('blocked-demand-has-no-ready-SSM',ssm.status!=='ready');
 r.pending('hardware-compatibility','Official static rules and mathematical/file validation do not prove physical hardware compatibility');
 return {audit:r.finish(),raw,reply:formatReply(raw),referenceAssessment,ssm:{status:ssm.status,reason:ssm.reason,xmlSHA256:ssm.xml?hash(ssm.xml):null,acceptance:ssm.acceptance},projection:{status:raw.status,plan:raw.plan,bom:raw.bom,topology:raw.topology,ssmStatus:ssm.status,xmlSHA256:ssm.xml?hash(ssm.xml):null}};
}
async function run(output,{httpBase}={}){
 const root=path.resolve(__dirname,'../..'),dir=path.resolve(root,output);if(!dir.startsWith(path.join(root,'tmp')+path.sep)||fs.existsSync(path.join(dir,'receipt.json')))throw Error('Use a new workspace tmp result directory');fs.mkdirSync(dir,{recursive:true});
 const setFile='v2/data/evidence/knowledge-fc9-business-set-20261014.json',setBytes=fs.readFileSync(path.join(root,setFile)),set=JSON.parse(setBytes),activeBytes=fs.readFileSync(path.join(root,'v2/data/knowledge/active-manifest.json')),candidate=loadKnowledge(path.join(root,'v2/data/knowledge-next'),{manifestFile:'candidate-manifest.json'}),old=loadKnowledge(),dataset=loadDataset();
 const engineeringFile='v2/data/evidence/knowledge-fc9-engineering-fixture-20261014.json',engineeringBytes=fs.readFileSync(path.join(root,engineeringFile));set.ordering.push(JSON.parse(engineeringBytes));
 const correctionFile='v2/data/evidence/business-expectation-corrections.json',corrections=JSON.parse(fs.readFileSync(path.join(root,correctionFile),'utf8')).corrections;
 for(const correction of corrections){const sample=set.ordering.find(s=>s.id===correction.id);if(!sample||sample.expectedStatus!==correction.previousExpectedStatus||hash(fs.readFileSync(path.join(root,correction.source.file)))!==correction.source.sha256)throw Error('Invalid expectation correction');sample.expectedStatus=correction.expectedStatus;sample.expectationCorrection=correction;}
 if(old.version!==set.baseline||candidate.version!==set.candidate)throw Error('Fixed comparison version mismatch');if(hash(fs.readFileSync(path.join(root,'v2/data/knowledge-next',set.candidate,'index.json')))!==set.candidateSHA256)throw Error('Candidate fixture checksum mismatch');
 const beforeApp=createApp({dataset,knowledge:old}),afterApp=httpBase?require('../adapters/http/trial-client.cjs').createTrialClient(httpBase):createApp({dataset,knowledge:candidate}),beforeSources=sourceMap(old,root),afterSources=sourceMap(candidate,root),rows=[],raw=[];
 if(httpBase){const health=await(await fetch(new URL('/api/health',httpBase))).json();if(health.knowledgeVersion!==candidate.version||health.trial?.knowledgeSHA256!==set.candidateSHA256)throw Error('Trial instance is not using the frozen candidate');}
 for(const [group,samples]of [['products',set.products],['aftersales',set.cases],['ordering',set.ordering]])for(const sample of samples){
  const evaluate=(app,k,sources)=>group==='products'?product(sample,app,k,sources):group==='aftersales'?aftersales(sample,app,k,afterSources):ordering(sample,app,k,dataset);
  const before=await evaluate(beforeApp,old,beforeSources),after=await evaluate(afterApp,candidate,afterSources);
  const checks=new Map(before.audit.checks.map(c=>[c.id,c.status]));const improved=after.audit.checks.filter(c=>c.status==='passed'&&checks.get(c.id)!=='passed').map(c=>c.id),regressed=after.audit.checks.filter(c=>c.status==='failed'&&checks.get(c.id)!=='failed').map(c=>c.id);
  const unchangedOutput=JSON.stringify(before.projection)===JSON.stringify(after.projection);
  rows.push({id:sample.id,group,before:before.audit,after:after.audit,improved,regressed,unchangedOutput,replyChanged:before.reply!==after.reply,referenceAssessment:after.referenceAssessment,originalClaimCounts:group==='products'?{before:before.originalClaimCount,after:after.originalClaimCount}:undefined,sourceRecordInTop3:group==='aftersales'?{before:before.sourceRecordInTop3,after:after.sourceRecordInTop3}:undefined});raw.push({id:sample.id,group,before,after});
 }
 if(!fs.readFileSync(path.join(root,'v2/data/knowledge/active-manifest.json')).equals(activeBytes))throw Error('Active changed');
 const summarize=side=>Object.fromEntries(['products','aftersales','ordering'].map(group=>{const entries=rows.filter(r=>r.group===group);return [group,{samples:entries.length,failedSamples:entries.filter(r=>!r[side].automaticPassed).length,pendingSamples:entries.filter(r=>r[side].counts.pending_manual>0).length,checks:{passed:entries.reduce((n,r)=>n+r[side].counts.passed,0),failed:entries.reduce((n,r)=>n+r[side].counts.failed,0),pending:entries.reduce((n,r)=>n+r[side].counts.pending_manual,0)}}];}));
 const receipt={date:new Date().toISOString(),commit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),execution:httpBase?{mode:'real-http',base:httpBase}:{mode:'in-process'},setReference:{file:setFile,sha256:hash(setBytes)},engineeringSetReference:{file:engineeringFile,sha256:hash(engineeringBytes)},baseline:old.version,candidate:candidate.version,before:summarize('before'),after:summarize('after'),improvedSamples:rows.filter(r=>r.improved.length).map(r=>r.id),regressedSamples:rows.filter(r=>r.regressed.length).map(r=>r.id),invalidFixtureExpectations:rows.filter(r=>r.referenceAssessment?.fixtureExpectationValid===false).map(r=>r.id),unchangedOutput:rows.filter(r=>r.unchangedOutput).length,changedReplies:rows.filter(r=>r.replyChanged).map(r=>r.id),rows,activeUnchanged:true,scope:'Fixed evidence-backed replay and engineering scenarios; no random sample, no customer solution success rate, no activation'};
 fs.writeFileSync(path.join(dir,'raw-before-after.json'),JSON.stringify(raw,null,2)+'\n',{flag:'wx'});fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({before:receipt.before,after:receipt.after,improved:receipt.improvedSamples,regressed:receipt.regressedSamples,unchangedOutput:receipt.unchangedOutput,changedReplies:receipt.changedReplies},null,2));return receipt;
}
if(require.main===module)run(process.argv[2],{httpBase:process.argv[3]}).then(receipt=>{if(receipt.rows.some(row=>!row.after.automaticPassed))process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
