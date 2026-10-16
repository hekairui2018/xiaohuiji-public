'use strict';
const fs=require('node:fs'),path=require('node:path');
const {validateFacts}=require('../../domain/aftersales/case-search.cjs');
function createOfflineSessions(directory){
 const memory=new Map();if(directory)fs.mkdirSync(directory,{recursive:true});
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{4,70}$/.test(id);
 function save(s,event){if(directory){const file=path.join(directory,s.id+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(s));fs.renameSync(file+'.tmp',file);fs.appendFileSync(path.join(directory,s.id+'.history.jsonl'),JSON.stringify(event)+'\n');}memory.set(s.id,s);if(memory.size>1000)memory.delete(memory.keys().next().value);return structuredClone(s);}
 function get(id){if(!valid(id))throw Error('invalid-session');if(memory.has(id))return structuredClone(memory.get(id));
  const file=directory&&path.join(directory,id+'.json');if(file&&fs.existsSync(file)){const s=JSON.parse(fs.readFileSync(file,'utf8'));memory.set(id,s);return structuredClone(s);}return {id,messages:[],facts:{},checks:[]};}
 function update(id,input){const s=get(id);s.facts={...s.facts,...validateFacts(input.facts||{})};
  if(input.originalMessage!==undefined&&(typeof input.originalMessage!=='string'||input.originalMessage.length>8000))throw Error('invalid-original-message');
  if(input.checks!==undefined){if(!Array.isArray(input.checks)||input.checks.length>20||input.checks.some(c=>!c||typeof c.action!=='string'||typeof c.result!=='string'||c.action.length>240||c.result.length>240))throw Error('invalid-checks');s.checks=[...new Map([...(s.checks||[]),...input.checks.map(c=>({...c,source:'customer_supplied'}))].map(c=>[c.action+'\u0000'+c.result,c])).values()].slice(-50);}
  s.messages.push({role:'user',content:input.originalMessage||input.message,query:input.message,at:new Date().toISOString()});s.messages=s.messages.slice(-30);s.updatedAt=new Date().toISOString();
  return save(s,{type:'customer-input',...input,at:s.updatedAt});}
 function recordResult(id,result){const s=get(id);s.retrievalHistory=[...(s.retrievalHistory||[]),result].slice(-30);return save(s,{type:'retrieval',...result,at:new Date().toISOString()});}
 return {get,update,recordResult};
}
module.exports={createOfflineSessions};
