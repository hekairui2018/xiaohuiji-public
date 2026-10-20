'use strict';
// Read the actual V2 action schema without modifying/exporting production code.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),file=path.join(root,'v2/model-adapter/evidence-expert.cjs');
const context={module:{exports:{}},require};vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.schema=schema;',context,{filename:file});
function check(value,schema){
 if(schema.const!==undefined)return value===schema.const;
 if(schema.enum)return schema.enum.includes(value);
 if(schema.oneOf)return schema.oneOf.some(s=>check(value,s));
 if(schema.type==='string')return typeof value==='string'&&(!schema.minLength||value.length>=schema.minLength)&&(!schema.maxLength||value.length<=schema.maxLength)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
 if(schema.type==='integer')return Number.isInteger(value)&&(!schema.minimum||value>=schema.minimum);
 if(schema.type==='array')return Array.isArray(value)&&(!schema.minItems||value.length>=schema.minItems)&&(!schema.maxItems||value.length<=schema.maxItems)&&value.every(v=>check(v,schema.items));
 if(schema.type==='object')return value&&typeof value==='object'&&!Array.isArray(value)&&(schema.required||[]).every(k=>Object.hasOwn(value,k))&&Object.entries(value).every(([k,v])=>schema.properties?.[k]?check(v,schema.properties[k]):schema.additionalProperties!==false);
 return true;
}
const rows=fs.readFileSync(path.join(root,'tmp/retrieval-lora-20261020/data/candidates.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
for(const row of rows)assert.ok(check(row.target,context.module.exports.schema),'V2 schema mismatch: '+row.id);
const predictions=path.join(root,'tmp/retrieval-lora-20261020/results/lora.raw.json');let modelOutputs=0;
if(fs.existsSync(predictions))for(const row of JSON.parse(fs.readFileSync(predictions,'utf8'))){assert.ok(check(JSON.parse(row.raw_output),context.module.exports.schema),'Model output incompatible: '+row.id);modelOutputs++;}
console.log(JSON.stringify({passed:true,candidates:rows.length,modelOutputs,schema:file,productionMutations:0}));
