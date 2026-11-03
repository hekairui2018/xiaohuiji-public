'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWikiDocumentMetadata}=require('../domain/knowledge/wiki-document-metadata.cjs');
const {createSectionAnswers}=require('../adapters/http/section-answers.cjs');
const {sharedQuickEvidence}=require('../adapters/http/shared-quick-evidence.cjs');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const {createSectionTools}=require('../adapters/http/section-tools.cjs');
const branded='a'.repeat(64),neutral='b'.repeat(64),name='X123规格书 V1.1.pdf';
const annotate=createWikiDocumentMetadata({items:[{name,sha256:branded,brand:'品牌版',language:'中文',version:'V1.1'},{name,sha256:neutral,brand:'中性版',language:'中文',version:'V1.1'}]});
test('Wiki editions follow approved file identity; identical names do not transfer metadata',()=>{
 assert.equal(annotate({name,sha256:branded}).documentEdition,'standard');assert.equal(annotate({name,sha256:neutral}).documentEdition,'neutral');assert.equal(annotate({name,sha256:'c'.repeat(64)}).documentEdition,undefined);
});
test('file tool retains both Wiki editions and their independent original links',async()=>{
 const rows=[branded,neutral].map((sha256,i)=>({name,sha256,kind:'spec',resourceOnly:true,models:['HD-X123'],download:'/file/'+i,previewUrl:'/preview/'+i}));
 const service=createSectionAnswers({registry:async()=>({results:rows})},{documentMetadata:annotate});
 const result=await service.answer('X123规格书');assert.equal(result.results.length,2);assert(!result.fileGroups[0].groupNotice.includes('不同内容'));
 const evidence=sharedQuickEvidence(result);assert.deepEqual(evidence.map(e=>e.brand),['品牌版','中性版']);assert.deepEqual(evidence.map(e=>e.previewUrl),['/preview/0','/preview/1']);assert(evidence.every(e=>e.documentLanguage==='中文'&&e.documentVersion==='V1.1'));
});
test('repeated file requests require a model-selected tool and directly preserve complete file cards',async()=>{
 let modelCalls=0,toolCalls=0;
 const file=annotate({name,sha256:neutral,kind:'spec',resourceOnly:true,download:'/manual',previewUrl:'/preview'});
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:16384}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic',owned_by:'ninfer'}]})};
  modelCalls++;const body=JSON.parse(options.body),choices=body.response_format.json_schema.schema.anyOf;
  assert(!choices.some(c=>c.properties.action.const==='answer'),'history-only answer must not replace file delivery');
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({action:'quick',query:'X123规格书'})},finish_reason:'stop'}]})};
 }});
 for(let i=0;i<2;i++){
  const result=await expert.answer({message:'X123规格书',sessionState:{id:'synthetic-repeat-'+i,messages:i?[{role:'assistant',content:'上次已找到X123规格书。'}]:[]},execute:async(name,args)=>{toolCalls++;assert.equal(name,'quick_answer');return {directAnswer:{status:'answer',answerBasis:'file-registry-columns',reply:'文件在这里。',queryPlan:{models:['HD-X123']},results:[{...file,models:['HD-X123']}]},evidence:sharedQuickEvidence({results:[file]})};}});
  assert.equal(result.status,'answer',JSON.stringify({error:result.error,calls:result.modelCallCount,trace:result.toolTrace}));assert.equal(result.modelCallCount,1);assert.equal(result.results[0].brand,'中性版');assert.equal(result.results[0].previewUrl,'/preview');assert.equal(result.delegatedTo,'model-selected-tool');
 }
 assert.equal(modelCalls,2);assert.equal(toolCalls,2);
});
test('the files search kind reuses the same complete registry result instead of body snippets',async()=>{
 const rows=[branded,neutral].map((sha256,i)=>({name,sha256,kind:'spec',resourceOnly:true,models:['HD-X123'],download:'/file/'+i}));
 const answers=createSectionAnswers({registry:async()=>({results:rows})},{documentMetadata:annotate});
 const tools=createSectionTools({resourceAnswer:answers.answer,resourceSearch:async()=>{throw Error('must not search body snippets for a file delivery');}});
 const result=await tools.execute('search_evidence',{kind:'files',query:'规格书',models:['HD-X123']});
 assert.equal(result.directAnswer.results.length,2);assert.deepEqual(result.evidence.map(e=>e.brand),['品牌版','中性版']);
});
