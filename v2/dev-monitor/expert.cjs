'use strict';
// Observation is confined to the development composition boundary. No inference rules change.
function createMonitoredExpert({capture,createExpert=require('../model-adapter/evidence-expert.cjs').createEvidenceExpert,...options}){
 if(!capture?.enabled)return createExpert(options);
 const transport=options.transport||require('../model-adapter/local-model-transport.cjs').localModelTransport;
 const expert=createExpert({...options,transport:capture.wrapTransport(transport),onDiagnostic(entry){capture.event('expert.diagnostic',entry);options.onDiagnostic?.(entry);}});
 return {status:expert.status,answer:input=>capture.run(input,()=>expert.answer({...input,execute:typeof input.execute==='function'?async(name,args)=>{
  const started=Date.now();capture.event('tool.start',{name,arguments:args});try{const result=await input.execute(name,args);capture.event('tool.result',{name,arguments:args,elapsedMs:Date.now()-started,result});return result;}catch(error){capture.event('tool.error',{name,arguments:args,elapsedMs:Date.now()-started,message:error.message});throw error;}
 }:input.execute}))};
}
module.exports={createMonitoredExpert};
