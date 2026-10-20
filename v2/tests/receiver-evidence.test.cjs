'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {model,cardResult}=require('../../backend/receiver-evidence.cjs');
const {buildDisplay,snapshot,recordDetails,displayPatch}=require('../../backend/log-display.cjs');
const {createTaskLogStore,collectionQualifies,qualifies}=require('../external-services/task-log-store.cjs');
const base={task_protocol:1,task_run_id:'synthetic-evidence-task',machine_id:'synthetic-machine',event_id:'synthetic-event-001',event_sequence:1,event_kind:'snapshot',device_code:'A6L-23-A0001',sender_model:'A6L',sender_model_source:'hdset_selected_device_label_model_prefix',upgrade_run_id:'synthetic-receiver-run',recv_models_source:'structured_per_card',log_date:'2026-10-20',content:'synthetic original task log'};
const card={run_id:base.upgrade_run_id,device_id:base.device_code,port:1,card_id:'1',model:'R712',model_source:'hdset_version_suffix_mapping',model_candidates:['R712'],model_evidence_version:'25.13.99.30',model_evidence_suffix:'30',model_evidence_table:'receiver-card-firmware-suffixes.json',before_version:'25.13.99.30',before_version_source:'hdset_detection',firmware_model:'R712',firmware_model_source:'firmware_directory',target_version:'25.26.65.30',status:'unknown',match_confirmed:false,after_confirmed:false,write_reported_status:'succeeded',write_reported_version:'25.26.65.30',write_reported_finished:true,write_reported_source:'hdset_write_result_single_port_batch'};
const event=(changes={})=>({...base,receiver_inventory:[{model:'R712',model_source:card.model_source,model_candidates:['R712'],count:1}],receiver_upgrades:[{...card}],...changes});
const next=(seq,changes={})=>event({event_sequence:seq,event_id:'synthetic-event-'+String(seq).padStart(3,'0'),...changes});

