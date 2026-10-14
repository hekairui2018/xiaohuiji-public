'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('../app/bootstrap.cjs');
async function evaluate(output){
 const root=path.resolve(__dirname,'../..'),frozen=JSON.parse(fs.readFileSync(path.join(root,'tmp/phase3-evidence-20261013/frozen-inputs.json')));
 const holdout=JSON.parse(fs.readFileSync(path.join(root,'tmp/phase3-evidence-20261013/holdout-before.json')));
 const app=createApp(),samples=[...frozen.samples,...holdout.map(s=>({...s,set:'holdout'}))],results=[];
 for(const sample of samples){const result=await app.dialogue({schemaVersion:'2.0',operation:'aftersales',symptoms:[sample.query]});
  results.push({...sample,output:undefined,result,firstSameSource:result.diagnosis.candidates[0]?.legacyId===sample.id,top3SameSource:result.diagnosis.candidates.some(c=>c.legacyId===sample.id),actualEngineeringOutcome:'unknown'});}
 const summary={};for(const set of ['fixed','random','holdout']){const rows=results.filter(r=>r.set===set);summary[set]={samples:rows.length,firstSameSource:rows.filter(r=>r.firstSameSource).length,top3SameSource:rows.filter(r=>r.top3SameSource).length,executableWorkflow:rows.filter(r=>r.result.diagnosis.checks?.length).length,unobservedSolved:rows.filter(r=>r.result.status==='ready').length,engineeringOutcomeUnknown:rows.length};}
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
 const report={createdAt:new Date().toISOString(),sampleSources:['tmp/phase3-evidence-20261013/frozen-inputs.json','tmp/phase3-evidence-20261013/holdout-before.json'].map(file=>({file,sha256:hash(file)})),method:'Original frozen queries; same-source recall is not accuracy; no LLM or hardware-success judgment',summary,results};
 const target=path.resolve(root,output);if(!target.startsWith(path.join(root,'tmp')+path.sep)||fs.existsSync(target))throw Error('Use new workspace tmp receipt');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify(summary,null,2));
}
if(require.main===module)evaluate(process.argv[2]||'tmp/v2-stage4/diagnostic-evaluation.json').catch(e=>{console.error(e);process.exitCode=1;});
module.exports={evaluate};
