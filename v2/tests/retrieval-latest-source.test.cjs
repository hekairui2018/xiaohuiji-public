'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('Version/format selection happens after authorization but before vector search; old chunks cannot re-enter',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-latest-source-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const row=(id,version,ext,access='public')=>({documentId:id,datasetId:'spec',name:'HD-X1规格书 V'+version+'.'+ext,category:'spec',modelIds:['HD-X1'],sha256:'a'.repeat(64),access});
 const documents=[row('old','2.1','pdf'),row('word','2.2','docx'),row('latest','2.2','pdf'),row('private-newer','9.9','pdf','internal')];
 const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify({baseUrl:'http://127.0.0.1:18081',apiKey:'synthetic',datasetIds:['spec'],documents}));
 const source=require('../adapters/http/ragflow-source.cjs').createRagflowSource({configFile:file,authorize:d=>d.access==='public',transport:async(_url,options)=>{
  assert.deepEqual(JSON.parse(options.body).document_ids,['latest']);
  return {ok:true,json:async()=>({code:0,data:{chunks:[{document_id:'old',id:'a',content:'old'},{document_id:'word',id:'b',content:'duplicate'},{document_id:'private-newer',id:'c',content:'private'},{document_id:'latest',id:'d',content:'matching passage one'},{document_id:'latest',id:'e',content:'matching passage two'}]}})};
 }});
 const result=await source.search('X1参数',{models:['HD-X1'],kind:'parameters'});assert.equal(result.results.length,2);assert.ok(result.results.every(r=>r.name==='HD-X1规格书 V2.2.pdf'));
});
