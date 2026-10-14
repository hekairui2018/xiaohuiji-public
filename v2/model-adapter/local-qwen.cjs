'use strict';
// Optional understanding adapter only. Never returns an engineering plan.
const {validate}=require('../contracts/validate.cjs');
const schema={type:'object',required:['intent','model_mentions','missing_parameters'],additionalProperties:false,properties:{intent:{enum:['ordering','aftersales','consultation']},model_mentions:{type:'array',items:{type:'string'}},missing_parameters:{type:'array',items:{type:'string'}},question:{type:'string',maxLength:1000}}};
function createLocalQwen({baseUrl,model='qwen',transport=fetch}={}){
 if(!baseUrl)return Object.freeze({enabled:false,understand:async()=>({status:'disabled'})});
 const url=new URL(baseUrl);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Qwen endpoint must be a credential-free loopback URL');
 return Object.freeze({enabled:true,async understand(text){
  if(typeof text!=='string'||text.length>4096)return {status:'invalid_request'};
  try{const response=await transport(new URL('/v1/chat/completions',url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:'只理解需求。返回JSON：intent(ordering/aftersales/consultation), model_mentions(客户原文型号), missing_parameters, question(可选)。不得推荐设备、数量、网口、拓扑或技术结论。'},{role:'user',content:text}]})});
   if(!response.ok)return {status:'unavailable'};const raw=await response.json();const result=JSON.parse(raw.choices?.[0]?.message?.content||'null');
   if(!validate(schema,result).valid||result.model_mentions.some(m=>!m||!text.toLowerCase().includes(m.toLowerCase())))return {status:'invalid_model_output'};
   return {status:'understood',understanding:result};
  }catch{return {status:'unavailable'};}
 }});
}
module.exports={createLocalQwen};
