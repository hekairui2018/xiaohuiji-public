'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTaskLogStore,qualifies}=require('../external-services/task-log-store.cjs');
const base={task_protocol:1,task_run_id:'task-run-0001',machine_id:'machine-0001',event_id:'event-0001',event_sequence:1,event_kind:'snapshot',log_date:'2026-10-19',content:'original log',device_code:'VP1240A',upgrade_run_id:'receiver-run-1'};
const card={run_id:base.upgrade_run_id,device_id:base.device_code,port:7,card_id:'3',status:'succeeded',status_source:'hdset_upgrade_result',before_version:'25.6.2.30',after_version:'25.26.65.30',target_version:'25.26.65.30',after_confirmed:true,after_version_source:'hdset_upgrade_readback'};
const success=(seq=1)=>({...base,event_id:'event-'+String(seq).padStart(4,'0'),event_sequence:seq,event_kind:'receiver_checkpoint',checkpoint_source:'receiver_upgrade_readback',receiver_inventory:[{count:1}],receiver_upgrades:[card]});
const failure=(seq=1)=>({...base,event_id:'event-'+String(seq).padStart(4,'0'),event_sequence:seq,event_kind:'exception',origin:'automation',node:'read-receiver',message:'window disappeared '+seq});
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-task-')),rows=new Map(),writes=[];const writer={async sync(kind,state,receipt){const key=kind+state.key,id=rows.get(key)||'record-'+(rows.size+1);rows.set(key,id);writes.push({kind,state,receipt});return {record_id:id};}};let store=createTaskLogStore({directory,writer,autoStart:false});return {directory,rows,writes,get store(){return store;},restart(){store.close();store=createTaskLogStore({directory,writer,autoStart:false});},close(){store.close();fs.rmSync(directory,{recursive:true,force:true});}};}
test('Receiver result and actual no-upgrade comparison qualify; done/word/aggregate do not',()=>{
 assert.equal(qualifies(success()),true);
 assert.equal(qualifies({...base,reason:'done',content:'接收卡升级成功',success:true}),false);
 assert.equal(qualifies({...success(),receiver_upgrades:[{...card,after_confirmed:false}]}),false);
 assert.equal(qualifies({...success(),receiver_inventory:[{count:26}]}),false);
 assert.equal(qualifies({...success(),receiver_upgrades:[{...card,device_id:'other'}]}),false);
 const matched={...card,status:'matched_no_upgrade',match_confirmed:true,status_source:'explicit_version_comparison',before_version:card.target_version,after_version:undefined};
 assert.equal(qualifies({...success(),checkpoint_source:'receiver_version_comparison',receiver_upgrades:[matched]}),true);
 assert.equal(qualifies({...success(),receiver_upgrades:[{...matched,before_version:''}]}),false);
});
test('Key-node success persists after exit; duplicate content does not repeatedly sync',async()=>{const f=fixture();try{
 const result=f.store.receive(success());assert.equal(result.success_qualified,true);assert.equal(result.sync.success,'queued');await f.store.drain();
 assert.equal(f.store.receive(success()).sync.success,'synced');
 f.store.receive({...success(2),event_kind:'snapshot',reason:'done',content:'later navigation only'});await f.store.drain();
 assert.equal(f.rows.size,1);assert.equal(f.writes.length,1);
}finally{f.close();}});
test('Three exceptions merge, remain after recovery; manual/unknown interruption not confirmed failure',async()=>{const f=fixture();try{
 for(let i=1;i<=3;i++){f.store.receive(failure(i));await f.store.drain();}
 assert.equal(f.rows.size,1);assert.equal(f.writes.at(-1).state.exceptions.length,3);
 f.store.receive(success(4));await f.store.drain();assert.equal(f.rows.size,2);assert.equal(f.writes.find(x=>x.kind==='success').state.exceptions.length,3);
 f.store.receive({...failure(5),task_run_id:'human-task-1',origin:'human'});f.store.receive({...failure(6),task_run_id:'unknown-task-1',origin:'unknown'});await f.store.drain();assert.equal(f.rows.size,2);
}finally{f.close();}});
test('New task on same machine/device/day gets new row; stale arrivals retain exception history without overwriting facts',async()=>{const f=fixture();try{
 f.store.receive(success(3));await f.store.drain();
 const stale=f.store.receive({...failure(1),device_app_version:'old'});assert.equal(stale.stale,true);assert.equal(stale.latest_sequence,3);await f.store.drain();
 assert.equal(f.writes.at(-1).state.success.receiver_upgrades[0].after_version,card.after_version);
 f.store.receive({...success(),task_run_id:'task-run-0002'});await f.store.drain();assert.equal(f.rows.size,3);
 assert.throws(()=>f.store.receive({...failure(1),message:'changed retry'}),/task-event-conflict/);
}finally{f.close();}});
test('Archive survives restart, offline retry and ambiguous remote success',async()=>{const f=fixture();try{
 f.store.receive(failure());f.restart();assert.equal(f.store.status().pending,1);await f.store.drain();assert.equal(f.rows.size,1);
 assert.equal(f.store.receive(failure()).dedup,true);await f.store.drain();assert.equal(f.writes.length,1);
 const archived=fs.readdirSync(path.join(f.directory,'events'));assert.equal(archived.length,1);
 const receipt=fs.readdirSync(path.join(f.directory,'receipts'))[0];fs.unlinkSync(path.join(f.directory,'receipts',receipt));
 f.restart();await f.store.drain();assert.equal(f.rows.size,1);assert.equal(f.writes.length,2);
}finally{f.close();}});
test('A success-table error does not block exception-table delivery',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-task-independent-'));let failureWrites=0;
 const store=createTaskLogStore({directory,autoStart:false,writer:{async sync(kind){if(kind==='success')throw Error('task-schema-not-confirmed');failureWrites++;return {record_id:'failure-record'};}}});
 try{store.receive(failure());store.receive(success(2));const result=await store.drain();assert.equal(result.completed,1);assert.equal(result.failed,1);assert.equal(failureWrites,1);assert.equal(store.status().lastError.kind,'success');assert.equal(store.status().pending,1);}finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
