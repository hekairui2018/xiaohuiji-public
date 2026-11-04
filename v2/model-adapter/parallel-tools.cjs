'use strict';
// Bounded read-only batches. Calculations and dependent steps keep their original path.
function prepare(tasks,remaining,evidence){
 if(!Array.isArray(tasks)||tasks.length<2||tasks.length>3||tasks.length>remaining)throw Error('expert-invalid-parallel');
 const seen=new Set();
 for(const task of tasks){
  if(!task||!['search','quick','read'].includes(task.action))throw Error('expert-invalid-parallel');
  if(task.action==='read'){
   if(!Number.isInteger(task.blockId)||task.blockId<1||![...evidence].some(e=>e.blockId===task.blockId&&e.readAvailable))throw Error('expert-invalid-parallel');
  }else{
   if(typeof task.query!=='string'||!task.query.trim()||task.query.length>240)throw Error('expert-invalid-parallel');
   if(task.action==='search'&&!['products','resources','cases','faq','tender','firmware','text','files'].includes(task.kind))throw Error('expert-invalid-parallel');
   if(task.documents&&(!Array.isArray(task.documents)||task.documents.some(n=>![...evidence].some(e=>e.name===n))))throw Error('expert-invalid-parallel');
  }
  const normalized={...task};if(normalized.query)normalized.query=normalized.query.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const key=JSON.stringify(Object.keys(normalized).sort().map(k=>[k,normalized[k]]));if(seen.has(key))throw Error('expert-invalid-parallel');seen.add(key);
 }
 return tasks.map(t=>structuredClone(t));
}
async function execute(tasks,run,{signal,onResult=()=>{}}={}){
 const results=await Promise.allSettled(tasks.map(async(task,index)=>{signal?.throwIfAborted();const result=await run(task,index);signal?.throwIfAborted();onResult(task,result,index);return result;}));
 signal?.throwIfAborted();
 return results.map((r,i)=>r.status==='fulfilled'?{action:tasks[i],result:r.value}:{action:tasks[i],error:r.reason?.message||'tool-failed'});
}
module.exports={prepare,execute};
