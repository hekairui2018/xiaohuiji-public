'use strict';
// Deliberately supports only the keywords used by this project's contracts.
// Reject an unsupported schema keyword instead of silently skipping validation.
const keywords=new Set(['$schema','type','required','additionalProperties','properties','items','enum','minimum','exclusiveMinimum','minLength','maxLength']);
const unsafe=new Set(['__proto__','constructor','prototype']);
function validate(schema,value,path=''){
 const errors=[];
 function walk(s,v,p){
  for(const key of Object.keys(s))if(!keywords.has(key))throw Error('Unsupported schema keyword: '+key);
  const types=Array.isArray(s.type)?s.type:[s.type].filter(Boolean);
  const actual=v===null?'null':Array.isArray(v)?'array':typeof v;
  const fits=t=>t==='integer'?Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):t==='object'?actual==='object':actual===t;
  if(types.length&&!types.some(fits)){errors.push({path:p,code:'invalid_type'});return;}
  if(s.enum&&!s.enum.some(x=>JSON.stringify(x)===JSON.stringify(v)))errors.push({path:p,code:'invalid_enum'});
  if(typeof v==='number'){
   if(!Number.isFinite(v))errors.push({path:p,code:'non_finite'});
   if(s.minimum!==undefined&&v<s.minimum)errors.push({path:p,code:'below_minimum'});
   if(s.exclusiveMinimum!==undefined&&v<=s.exclusiveMinimum)errors.push({path:p,code:'below_exclusive_minimum'});
  }
  if(typeof v==='string'){
   if(s.minLength!==undefined&&v.length<s.minLength)errors.push({path:p,code:'too_short'});
   if(s.maxLength!==undefined&&v.length>s.maxLength)errors.push({path:p,code:'too_long'});
  }
  if(v&&actual==='object'){
   for(const key of s.required||[])if(!Object.hasOwn(v,key))errors.push({path:p+'/'+key,code:'required'});
   for(const [key,item] of Object.entries(v)){
    if(unsafe.has(key)){errors.push({path:p+'/'+key,code:'unsafe_key'});continue;}
    if(s.properties?.[key])walk(s.properties[key],item,p+'/'+key);
    else if(s.additionalProperties===false)errors.push({path:p+'/'+key,code:'unknown_field'});
   }
  }
  if(Array.isArray(v)&&s.items)v.forEach((item,i)=>walk(s.items,item,p+'/'+i));
 }
 walk(schema,value,path);return {valid:errors.length===0,errors};
}
module.exports={validate};
