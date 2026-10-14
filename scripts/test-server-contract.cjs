'use strict';
// Exercise the actual HTTP handler without listening, network access, or production writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const assert=require('node:assert/strict');
process.env.LLM_API_KEY='';
const root=path.resolve(__dirname,'..'),file=path.join(root,'backend/server.js');
const baseline=path.join(root,'tmp/phase3-evidence-20261013/server-contract-before.json');
const code=fs.readFileSync(file,'utf8');
const moduleObject={exports:{}};
const context={require:createRequire(file),module:moduleObject,exports:moduleObject.exports,
  __dirname:path.dirname(file),__filename:file,process,console,Buffer,URL,setTimeout,clearTimeout,setInterval,clearInterval};
vm.runInNewContext(code+'\nmodule.exports.__chat=handleAiChat; saveOrderingSsm=()=>"contract-fixture.ssm";',context,{filename:file});
const fixtures=[
  {body:'{',status:400}, {body:'{}',status:400},
  ...['A3','A3L','VP620','VP620A','R712','R5s Plus','6363','你好','诺瓦接收卡价格',
    'HDSet下载','P3 模组分辨率64x64点 10宽8高 同步','C16L 花屏一直闪',
    '[RX_OK] C16L 花屏','[SIDE_SYNC] VP620A 花屏','有没有支持4K的处理器']
    .flatMap(message=>['quick-site','wecom'].map(source=>({payload:{message,source,history:[]},status:200})))
];
function stableResponse(row){
 const copy=JSON.parse(JSON.stringify(row));
 if(copy.response.body.wecomCard){
  // Per-request task IDs contain time/randomness; validate their contract separately.
  assert.match(copy.response.body.wecomCard.task_id,/^xhj_\d+_[a-z0-9]+$/);
  copy.response.body.wecomCard.task_id='<valid-request-task-id>';
 }
 return copy;
}
async function execute(fixture){
 const req=new EventEmitter();let response;
 const res={writeHead(status){this.status=status;},end(body){response={status:this.status,body:JSON.parse(body)};}};
 const run=moduleObject.exports.__chat(req,res);
 req.emit('data',fixture.body||JSON.stringify(fixture.payload));req.emit('end');await run;
 assert.equal(response.status,fixture.status);return JSON.parse(JSON.stringify(response));
}
(async()=>{
 const rows=[];for(const fixture of fixtures)rows.push({fixture,response:await execute(fixture)});
 if(process.argv.includes('--capture')){
  if(fs.existsSync(baseline))throw Error('Do not overwrite baseline');
  fs.writeFileSync(baseline,JSON.stringify(rows,null,2));console.log(`Captured ${rows.length} handler contracts`);return;
 }
 const previous=JSON.parse(fs.readFileSync(baseline,'utf8'));
 const changed=[];for(let i=0;i<rows.length;i++){try{assert.deepEqual(stableResponse(rows[i]),stableResponse(previous[i]));}catch{changed.push({fixture:rows[i].fixture,before:previous[i].response,after:rows[i].response});}}
 const output=process.argv[2];if(output){if(fs.existsSync(output))throw Error('Do not overwrite comparison');fs.writeFileSync(output,JSON.stringify({count:rows.length,changed},null,2));}
 console.log(`Handler contracts: ${rows.length-changed.length}/${rows.length} unchanged`);
 if(changed.length){console.log(changed.map(x=>x.fixture.payload?.message));process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1;});
