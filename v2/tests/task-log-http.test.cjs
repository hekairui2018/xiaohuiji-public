'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServer}=require('node:http'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs'),{createFeishuLogs}=require('../external-services/feishu-logs.cjs');
test('Authenticated task HTTP receipt distinguishes durable acceptance from Feishu sync and rejects conflicting retries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-task-http-')),configFile=path.join(dir,'private.env');fs.writeFileSync(configFile,'HUIDU_UPLOAD_KEY=synthetic\nFEISHU_TASK_PROTOCOL_ONLY=1');let externalCalls=0;
 const logs=createFeishuLogs({directory:path.join(dir,'logs'),configFile,autoStart:false,fetchImpl:async()=>{externalCalls++;throw Error('external traffic forbidden in isolated test');}});
 const offline=createOfflineKnowledge({knowledge:{cases:()=>[],products:()=>[],evidenceDocuments:()=>[]},logs});const server=createServer(async(req,res)=>{if(!await offline.handle(req,res)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const post=async(payload,key='synthetic')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/huidu/log',{method:'POST',headers:{'content-type':'application/json','x-upload-key':key},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};};
 const e={sender_model:'C16L',sender_model_source:'hdset_selected_device_label_model_prefix',recv_models_source:'firmware_directory',receiver_inventory:[{count:1,model_source:'not_collected',firmware_model:'R712',firmware_model_source:'firmware_directory'}],receiver_upgrades:[],task_protocol:1,task_run_id:'synthetic-task-1',machine_id:'synthetic-machine',event_id:'synthetic-event-1',event_sequence:1,event_kind:'exception',origin:'automation',node:'receiver-read',message:'window missing',content:'original synthetic task log',log_date:'2026-10-19'};
 try{
  assert.equal((await post(e,'wrong')).status,403);let result=await post(e);assert.equal(result.status,200);assert.equal(result.body.durable,true);assert.equal(result.body.success_qualified,false);assert.equal(result.body.sync.failure,'configuration-required');assert.equal(result.body.sync.success,'not-applicable');
  assert.equal((await post(e)).body.dedup,true);assert.equal((await post({...e,message:'mutated retry'})).status,409);assert.equal((await post({...e,event_sequence:0})).status,400);
  const old=await post({machine_id:'legacy-machine',log_date:'2026-10-19',content:'接收卡 完成',reason:'done'});assert.equal(old.body.sync,'not-qualified');assert.equal(old.body.success_qualified,false);
  const eventRoot=path.join(dir,'logs/tasks/events');const archive=JSON.parse(fs.readFileSync(path.join(eventRoot,fs.readdirSync(eventRoot)[0],'0000000000000001.json'),'utf8'));assert.deepEqual(archive.input,e);
  assert.equal(logs.status().tasks.pending,1);assert.equal(logs.status().pending,1);assert.equal(logs.status().legacyPending,0);assert.equal(externalCalls,0);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));logs.close();fs.rmSync(dir,{recursive:true,force:true});}
});
