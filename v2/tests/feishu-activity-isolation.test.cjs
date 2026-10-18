'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFeishuLogs}=require('../external-services/feishu-logs.cjs');
test('Website diagnostics remain local while distinct assistant uploads remain append-only',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-activity-isolation-'));
 const config=path.join(dir,'test.env');fs.writeFileSync(config,'FEISHU_LOG_APPEND_ONLY=1');
 const logs=createFeishuLogs({directory:dir,configFile:config,autoStart:false});
 try{
  for(let i=0;i<100;i++)assert.equal(logs.activity({sessionId:'test',route:i%2?'/api/docs':'quick',sequence:i}).storedLocally,true);
  assert.equal(fs.readFileSync(path.join(dir,'activity.jsonl'),'utf8').trim().split('\n').length,100);
  for(const sub of ['records','outbox','txt'])assert.equal(fs.readdirSync(path.join(dir,sub)).length,0);
  const input={machine_id:'synthetic',log_date:'2026-10-18',content:'first run',reason:'done'};
  assert.equal(logs.receive(input).dedup,false);
  assert.equal(logs.receive(input).dedup,true);
  assert.equal(logs.receive({...input,content:'second run'}).dedup,false);
  assert.equal(logs.status().pending,2);
  assert.equal(fs.readdirSync(path.join(dir,'records')).length,2);
 }finally{logs.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Machine-only mode overwrites only the same machine, sender and day without inheriting old readings',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-machine-only-')),config=path.join(dir,'test.env');
 fs.writeFileSync(config,'FEISHU_LOG_MACHINE_ONLY=1\nFEISHU_LOG_APPEND_ONLY=1\nFEISHU_SYNC_ENABLED=1\nFEISHU_APP_ID=synthetic\nFEISHU_APP_SECRET=synthetic\nFEISHU_APP_TOKEN=synthetic\nFEISHU_TABLE_ID=synthetic');
 let writes=[];const ok=data=>({json:async()=>({code:0,data})});
 const fetchImpl=async(url,init)=>{
  if(url.includes('/tenant_access_token/'))return {json:async()=>({code:0,tenant_access_token:'synthetic',expire:7200})};
  if(url.includes('/fields?'))return ok({items:[{field_name:'系列编号',is_primary:true,type:1},...['APP版本','上报类型','日期','客户端时间','服务器接收时间','上传次数','日志附件','入库时间','发送型号','FPGA版本','应用版本','驱动芯片','接收卡型号','接收卡版本','HDSet版本','HDPlayer版本','回传编号'].map(field_name=>({field_name,type:1}))]});
  if(url.includes('/upload_all'))return ok({file_token:'synthetic'});
  if(url.includes('/records/search')){assert.match(JSON.parse(init.body).filter.conditions[0].value[0],/^machine-one＋device-[ab]@2026-10-(17|18)$/);return ok({items:[{record_id:'existing-machine'}]});}
  if(init.method==='PUT'){writes.push(JSON.parse(init.body));return ok({});}
  throw Error('unexpected request '+init.method);
 };
 const logs=createFeishuLogs({directory:dir,configFile:config,fetchImpl,autoStart:false});
 try{
  const input={upload_status:'succeeded',machine_id:'machine-one',devKey:'device-a',log_date:'2026-10-17',content:'first',device_app_version:'1.2.3',upgrade_run_id:'first'};
  logs.receive(input);await logs.drain();assert.equal(logs.status().pending,0);
  logs.receive({...input,devKey:'device-a',log_date:'2026-10-17',content:'second',device_app_version:'',upgrade_run_id:'second'});
  await logs.drain();assert.equal(logs.status().pending,0);assert.equal(writes.length,2);
  assert.ok(writes.every(x=>x.fields['系列编号']==='machine-one＋device-a@2026-10-17'));
  const records=fs.readdirSync(path.join(dir,'records'));assert.equal(records.length,1);
  const stored=JSON.parse(fs.readFileSync(path.join(dir,'records',records[0])));assert.equal(stored.content,'second');assert.equal(stored.site_display_snapshot.device_app_version,'');
  logs.receive({...input,upload_status:'failed',content:'failure-one'});
  logs.receive({...input,upload_status:'failed',content:'failure-two'});
  logs.receive({...input,upload_status:undefined,content:'unknown legacy result'});
  assert.equal(fs.readdirSync(path.join(dir,'records')).length,1);
  assert.equal(logs.status().pending,1);
  logs.receive({...input,log_date:'2026-10-18',content:'next day'});
  assert.equal(fs.readdirSync(path.join(dir,'records')).length,2);
  logs.receive({...input,devKey:'device-b',content:'another sender'});
  assert.equal(fs.readdirSync(path.join(dir,'records')).length,3);
  assert.equal(fs.readdirSync(path.join(dir,'archive')).length,7);
 }finally{logs.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Unconfirmed hardware models group same transitions without losing raw card details',()=>{
 const {buildDisplay}=require('../../backend/log-display.cjs');
 const cards=Array.from({length:26},(_,i)=>({run_id:'run',device_id:'device',port:Math.floor(i/4),card_id:String(i%4+1),model_source:'not_collected',firmware_model:'R712',firmware_model_source:'firmware_directory',before_version:i<23?'25.06.02.30':'25.09.01.30',after_version:'25.26.65.30',after_version_source:'hdset_upgrade_readback',after_confirmed:true,status:'succeeded'}));
 const result=buildDisplay({upgrade_run_id:'run',device_code:'device',receiver_upgrades:cards});
 assert.equal(result.versionInfo.split('\n').length,4);assert.match(result.versionInfo,/23张/);assert.match(result.versionInfo,/3张/);assert.equal(result.snapshot.receiver_upgrades.length,26);
});

test('Transport feedback and request time changes skip sync; equipment facts and real failures do not',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-business-dedup-')),config=path.join(dir,'test.env');fs.writeFileSync(config,'FEISHU_LOG_MACHINE_ONLY=1');
 const logs=createFeishuLogs({directory:dir,configFile:config,autoStart:false});try{
  const r={machine_id:'machine',device_code:'sender',log_date:'2026-10-18',content:'19:00:00.123  【失败】设备未连接',client_ts:'first',fpga_version:'1.2.3'};
  assert.equal(logs.receive(r).dedup,false);
  assert.equal(logs.receive({...r,client_ts:'second',content:r.content+'\n19:00:01.123  【操作】日志回传(done)：成功'}).dedup,true);
  assert.equal(logs.receive({...r,fpga_version:'1.2.4'}).dedup,false);
  assert.equal(logs.receive({...r,content:r.content+'\n19:01:00.000  【失败】重试仍未连接'}).dedup,false);
  assert.equal(fs.readdirSync(path.join(dir,'records')).length,1);assert.equal(fs.readdirSync(path.join(dir,'archive')).length,4);
 }finally{logs.close();fs.rmSync(dir,{recursive:true,force:true});}
});
