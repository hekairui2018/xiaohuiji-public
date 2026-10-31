'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {toolQuery}=require('../domain/parser/query-language.cjs');
test('tool queries project declared fields and actions while preserving technical identities and literal file names',()=>{
 const original={query:'HD-R123 maximum height and width resolution',models:['HD-R123'],chips:['LS1234DS'],concepts:['height','width','resolution']},projected=toolQuery(original);
 assert.match(projected.query,/HD-R123/);assert.match(projected.query,/高度/);assert.match(projected.query,/宽度/);assert.match(projected.query,/分辨率/);assert.deepEqual(projected.models,original.models);assert.deepEqual(projected.chips,original.chips);assert.equal(original.query,'HD-R123 maximum height and width resolution');
 assert.match(toolQuery({query:'how to export HDSet parameters'}).query,/导出/);
 const name='HD-R123 Specification V3.1.pdf';assert.equal(toolQuery({kind:'files',query:name}).query,name);
});
test('document-selection schemas stay request-local during parallel expert turns',async()=>{
 const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'bonsai',owned_by:'ninfer'}]})};
  const payload=JSON.parse(options.body),input=JSON.parse(payload.messages[1].content),choice=payload.response_format.json_schema.schema.anyOf.find(x=>x.properties.action.const==='search');
  assert.deepEqual(choice.properties.documents.items.enum,[input.message+'.pdf']);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'answer',claims:[{text:'已核对该文件',evidenceIds:['s1']}],generalAdvice:[],question:''})}}]})};
 }});
 const results=await Promise.all(['A100','B200'].map(message=>expert.answer({message,sessionState:{id:message},execute:async()=>({evidence:[]}),preparedEvidence:[{evidenceId:message,name:message+'.pdf',text:'registered',download:'/file',readPerformed:true}]})));
 assert(results.every(x=>x.status==='answer'));
});
test('empty optional document filters mean no restriction and model schemas never invent source versions',async()=>{
 const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');let round=0,tools=0;
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'bonsai',owned_by:'ninfer'}]})};
  const request=JSON.parse(options.body),schema=request.response_format.json_schema.schema.anyOf.find(x=>x.properties.action.const==='search');
  round++;if(round===1){assert.equal(schema.properties.version,undefined);assert.equal(schema.properties.documents,undefined);}
  if(round===2){assert.equal(schema.properties.documents.minItems,1);assert.deepEqual(schema.properties.documents.items.enum,['manual.pdf']);assert(schema.properties.version.enum.includes('V4.0.8.0'));assert(!schema.properties.version.enum.includes('V3.5.0.0'));assert(!schema.properties.version.enum.includes('V3.5.1'));assert(!schema.properties.version.enum.includes('192.0.2.99'));}
  const action=round<3?{action:'search',kind:'text',query:'X100教程',concepts:['教程'],goals:['查操作'],documents:[]}:{action:'answer',claims:[{text:'依据已取得资料。',evidenceIds:['s1']}],generalAdvice:[],question:''};
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(action)}}]})};
 }});
 const result=await expert.answer({message:'X100教程',execute:async(_name,args)=>{assert.equal(args.documents,undefined);tools++;return {evidence:[{evidenceId:'manual',name:'manual.pdf',text:'文档版本V3.5.1，操作软件版本V4.0.8.0，IP地址192.0.2.99。',readPerformed:true}]};}});
 assert.equal(result.status,'answer');assert.equal(tools,1);assert.equal(round,3);
});
