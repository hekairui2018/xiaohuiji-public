/* Shared display metadata from verified source tables; labels do not establish compatibility. */
(function(root){
'use strict';
const rows=[{"models":["R712"],"suffix":"30","commonCodes":["01"],"specialCodes":["72"]},{"models":["R716","R732"],"suffix":"31","commonCodes":["01"],"specialCodes":["72"]},{"models":["R3210"],"suffix":"38","commonCodes":["00"],"specialCodes":[]},{"models":["R708"],"suffix":"32","commonCodes":["02"],"specialCodes":["72"]},{"models":["K08"],"suffix":"40","commonCodes":["06"],"specialCodes":["72","91"]},{"models":["K12"],"suffix":"41","commonCodes":["04"],"specialCodes":["72","91"]},{"models":["RP375"],"suffix":"34","commonCodes":[],"specialCodes":[]},{"models":["R5S Plus"],"suffix":"45","commonCodes":["03"],"specialCodes":[]},{"models":["R5S"],"suffix":"82","commonCodes":["00","01"],"specialCodes":[]},{"models":["RB6"],"suffix":"33","commonCodes":["01"],"specialCodes":["12","23"]},{"models":["R500S"],"suffix":"85","commonCodes":["00"],"specialCodes":[]},{"models":["R507T"],"suffix":"87","commonCodes":["00"],"specialCodes":[]},{"models":["R712"],"suffix":"39","commonCodes":["01"],"specialCodes":["72"]},{"models":["R5S"],"suffix":"89","commonCodes":["00","01"],"specialCodes":[]},{"models":["R512T","R508T"],"suffix":"70","commonCodes":["00"],"specialCodes":["72"]},{"models":["R512S"],"suffix":"83","commonCodes":["00"],"specialCodes":[]},{"models":["R512"],"suffix":"81","commonCodes":["01"],"specialCodes":[]},{"models":["R612"],"suffix":"72","commonCodes":["01"],"specialCodes":[]},{"models":["R516","R320"],"suffix":"82","commonCodes":["00"],"specialCodes":[]},{"models":["R516T","R320T"],"suffix":"86","commonCodes":["00"],"specialCodes":["72"]},{"models":["R508"],"suffix":"73","commonCodes":["00"],"specialCodes":[]},{"models":["R5018"],"suffix":"63","commonCodes":[],"specialCodes":[]},{"models":["R500 Green"],"suffix":"10","commonCodes":[],"specialCodes":[]},{"models":["R500 Red"],"suffix":"80","commonCodes":[],"specialCodes":[]},{"models":["R501 Green","R501E"],"suffix":"11","commonCodes":[],"specialCodes":[]},{"models":["R501S","R501 Red"],"suffix":"71","commonCodes":[],"specialCodes":[]},{"models":["R502"],"suffix":"02","commonCodes":[],"specialCodes":[]},{"models":["R505"],"suffix":"15","commonCodes":[],"specialCodes":[]},{"models":["R507"],"suffix":"17","commonCodes":[],"specialCodes":[]}];
const asyncGroups=[{"id":"c-d-classic","models":["C16","C36","D16","D36"],"mappings":{"common":{"status":"confirmed","suffix":"70","evidenceScope":"family-and-file-name"},"63":{"status":"confirmed","suffix":"73","evidenceScope":"family-and-file-name"},"65":{"status":"confirmed","suffix":"71","evidenceScope":"family-and-file-name"},"97":{"status":"confirmed","suffix":"77","evidenceScope":"family-and-file-name"},"99":{"status":"confirmed","suffix":"79","evidenceScope":"family-and-file-name"}}},{"id":"c08l","models":["C08L"],"mappings":{"common":{"status":"confirmed","suffix":"70","evidenceScope":"family-and-file-name"},"63":{"status":"confirmed","suffix":"73","evidenceScope":"family-and-file-name"},"65":{"status":"confirmed","suffix":"71","evidenceScope":"family-and-file-name"},"97":{"status":"unverified","suffix":null,"evidenceScope":"not-confirmed-for-this-model"},"99":{"status":"confirmed","suffix":"79","evidenceScope":"family-and-file-name"}}},{"id":"c16l","models":["C16L"],"mappings":{"common":{"status":"confirmed","suffix":"0","evidenceScope":"family-and-file-name"},"63":{"status":"confirmed","suffix":"63","evidenceScope":"family-and-file-name"},"65":{"status":"confirmed","suffix":"65","evidenceScope":"family-and-file-name"},"97":{"status":"confirmed","suffix":"97","evidenceScope":"family-and-file-name"},"99":{"status":"confirmed","suffix":"99","evidenceScope":"family-and-file-name"}}},{"id":"c16h","models":["C16H"],"mappings":{"common":{"status":"unverified","suffix":null,"evidenceScope":"not-confirmed-for-this-model"},"63":{"status":"unverified","suffix":null,"evidenceScope":"not-confirmed-for-this-model"},"65":{"status":"confirmed","suffix":"65","evidenceScope":"firmware-type-only","deliveryVerified":false},"97":{"status":"unverified","suffix":null,"evidenceScope":"not-confirmed-for-this-model"},"99":{"status":"unverified","suffix":null,"evidenceScope":"not-confirmed-for-this-model"}},"note":"仅有 C16H 65 系列版本字段的直接记录；未确认可交付原文件，也不从 C16L 继承其他映射。"}];
const families={"common":"通用固件","63":"ICN1063系列固件","65":"ICN2065系列固件","97":"LS9937系列固件","99":"LS99系列固件"};

const key=s=>String(s||'').replace(/^HD[-_ ]?/i,'').replace(/[^a-z0-9]/gi,'').toUpperCase();
function describe(name,record={}){
 record={...record,versionNote:record.versionNote||(record.scopeEvidence||[]).join(' '),models:record.models||record.associatedModels||record.applicableModels||[]};
 const original=String(name||'');
 // Registry version notes may identify a renamed original, but never borrow another model.
 const normalized=original.replace(/^FPGA_(.+?)_V?(\d+(?:[._]\d+){3})(\.bin)$/i,'$1_FPGA_V$2$3');
 const candidates=[normalized,...String(record.versionNote||'').matchAll(/(?:[A-Za-z0-9]+_)+FPGA_V?\d+(?:[._]\d+){3}/gi)].map(v=>typeof v==='string'?v:v[0]);
 const typo=original.match(/^FPFA_(.+?)_V?(\d+(?:[._]\d+){3})\.bin$/i)||original.match(/^(.+?)_FPFA_V?(\d+(?:[._]\d+){3})\.bin$/i);
 if(typo&&!String(record.versionNote||'').includes(typo[2]))return null;
 if(typo&&String(record.versionNote||'').includes(typo[2]))candidates.unshift(typo[1]+'_FPGA_V'+typo[2]+'.bin');
 const registered=(record.models||[]).map(key);
 for(const candidate of candidates){
  const m=candidate.match(/^(.*?)_(?:FPGA_)?V?(\d+(?:[._]\d+){3})(?:_([A-Z]\d+))?(?:_MCU\d?_V\d+(?:[._]\d+)+)*(?:\.*bin)?$/i);
  if(!m)continue;
  const names=[key(m[1]),...m[1].split('_').map(key)];
  if(/^C16C$/i.test(m[1])&&registered.some(n=>['C16','C36'].includes(n)))names.push(...registered);
  const numbers=m[2].split(/[._]/),isAsync=asyncGroups.some(g=>g.models.some(n=>names.includes(key(n))));
  if(candidate!==original&&candidate!==normalized&&!names.some(n=>registered.includes(n))&&!typo)continue;
  const variant=m[3]&&!/^MCU$/i.test(m[3])?m[3]:null;
  if(isAsync){
   const groups=asyncGroups.filter(g=>g.models.some(n=>names.includes(key(n))));
   const mapped=groups.flatMap(g=>Object.entries(g.mappings).filter(([,v])=>v.status==='confirmed'&&v.suffix!=null&&Number(v.suffix)===Number(numbers[3])).map(([family,v])=>({family,...v})));
   if(!mapped.length)return {label:'异步固件 · 系列用途待核对',series:numbers[3],kind:'asynchronous',confirmed:false,deliveryVerified:false};
   const labels=[...new Set(mapped.map(v=>families[v.family]))];
   if(labels.length!==1)return {label:'异步固件 · 系列用途待核对',series:numbers[3],kind:'asynchronous',confirmed:false,deliveryVerified:false};
   return {label:labels[0],series:numbers[3],family:mapped[0].family,kind:'asynchronous',confirmed:true,deliveryVerified:mapped.every(v=>v.deliveryVerified!==false)};
  }
  const known=rows.filter(r=>r.models.some(n=>names.includes(key(n))));if(!known.length)continue;
  const exact=known.filter(r=>String(r.suffix)===numbers[3]),series=numbers[2];
  const common=exact.some(r=>r.commonCodes.includes(series));
  const family=common?'common':families[series]?series:null;
  const receiverLabels={'63':'ICN1063 系列','65':'ICN2065 系列','97':'LS9937 系列','99':'LS99 系列'};
  const label=common?families.common:receiverLabels[series]||(exact.some(r=>r.specialCodes.includes(series))?'专用固件 · '+series+' 系列':series+' 系列 · 用途待核对');
  return {label:label+(variant?' · '+variant:''),series,family,kind:'receiver',confirmed:!!family&&exact.length>0,deliveryVerified:exact.length>0};
 }
 return null;
}
const api={describe};if(typeof module!=='undefined')module.exports=api;root.FirmwareLabels=api;
})(typeof window!=='undefined'?window:globalThis);
