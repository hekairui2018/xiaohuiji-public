'use strict';
const crypto=require('crypto');
// Project the existing checksum-verified chip table, preserving its labels.
// A firmware category is not approval to flash a particular receiver/hardware.
function expertFirmwareEvidence(query,{lookup,evidence,models=[]}={}){
 if(!evidence)return [];
 const text=String(query),family=/(?<!\d)(\d{2,3})\s*(?:系列)?固件/.exec(text)?.[1];
 const familyRecord=family&&evidence.display.data.firmwareFamilies[family];
 const exact=lookup?.(text,models.map(modelId=>({modelId})))?.items||[];
 const requestedPrefixes=[...new Set((text.match(/\b(?:ICND?|SM|DP|LS|FM|MBI)\b/gi)||[]).map(x=>x.toUpperCase()))];
 const parts=value=>/^([a-z]*)(\d{4,5})([a-z]*)$/i.exec(String(value));
 const requested=[...text.matchAll(/(?<![a-z0-9])([a-z]{0,5}\d{4,5}[a-z]{0,4})(?![a-z0-9])/gi)].map(m=>parts(m[1])).filter(Boolean);
 const candidates=exact.length||familyRecord?[]:evidence.chips.data.rows.filter(r=>r.models.some(model=>{const actual=parts(model);return actual&&requested.some(w=>w[2]===actual[2]&&(!w[1]||w[1].toUpperCase()===actual[1].toUpperCase())&&(!w[3]||w[3].toUpperCase()===actual[3].toUpperCase()));}));
 const rows=exact.length?exact:familyRecord?evidence.chips.data.rows.filter(r=>r.firmwareType===familyRecord.label&&(!requestedPrefixes.length||r.models.some(m=>requestedPrefixes.some(p=>m.toUpperCase().startsWith(p))))):candidates;
 if(!rows.length)return [];
 const groups=Array.from({length:Math.ceil(rows.length/30)},(_,i)=>rows.slice(i*30,i*30+30));
 return groups.slice(0,4).map((batch,i)=>({
  evidenceId:'firmware-reference-'+crypto.createHash('sha256').update(JSON.stringify(batch)).digest('hex').slice(0,24),
  name:'芯片选型 '+evidence.chips.data.sourceVersion,
  text:(candidates.length?'以下按数字简称找到源表候选，厂商前缀和后缀仍需核实，不能自动认定完整芯片身份。\n':'')+batch.map(r=>r.models.join('/')+'；智能设置：'+r.smartSelection+'；源表固件类别：'+(r.firmwareType||'未记录')+'；原文：'+r.sourceLine+'；页码：'+r.page).join('\n')+'\n以上只投影源表固件类别，不代表已确认接收卡硬件适用或当前升级包。',
  sourceKind:'structured-firmware-reference',modelIds:[],readPerformed:true,readAvailable:false,contextComplete:groups.length<=4,locator:{section:'芯片选型原表',part:i+1},scope:{chips:batch.flatMap(r=>r.models)},verificationStatus:'source-table-category-not-device-compatibility'
 }));
}
module.exports={expertFirmwareEvidence};
