'use strict';
const UNKNOWN=Symbol('unknown');
function atPath(facts,path){
 if(typeof path!=='string'||!path.startsWith('/'))throw Error('Rule path must be a JSON pointer');
 let value=facts;for(const part of path.slice(1).split('/').map(p=>p.replace(/~1/g,'/').replace(/~0/g,'~'))){
  if(['__proto__','constructor','prototype'].includes(part))throw Error('Unsafe rule path');
  if(!value||typeof value!=='object'||!Object.hasOwn(value,part))return UNKNOWN;value=value[part];
 }return value===null||value===undefined?UNKNOWN:value;
}
function condition(expression,facts,depth=0){
 if(depth>32)throw Error('Rule nesting limit');
 if(!expression||typeof expression!=='object'||Array.isArray(expression))throw Error('Invalid rule expression');
 if(Object.hasOwn(expression,'path'))return atPath(facts,expression.path);
 if(Object.hasOwn(expression,'literal'))return expression.literal;
 const {op,args}=expression;if(!Array.isArray(args))throw Error('Rule arguments required');
 const values=args.map(a=>condition(a,facts,depth+1));
 if(['all','any','not'].includes(op)){
  if(values.some(v=>v!==UNKNOWN&&typeof v!=='boolean'))throw Error('Boolean operands required');
  if(op==='not'){if(values.length!==1)throw Error('not requires one operand');return values[0]===UNKNOWN?UNKNOWN:!values[0];}
  if(!values.length)throw Error('Boolean operands cannot be empty');
  if(op==='all'&&values.includes(false))return false;if(op==='any'&&values.includes(true))return true;
  if(values.includes(UNKNOWN))return UNKNOWN;return op==='all';
 }
 if(['eq','lte','gte','contains'].includes(op)){
  if(values.length!==2)throw Error('Comparison requires two operands');
  if(values.includes(UNKNOWN))return UNKNOWN;
  if(op==='eq')return typeof values[0]===typeof values[1]&&JSON.stringify(values[0])===JSON.stringify(values[1]);
  if(op==='contains'){if(!Array.isArray(values[0]))throw Error('contains requires an array');return values[0].some(v=>v===values[1]);}
  if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Numeric operands required');
  return op==='lte'?values[0]<=values[1]:values[0]>=values[1];
 }
 throw Error('Unsupported rule operator: '+op);
}
function evaluateRules(rules,facts){
 const ids=new Set();return [...rules].map(rule=>{
  if(typeof rule.ruleId!=='string'||ids.has(rule.ruleId)||!Number.isFinite(rule.priority)||!Array.isArray(rule.sourceReferences)||!rule.sourceReferences.length)throw Error('Invalid/unsourced rule');
  ids.add(rule.ruleId);const result=condition(rule.when,facts);
  if(result!==UNKNOWN&&typeof result!=='boolean')throw Error('Rule condition must return a boolean');
  return {ruleId:rule.ruleId,priority:rule.priority,state:result===UNKNOWN?'unknown':result?'matched':'rejected',effect:result===true?rule.effect:null,sourceReferences:rule.sourceReferences};
 }).sort((a,b)=>b.priority-a.priority||a.ruleId.localeCompare(b.ruleId));
}
module.exports={evaluateRules};
