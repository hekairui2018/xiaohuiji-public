'use strict';
const {modelId}=require('../identity/model-id.cjs');
function guidance({family,dedicated,decoder,requested,evidence,files}){
 const facts=[],suffixes=evidence.suffixes.data.rows;
 if(!family||dedicated||decoder)return {facts,files:[]};
 const selected=suffixes.filter(r=>!requested.length||r.models.some(m=>requested.includes(modelId(m))));
 const receiverGroups=new Map();
 const receiverLines=selected.map(r=>{
  const codes=family==='common'?r.commonCodes||[]:[family];
  const names=r.models.map(m=>m+(r.variant&&r.variant!=='standard'?'（'+(r.variant==='custom'?'定制':r.variant)+'）':''));
  for(const code of codes){if(!receiverGroups.has(code))receiverGroups.set(code,new Set());for(const name of names)receiverGroups.get(code).add(name);}
  return codes.length?names.join('/')+'：'+codes.map(c=>c+'.'+r.suffix).join(' / '):null;
 }).filter(Boolean);
 const receiverText=requested.length?receiverLines.join('\n'):[...receiverGroups].sort(([a],[b])=>a.localeCompare(b)).map(([code,names])=>[...names].join('/')+'：'+code+'.xx').join('\n');
 if(receiverText)facts.push({label:'接收卡固件尾缀',text:receiverText,sourceReference:evidence.suffixes.sourceReference});
 const asyncGroups=new Map();
 for(const group of evidence.display.data.asyncFamilies.filter(g=>!requested.length||g.models.some(m=>requested.includes(modelId(m))))){const mapping=group.mappings[family];if(mapping?.status!=='confirmed'||mapping.suffix==null)continue;const code=String(mapping.suffix);if(!asyncGroups.has(code))asyncGroups.set(code,new Set());for(const name of group.models)asyncGroups.get(code).add(name);}
 const asyncLines=[...asyncGroups].map(([code,names])=>[...names].join('/')+'：'+code);
 if(asyncLines.length)facts.push({label:'异步卡固件尾缀',text:asyncLines.join('\n'),sourceReference:evidence.display.sourceReference});
 const matched=files.filter(f=>{
  if(!f.publicUrl?.startsWith('/v2/curated-firmware/'))return false;
  const parsed=String(f.file||f.name).match(/_FPGA_V\d+\.\d+\.(\d+)\.(\d+)(?:_|\.)/i);
  if(!parsed)return false;
  return selected.some(r=>r.models.some(m=>(f.models||[f.card]).some(v=>modelId(v)===modelId(m)))&&String(r.suffix)===parsed[2]&&(family==='common'?(r.commonCodes||[]).includes(parsed[1]):parsed[1]===family));
 });
 return {facts,files:matched};
}
module.exports={guidance};
