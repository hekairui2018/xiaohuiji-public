'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {createFeishuLogs}=require('../v2/external-services/feishu-logs.cjs');
test('A failed queue write cannot leave an acknowledged receipt that hides a later retry',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-append-durable-')),configFile=path.join(dir,'feishu.env');fs.writeFileSync(configFile,'FEISHU_LOG_APPEND_ONLY=1\n');const logs=createFeishuLogs({directory:path.join(dir,'logs'),configFile,autoStart:false}),rename=fs.renameSync,payload={machine_id:'synthetic',log_date:'2026-10-18',content:'synthetic queue durability test'};
 try{fs.renameSync=(from,to)=>{if(String(to).includes(path.sep+'outbox'+path.sep))throw Error('synthetic write failure');return rename(from,to);};assert.throws(()=>logs.receive(payload));assert.equal(fs.readdirSync(path.join(dir,'logs/records')).length,0);fs.renameSync=rename;assert.equal(logs.receive(payload).dedup,false);assert.equal(logs.status().pending,1);assert.equal(logs.receive(payload).dedup,true);}finally{fs.renameSync=rename;logs.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Append receiver retains every upload and snapshot; exact retries never overwrite or requeue',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-append-')),configFile=path.join(dir,'feishu.env');fs.writeFileSync(configFile,'FEISHU_LOG_APPEND_ONLY=1\n');const logs=createFeishuLogs({directory:path.join(dir,'logs'),configFile,autoStart:false});
 try{
  const first={machine_id:'synthetic',device_code:'synthetic',log_date:'2026-10-18',upgrade_run_id:'first',client_ts:'2026-10-18T14:01:00+08:00',content:'first',selected_chip:'ONE',receiver_upgrades:[{port:0,card_id:'1',model_source:'not_collected',firmware_model:'R712',firmware_model_source:'firmware_directory'}]};
  assert.equal(logs.receive(first).dedup,false);const files=fs.readdirSync(path.join(dir,'logs/records')),old=fs.readFileSync(path.join(dir,'logs/records',files[0]),'utf8');assert.equal(logs.receive(first).dedup,true);assert.equal(fs.readFileSync(path.join(dir,'logs/records',files[0]),'utf8'),old);
  const second={machine_id:'synthetic',device_code:'synthetic',log_date:'2026-10-18',upgrade_run_id:'second',client_ts:'2026-10-18T14:02:00+08:00',content:'second'};logs.receive(second);logs.receive({...second,content:'changed content, same timestamp'});assert.equal(logs.receive(first).dedup,true);
  const records=fs.readdirSync(path.join(dir,'logs/records')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,'logs/records',n))));assert.equal(records.length,3);assert.equal(fs.readdirSync(path.join(dir,'logs/txt')).length,3);assert.equal(logs.status().pending,3);assert.equal(new Set(records.map(r=>r.receiver_upload_id)).size,3);assert.equal(fs.readFileSync(path.join(dir,'logs/records',files[0]),'utf8'),old);
  for(const r of records.filter(r=>r.upgrade_run_id==='second')){assert.equal(r.selected_chip,undefined);assert.equal(r.site_display_snapshot.selected_chip,'');assert.equal(r.receiver_upgrades,undefined);assert.equal(r.site_display_snapshot.receiver_upgrades,undefined);}
 }finally{logs.close();fs.rmSync(dir,{recursive:true,force:true});}
});