test('Sender A6L/C/D/VP/T and legitimate spaced receiver names retain original case; serials and prose rejected',()=>{
 for(const value of ['A6L','C16L','D15','VP1240A','T902X1','R5S Plus','R500 Green']){assert.equal(model(value),value);const e=event({sender_model:value,receiver_upgrades:[{...card,model:value,model_candidates:[value]}]});assert(buildDisplay(e).productModel.includes(value));}
 for(const value of ['A6L-23-A0001','C16L＋R712','任意文本','R712 upgrade success','R712\n备注', 'R1 '+ 'x'.repeat(100)])assert.equal(model(value),'');
});
test('Unique suffix 30 evidence is annotated, 31/82 multiple candidates cannot be selected from firmware directory',()=>{
 const unique=buildDisplay(event());assert.match(unique.productModel,/R712（实读版本对照表匹配）/);assert.match(unique.siteEnvironment,/25\.13\.99\.30.*尾缀：30/);
 for(const suffix of ['31','82']){
 const options=['R5S Plus','R500 Green'],d=buildDisplay(event({receiver_upgrades:[{...card,model:undefined,model_source:'hdset_version_suffix_candidates',model_candidates:options,model_evidence_suffix:suffix,model_evidence_version:'25.13.99.'+suffix}]}));
 assert.match(d.productModel,/型号待确认/);assert.match(d.productModel,/R5S Plus、R500 Green/);assert(!d.productModel.includes('对照表匹配'));
 }
 const unknown=buildDisplay(event({receiver_upgrades:[{...card,model:undefined,model_source:'not_collected',model_candidates:[],model_evidence_suffix:'999'}]}));assert(!unknown.productModel.includes('R712'));assert.match(unknown.siteEnvironment,/固件目录关联.*R712/);
});
test('Structured per-card data excludes old product summaries/site_env and counts exact identities across ports once',()=>{
 const rows=[{...card},{...card,port:2},{...card}];const d=buildDisplay(event({product_models:'A3',recv_models:'R512S×99',site_env:'接收卡：R512S；已升级到目标值',receiver_inventory:[{model:'R712',count:99}],receiver_upgrades:rows}));
 assert.match(d.productModel,/×2/);assert(!d.productModel.includes('R512S'));assert(!d.siteEnvironment.includes('已升级到目标值'));assert.match(d.versionInfo,/（2张）/);assert.equal(d.snapshot.receiver_upgrades.length,3);
 const conflict=buildDisplay(event({receiver_upgrades:[{...card,firmware_model:'R512S'}]}));assert.match(conflict.productModel,/R712/);assert(!conflict.productModel.includes('R512S'));assert(conflict.warnings.some(w=>w.includes('冲突')));
});
test('Write reports never replace actual readback, unfinished reports or no-upgrade comparison',()=>{
 const d=buildDisplay(event());assert.match(d.versionInfo,/HDSet报告写入成功；升后版本未实读/);assert.match(d.versionInfo,/报告版本：25\.26\.65\.30/);assert(!d.versionInfo.includes('→ 25.26.65.30'));
 assert.equal(qualifies(event()),false);assert.equal(collectionQualifies(event()),true);
 const read={...card,status:'succeeded',after_confirmed:true,after_version_source:'hdset_upgrade_readback',after_version:card.target_version};
 const confirmed=event({event_kind:'receiver_checkpoint',checkpoint_source:'receiver_upgrade_readback',receiver_upgrades:[read]});assert.equal(qualifies(confirmed),true);assert.match(buildDisplay(confirmed).versionInfo,/→ 25\.26\.65\.30/);
 const checked={...card,status:'matched_no_upgrade',match_confirmed:true,status_source:'explicit_version_comparison',before_version:card.target_version};assert(cardResult(checked).matched);assert.match(buildDisplay(event({receiver_upgrades:[checked]})).versionInfo,/无需升级/);
 assert(!cardResult({...checked,status_source:undefined}).matched);assert(!cardResult({...checked,match_confirmed:false}).matched);
 for(const extra of [{write_reported_finished:false},{write_reported_source:'unknown'},{port:undefined},{run_id:'other-run'},{device_id:'other-device'}])assert(!buildDisplay(event({receiver_upgrades:[{...card,...extra}]})).versionInfo.includes('HDSet报告写入成功'));
 const failed=buildDisplay(event({receiver_upgrades:[{...card,write_reported_status:'failed',status:'failed'}]}));assert.match(failed.versionInfo,/报告写入失败/);
 assert(!buildDisplay(event({receiver_upgrades:[{...card,status:'failed'}]})).versionInfo.includes('报告写入成功'));
});
test('Missing ports/multiple batches and aggregate done alone remain unqualified; all candidates/evidence survive details',()=>{
 for(const receiver_upgrades of [[],[{...card,port:undefined}],[{...card,run_id:'old-batch'}],[{...card},{...card,before_version:'25.0.0.30'}]])assert(!collectionQualifies(event({receiver_upgrades,reason:'done',content:'aggregate complete'})));
 const s=snapshot(event()),r=recordDetails(event());for(const k of ['model_candidates','model_evidence_version','model_evidence_suffix','model_evidence_table','write_reported_status','write_reported_version','write_reported_finished','write_reported_source'])assert.deepEqual(s.receiver_upgrades[0][k],card[k]);assert.deepEqual(r.receiver_upgrades,[card]);
 const missing=snapshot({...base,receiver_upgrades:[{run_id:base.upgrade_run_id}]});assert.equal(missing.receiver_upgrades[0].write_reported_status,undefined);
});
function storeFixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-evidence-'));const writes=[];const writer={async sync(kind,state,receipt){writes.push({kind,state});return {record_id:receipt.record_id||'synthetic-'+kind};}};let store=createTaskLogStore({directory,writer,autoStart:false});return {directory,writes,get store(){return store;},restart(){store.close();store=createTaskLogStore({directory,writer,autoStart:false});},close(){store.close();fs.rmSync(directory,{recursive:true,force:true});}};}
test('New collected record is queued without inventing failure/success; raw events and TXT are complete',async()=>{const f=storeFixture();try{
 const e=event(),r=f.store.receive(e);assert(r.accepted&&r.durable&&r.collection_qualified);assert.equal(r.success_qualified,false);assert.equal(r.sync.success,'queued');assert.equal(r.sync.failure,'not-applicable');assert.equal(r.records.success,null);await f.store.drain();
 const done=f.store.receive(e);assert(done.dedup);assert.equal(done.sync.success,'synced');assert.equal(done.records.success,'synthetic-success');assert.equal(f.writes.length,1);
 const folder=fs.readdirSync(path.join(f.directory,'events'))[0],raw=JSON.parse(fs.readFileSync(path.join(f.directory,'events',folder,'0000000000000001.json'),'utf8'));assert.deepEqual(raw.input,e);const txt=fs.readFileSync(path.join(f.directory,'txt',folder+'.txt'),'utf8');assert(txt.includes('write_reported_source'));assert(txt.includes('model_evidence_table'));
 f.store.receive(next(2,{client_ts:'later',content:'transport feedback only'}));await f.store.drain();assert.equal(f.writes.length,1);
 const modified={...card,model_evidence_table:'revised-company-table.json'};f.store.receive(next(3,{receiver_upgrades:[modified]}));await f.store.drain();assert.equal(f.writes.length,2);
 f.store.receive(next(2,{client_ts:'later',content:'transport feedback only'}));await f.store.drain();assert.equal(f.writes.length,2);f.restart();assert.equal(f.store.status().pending,0);
}finally{f.close();}});
test('Source supplements after strict success trigger sync without borrowing another card result',async()=>{const f=storeFixture();try{
 const rows=[{...card,status:'succeeded',after_version:card.target_version,after_version_source:'hdset_upgrade_readback',after_confirmed:true}];f.store.receive(event({event_kind:'receiver_checkpoint',checkpoint_source:'receiver_upgrade_readback',receiver_upgrades:rows}));await f.store.drain();
 f.store.receive(next(2,{receiver_upgrades:[{...rows[0],model:'R5S Plus',model_candidates:['R5S Plus'],model_evidence_table:'new-map.json'}]}));await f.store.drain();assert.equal(f.writes.length,2);assert.equal(f.writes.at(-1).state.success.receiver_upgrades[0].model,'R5S Plus');assert.equal(f.writes.at(-1).state.success.receiver_upgrades[0].after_version,card.target_version);
}finally{f.close();}});
test('Cross-device rejection, new runs, late old batches and separate task identities do not borrow observations',async()=>{const f=storeFixture();try{
 f.store.receive(event());await f.store.drain();assert.throws(()=>f.store.receive(next(2,{device_code:'C16L-another'})),/task-device-conflict/);
 f.store.receive(next(2,{upgrade_run_id:'new-receiver-run',receiver_upgrades:[],receiver_inventory:[]}));await f.store.drain();assert.equal(f.store.status().pending,0);
 f.store.receive(next(3));await f.store.drain();assert.equal(f.writes.length,1,'retired batch archived without restoring model/results');
 f.store.receive(next(1,{task_run_id:'synthetic-new-task',sender_model:undefined,receiver_upgrades:[],receiver_inventory:[]}));await f.store.drain();assert.equal(f.writes.length,1);
}finally{f.close();}});
test('Pre-change archive is not automatically promoted or retroactively enrolled by an identical retry',async()=>{const f=storeFixture();try{
 f.store.receive(event());f.store.close();const folder=fs.readdirSync(path.join(f.directory,'events'))[0],file=path.join(f.directory,'events',folder,'0000000000000001.json'),raw=JSON.parse(fs.readFileSync(file));delete raw.collection_policy;fs.writeFileSync(file,JSON.stringify(raw));f.restart();assert.equal(f.store.status().pending,0);const retry=f.store.receive(event());assert.equal(retry.collection_qualified,false);await f.store.drain();assert.equal(f.writes.length,0);
}finally{f.close();}});
test('E and F edits/clears and unknown legacy baselines remain independently protected; suggestions update',()=>{
 const environment='现场环境（软/固件版本、源端设备、线材）',first=displayPatch(buildDisplay(event()));
 for(const column of ['产品型号','版本信息'])for(const value of ['人工填写','']){const existing={...first,[column]:value},patch=displayPatch(buildDisplay(event({sender_model:'C16L'})),{existing:true,currentFields:existing});assert(!Object.hasOwn(patch,column));assert(patch['自动建议-产品型号'].includes('C16L'));assert.equal(JSON.parse(patch['自动写入基线']).fields[column].manual,true);}
 const legacy=displayPatch(buildDisplay(event()),{existing:true,currentFields:{'产品型号':'旧型号','版本信息':'旧版本',[environment]:'旧环境'}});assert(!Object.hasOwn(legacy,'产品型号'));assert(!Object.hasOwn(legacy,'版本信息'));
});
module.exports={event,next,card,base};

test('Optional new evidence fields reject malformed values instead of silently dropping candidates',()=>{
 const f=storeFixture();try{for(const changes of [{model_candidates:'R712'},{model_candidates:Array(257).fill('R712')},{write_reported_finished:'true'},{model_evidence_table:5}])assert.throws(()=>f.store.receive(event({receiver_upgrades:[{...card,...changes}]})),/invalid-task-event/);}finally{f.close();}
});
