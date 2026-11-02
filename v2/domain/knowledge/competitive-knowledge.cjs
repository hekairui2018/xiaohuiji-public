'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const norm=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
const flag=s=>/^(?:√|✓|支持|有)$/.test(String(s).trim())?true:/^(?:×|✕|x|X|不支持|无)$/.test(String(s).trim())?false:null;
function scalar(parameter,value){
 if(/^(?:视频解码能力|视频硬解码)$/.test(parameter)){
  const v=String(value).trim().toUpperCase();return /^(?:4K|1080P|720P)$/.test(v)?{value:v==='4K'?2160:Number(v.slice(0,-1)),unit:'decode-height'}:null;
 }
 if(!/^(?:最大带载|带载能力|网口数量|输出网口)$/.test(parameter))return null;
 const m=/^(\d+(?:\.\d+)?)\s*(万)?\s*(像素点?|点|个|路)?$/.exec(String(value).trim());
 return m?{value:Number(m[1])*(m[2]?10000:1),unit:/网口/.test(parameter)?'ports':'pixels'}:null;
}
function advantages(data,model){
 const records=data.records||[],ours=records.filter(r=>r.kind==='comparison'&&r.brand==='灰度'&&norm(r.model)===norm(model)&&/对比/.test(r.sheet||''));
 const output=[];
 for(const row of ours){
  const peer=records.filter(r=>r.kind==='comparison'&&r.sheet===row.sheet&&r.parameter===row.parameter&&r.modelCell?.replace(/^[A-Z]+/,'')===row.modelCell?.replace(/^[A-Z]+/,'')&&r.parameterCell===row.parameterCell&&['诺瓦','卡莱特','凯视达','摩西尔'].includes(r.brand));
  // Missing, conditional and conflicting cells never establish an advantage.
  const key=row.parameter;
  if(ours.some(r=>r.parameter===key&&r.value!==row.value))continue;
  const unambiguous=peer.filter(p=>!peer.some(other=>other.brand===p.brand&&norm(other.model)===norm(p.model)&&other.value!==p.value));
  const ownFlag=flag(row.value),ownNumber=scalar(key,row.value);
  const better=ownFlag===true?unambiguous.some(p=>flag(p.value)===false):ownNumber&&unambiguous.some(p=>{const n=scalar(key,p.value);return n&&n.unit===ownNumber.unit&&ownNumber.value>n.value;});
  if(!better||output.some(r=>r.parameter===key)||key.length>24||String(row.value).length>44)continue;
  output.push({parameter:key,text:ownFlag===true?'支持'+key:key+' '+row.value});
 }
 const priority=['环路备份','低延迟','亮色度校正','多批次调节','最大带载','带载能力'];
 return output.sort((a,b)=>{const rank=x=>priority.includes(x.parameter)?priority.indexOf(x.parameter):99;return rank(a)-rank(b);}).slice(0,2);
}
function createCompetitiveKnowledge(file){
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(data.purpose!=='explicit-competitive-knowledge'||data.sources.length!==1)throw Error('Invalid competitive source scope');
 for(const source of data.sources){const sha=crypto.createHash('sha256').update(fs.readFileSync(source.path)).digest('hex');if(sha!==source.sha256||data.records.some(r=>r.sourceSha256!==sha))throw Error('Competitive source checksum mismatch');}
 const materials=require('./expert-materials.cjs').createExpertMaterials(file);
 return {materials,highlights:model=>advantages(data,model),counts:materials.counts};
}
module.exports={advantages,createCompetitiveKnowledge};
