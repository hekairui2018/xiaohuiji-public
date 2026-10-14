'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {createApp}=require('../app/bootstrap.cjs');
const {loadDataset}=require('../adapters/data/load-dataset.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createAcceptance}=require('../acceptance/index.cjs');
const {auditKnowledge}=require('../acceptance/knowledge.cjs');
const {auditSsm}=require('../acceptance/ssm.cjs');
const {exportSsm}=require('../domain/ordering/output/ssm-export.cjs');
const {loadSsmShell}=require('../adapters/data/load-ssm-shell.cjs');
function requirement(m,columns,rows){return {schemaVersion:'2.0',operation:'ordering',controlMode:'sync',architecture:'receiver',environment:m.indoor?'indoor':'outdoor',module:{pitchMm:m.dotPitch.spacing,pixelWidth:m.resolution[0],pixelHeight:m.resolution[1],scan:{numerator:1,denominator:Number(m.scanningMethod.replace('S',''))},interface:m.interface,color:{r:m.color.R||0,g:m.color.G||0,b:m.color.B||0}},screen:{moduleColumns:columns,moduleRows:rows}};}
async function run(output,{knowledgeDirectory,manifestFile='active-manifest.json'}={}){
 const root=path.resolve(__dirname,'../..'),target=path.resolve(root,output||'tmp/acceptance-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 if(!target.startsWith(path.join(root,'tmp')+path.sep)||fs.existsSync(target))throw Error('Use a new workspace tmp report');
 const dataset=loadDataset(),knowledge=loadKnowledge(knowledgeDirectory,{manifestFile}),app=createApp({dataset,knowledge}),audits=createAcceptance({dataset,knowledge}),shell=loadSsmShell();
 const rows=[],notImplemented=[];let seed=20261013;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 rows.push({id:'full-knowledge',audit:auditKnowledge(knowledge,root,{directory:knowledgeDirectory,manifestFile})});
 for(const m of dataset.modules().filter(m=>m.color.R===1&&m.color.G===1&&m.color.B===1&&m.interface==='HUB75')){
  for(const set of ['fixed','random']){const demand=requirement(m,set==='fixed'?10:1+random()%21,set==='fixed'?10:1+random()%23),result=await app.dialogue(demand),id=set+'-module-'+m.id;
   if(result.status!=='ready'){notImplemented.push({id,status:result.status,reason:result.reason||result.missing_parameters});continue;}
   rows.push({id,audit:audits.ordering(result)});const exported=exportSsm(result,shell);rows.push({id:id+'-ssm',audit:auditSsm(exported,result,shell)});
  }
 }
 for(const c of knowledge.cases()){
  if(c.recordType!=='case')continue;const demand={schemaVersion:'2.0',operation:'aftersales',symptoms:[c.phenomenon.split('\n')[0]],providedDevices:c.modelIds.map(modelId=>({modelId}))};
  const result=await app.dialogue(demand);rows.push({id:'replay-'+c.legacyId,audit:audits.aftersales(result,demand)});
 }
 const summary={reports:rows.length,automaticFailures:rows.filter(r=>!r.audit.automaticPassed).length,pendingManualReports:rows.filter(r=>r.audit.status==='pending_manual').length,notImplementedSamples:notImplemented.length};
 const validatorSources=fs.readdirSync(path.join(root,'v2/acceptance')).filter(f=>f.endsWith('.cjs')).map(f=>({file:'v2/acceptance/'+f,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'v2/acceptance',f))).digest('hex')}));
 const receipt={date:new Date().toISOString(),sourceCommit:cp.spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),worktreeDirty:Boolean(cp.spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).stdout.trim()),validatorSources,seed:20261013,datasetVersion:dataset.version,knowledgeVersion:knowledge.version,summary,notImplemented,rows,scope:'Offline invariants and provenance; pending_manual is not a pass, not a blocker for development'};
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(summary,null,2));if(summary.automaticFailures){console.log(rows.filter(r=>!r.audit.automaticPassed).slice(0,8).map(r=>({id:r.id,failed:r.audit.checks.filter(c=>c.status==='failed')})));process.exitCode=1;}return receipt;
}
if(require.main===module)run(process.argv[2],process.argv[3]==='--candidate'?{knowledgeDirectory:path.resolve(__dirname,'../data/knowledge-next'),manifestFile:'candidate-manifest.json'}:{}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,requirement};
