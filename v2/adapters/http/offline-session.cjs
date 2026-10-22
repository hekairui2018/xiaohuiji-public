'use strict';
const fs=require('node:fs'),path=require('node:path');
const {validateFacts}=require('../../domain/aftersales/case-search.cjs');
function createOfflineSessions(directory,{now=Date.now,idleMs=300000}={}){
 const active=new Set();
 function sweep(){for(const [id,s] of memory)if(!active.has(id)&&now()-Date.parse(s.updatedAt||0)>idleMs){s.retrievalHistory=[];if(directory)memory.delete(id);}}
 const timer=setInterval(sweep,30000);timer.unref?.();
 const memory=new Map();if(directory)fs.mkdirSync(directory,{recursive:true});
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{4,70}$/.test(id);
 function save(s,event){if(directory){const file=path.join(directory,s.id+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(s));fs.renameSync(file+'.tmp',file);fs.appendFileSync(path.join(directory,s.id+'.history.jsonl'),JSON.stringify(event)+'\n');}if(directory&&s.closedAt)memory.delete(s.id);else memory.set(s.id,s);if(memory.size>1000){const oldest=[...memory.keys()].find(id=>!active.has(id));if(oldest)memory.delete(oldest);}return structuredClone(s);}
 function get(id){sweep();if(!valid(id))throw Error('invalid-session');if(memory.has(id))return structuredClone(memory.get(id));
  const file=directory&&path.join(directory,id+'.json');if(file&&fs.existsSync(file)){const s=JSON.parse(fs.readFileSync(file,'utf8'));if(!s.closedAt)memory.set(id,s);return structuredClone(s);}return {id,messages:[],facts:{},checks:[]};}
 function update(id,input){const s=get(id);if(!active.has(id)&&s.updatedAt&&now()-Date.parse(s.updatedAt)>idleMs){const archive=directory&&path.join(directory,id+'.history.jsonl');s.contextStartIndex=archive&&fs.existsSync(archive)?Math.max(0,fs.readFileSync(archive,'utf8').split('\n').filter(line=>{if(!line.trim())return false;return ['customer-input','assistant-answer'].includes(JSON.parse(line).type);}).length-12):0;s.messages=s.messages.slice(-12);while(s.messages[0]?.role==='assistant')s.messages.shift();s.retrievalHistory=[];}const incoming=validateFacts(input.facts||{});for(const [key,values]of Object.entries(incoming))if(values.length)s.facts[key]=values;
  if(s.closedAt)throw Error('session-closed');
  if(input.conversationType!==undefined&&!['normal','guest'].includes(input.conversationType))throw Error('invalid-conversation-type');
  s.conversationType=input.conversationType||s.conversationType||'normal';
  if(input.clearFacts!==undefined){if(!Array.isArray(input.clearFacts)||input.clearFacts.some(k=>typeof k!=='string'||!Object.hasOwn(validateFacts({[k]:[]}),k)))throw Error('invalid-clear-facts');for(const key of input.clearFacts)delete s.facts[key];}
  if(input.originalMessage!==undefined&&(typeof input.originalMessage!=='string'||input.originalMessage.length>8000))throw Error('invalid-original-message');
  if(input.checks!==undefined){if(!Array.isArray(input.checks)||input.checks.length>20||input.checks.some(c=>!c||typeof c.action!=='string'||typeof c.result!=='string'||c.action.length>240||c.result.length>240))throw Error('invalid-checks');s.checks=[...new Map([...(s.checks||[]),...input.checks.map(c=>({...c,source:'customer_supplied'}))].map(c=>[c.action+'\u0000'+c.result,c])).values()].slice(-50);}
  s.messages.push({role:'user',content:input.originalMessage||input.message,query:input.message,at:new Date(now()).toISOString()});s.messages=s.messages.slice(-30);s.updatedAt=new Date(now()).toISOString();
  return save(s,{type:'customer-input',...input,at:s.updatedAt});}
 function recordResult(id,result){const s=get(id);if(result.quickContext?.taskState)s.taskState=structuredClone(result.quickContext.taskState);s.updatedAt=new Date(now()).toISOString();s.retrievalHistory=[...(s.retrievalHistory||[]),result].slice(-30);return save(s,{type:'retrieval',...result,at:new Date(now()).toISOString()});}
 function recordAnswer(id,result){const s=get(id);s.updatedAt=new Date(now()).toISOString();s.messages.push({role:'assistant',content:result.reply||'',model:result.model||'',status:result.status||'',at:new Date(now()).toISOString()});s.messages=s.messages.slice(-30);return save(s,{type:'assistant-answer',result,at:new Date(now()).toISOString()});}
 function closeGuest(id){const s=get(id);if(s.conversationType!=='guest')throw Error('not-guest-session');s.closedAt=new Date(now()).toISOString();save(s,{type:'guest-context-released',at:s.closedAt});if(directory)memory.delete(id);return {ok:true,contextReleased:true};}
 function expertState(id){
  const s=get(id);if(s.closedAt)throw Error('session-closed');
  const file=directory&&path.join(directory,id+'.history.jsonl');
  if(file&&fs.existsSync(file)){
   const messages=[];
   for(const line of fs.readFileSync(file,'utf8').split('\n')){if(!line.trim())continue;const e=JSON.parse(line);
    if(e.type==='customer-input')messages.push({role:'user',content:e.originalMessage||e.message,at:e.at});
    if(e.type==='assistant-answer')messages.push({role:'assistant',content:e.result?.reply||'',at:e.at});
   }
   if(messages.length){s.messages=messages.slice(s.contextStartIndex||0);if(s.contextStartIndex!==undefined)while(s.messages[0]?.role==='assistant')s.messages.shift();}
  }
  return s;
 }
 return {get,update,recordResult,recordAnswer,closeGuest,expertState,sweep,begin:id=>active.add(id),end:id=>active.delete(id),dispose:()=>clearInterval(timer)};
}
module.exports={createOfflineSessions};
