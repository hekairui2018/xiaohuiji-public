'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {snapshot,buildDisplay,displayPatch,mergeSnapshot,recordDetails}=require('../backend/log-display.cjs');
const base={sender_model:'C16L',device_code:'synthetic-device-001',upgrade_run_id:'synthetic-run-001',selected_chip:'ICN2038S',recv_models:'R712×1',recv_models_source:'firmware_directory',receiver_inventory:[{count:1,model_source:'not_collected',firmware_model:'R712',firmware_model_source:'firmware_directory'}]};
const card=extra=>({run_id:base.upgrade_run_id,device_id:base.device_code,port:0,card_id:'1',model_source:'not_collected',firmware_model:'R712',firmware_model_source:'firmware_directory',before_version:'25.13.01.30',before_version_source:'hdset_detection',after_version:'25.26.65.30',after_version_source:'hdset_upgrade_readback',after_confirmed:true,status:'succeeded',status_source:'hdset_upgrade_result',...extra});
test('Each different version transition has its own real card count; duplicates never increase it',()=>{
 const first=card({model:'R712',model_source:'hdset_detection'}),second=card({model:'R712',model_source:'hdset_detection',card_id:'2'}),third=card({model:'R712',model_source:'hdset_detection',port:1,before_version:'1.2',after_version:'3.4'});
 const d=buildDisplay({...base,receiver_inventory:[{model:'R712',count:3}],receiver_upgrades:[first,second,third,first]});assert.match(d.versionInfo,/接收卡R712（2张）：25\.13\.01\.30 → 25\.26\.65\.30/);assert.match(d.versionInfo,/接收卡R712（1张）：1\.2 → 3\.4/);assert.ok(!d.versionInfo.includes('（3张）'));
 const missing=buildDisplay({...base,receiver_inventory:[{model:'R712'}],receiver_upgrades:[]});assert.match(missing.versionInfo,/接收卡R712（数量未采集）/);
});
test('New sender source fields survive normalization and details without turning firmware model into hardware identity',()=>{
 const input={...base,receiver_upgrades:[card()]},s=snapshot(input),d=buildDisplay(input);
 assert.deepEqual(s.receiver_inventory[0],{...base.receiver_inventory[0],model:''});for(const key of ['model_source','firmware_model','firmware_model_source','before_version_source','after_version_source','status_source'])assert.equal(s.receiver_upgrades[0][key],input.receiver_upgrades[0][key]);
 assert.equal(recordDetails(input).recv_models_source,'firmware_directory');assert.equal(d.productModel,'C16L＋接收卡（型号未确认）×1');assert.match(d.versionInfo,/型号未确认，网口0，卡号1.*25\.13\.01\.30 → 25\.26\.65\.30/);assert.ok(!d.versionInfo.includes('接收卡R712'));assert.match(d.siteEnvironment,/固件目录关联：R712（非硬件型号确认）/);assert.match(d.siteEnvironment,/手动选择）：ICN2038S/);
});
test('Several ports with the same card number retain independent before and after readings',()=>{
 const d=buildDisplay({...base,receiver_upgrades:[card(),card({port:1,before_version:'1.2',after_version:'3.4'})]});assert.match(d.versionInfo,/网口0，卡号1.*25\.13\.01\.30 → 25\.26\.65\.30/);assert.match(d.versionInfo,/网口1，卡号1.*1\.2 → 3\.4/);assert.ok(!d.versionInfo.includes('25.13.01.30 → 3.4'));
});
test('Detection without model or plan still displays a card reading, without inventing a count',()=>{
 const d=buildDisplay({...base,receiver_inventory:[],receiver_upgrades:[card({firmware_model:'',firmware_model_source:'',after_version:'',after_confirmed:false,status:'pending'})]});assert.equal(d.productModel,'C16L＋接收卡（型号未确认）');assert.match(d.versionInfo,/25\.13\.01\.30 → 升级后待确认/);
});
test('Confirmed no-upgrade, failed readback, no readback and target-only source stay distinct',()=>{
 const matched=buildDisplay({...base,receiver_upgrades:[card({status:'matched_no_upgrade',match_confirmed:true,after_version:'25.13.01.30'})]});assert.match(matched.versionInfo,/已匹配，无需升级/);
 const failed=buildDisplay({...base,receiver_upgrades:[card({status:'failed'})]});assert.match(failed.versionInfo,/25\.26\.65\.30（升级失败，保留实读结果）/);
 for(const r of [card({after_confirmed:false}),card({after_version_source:'target_firmware'}),card({target_version:'99.99',after_version:'',after_confirmed:false})]){const d=buildDisplay({...base,receiver_upgrades:[r]});assert.match(d.versionInfo,/升级后待确认/);assert.ok(!d.versionInfo.includes('99.99'));}
});
test('Foreign run/device and missing card identity cannot confirm a transition',()=>{
 for(const extra of [{run_id:'other'},{device_id:'other'},{card_id:''},{port:undefined}]){const d=buildDisplay({...base,receiver_upgrades:[card(extra)]});assert.ok(!d.versionInfo.includes('→ 25.26.65.30'));}
 const conflict=buildDisplay({...base,receiver_upgrades:[card(),card({before_version:'conflicting'})]});assert.ok(!conflict.versionInfo.includes('→ 25.26.65.30'));
});
test('Even a model field explicitly marked directory or not-collected cannot be promoted into E',()=>{
 for(const source of ['firmware_directory','not_collected']){const d=buildDisplay({...base,receiver_inventory:[{model:'R712',model_source:source,count:1}],receiver_upgrades:[card({model:'R712',model_source:source})]});assert.ok(!d.productModel.includes('R712'));assert.ok(!d.versionInfo.includes('接收卡R712'));}
});
test('A second run cannot inherit prior manual chip or card transition; manual E/F/environment remain protected',()=>{
 const first={...base,receiver_upgrades:[card()]},next=mergeSnapshot({upgrade_run_id:'new-run',device_code:base.device_code},snapshot(first));assert.equal(next.selected_chip,'');assert.equal(next.receiver_upgrades,undefined);
 const fields=displayPatch(buildDisplay(first)),environment='现场环境（软/固件版本、源端设备、线材）',current={...fields,'产品型号':'人工型号','版本信息':'人工版本',[environment]:'人工环境'};const patch=displayPatch(buildDisplay({...first,selected_chip:'OTHER'}),{existing:true,currentFields:current});for(const key of ['产品型号','版本信息',environment])assert.equal(Object.hasOwn(patch,key),false);assert.match(patch['自动建议-现场环境'],/OTHER/);
});
