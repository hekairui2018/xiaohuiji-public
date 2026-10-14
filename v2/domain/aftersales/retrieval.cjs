'use strict';
const {modelId}=require('../identity/model-id.cjs');
// Vocabulary normalization only, not fault conclusions. Evidence remains per case.
const vocabulary=[['black_screen',['黑屏','不亮','无显示']],['dark_level',['黑电平','灰阶','暗部','不够纯黑']],['flicker',['闪烁','闪屏','频闪']],['moire',['水波纹','摩尔纹','拍照波纹']],['color',['偏色','颜色不对']],['garbled',['花屏','乱码']],['network',['连不上','掉线','断网','无法连接']],['horizontal_line',['横线','横条']],['vertical_line',['竖线','竖条']],['cloud',['云平台','云端','小灰云']]];
function faultTags(text){return vocabulary.filter(([,words])=>words.some(w=>text.includes(w))).map(([id])=>id);}
function tokens(text){return new Set((text.toLowerCase().match(/[a-z][a-z0-9.+_-]*|[\u4e00-\u9fff]{2}/g)||[]));}
const prepared=new WeakMap();
function retrieve(demand,cases){
 const text=(demand.symptoms||[]).join(' '),tags=faultTags(text),words=tokens(text),models=(demand.providedDevices||[]).map(d=>modelId(d.modelId)).filter(Boolean);
 const wifiDiscovery=s=>/wi-?fi|ssid/i.test(s)&&/搜不到|搜索不到|找不到|无法搜索|不广播|名称.*不显示/i.test(s);
 const discoveryOnly=wifiDiscovery(text);
 const ranked=[];
 for(const c of cases){
  if(!c.sourceReference||c.recordType!=='case')continue;
  if(discoveryOnly&&!wifiDiscovery(c.phenomenon))continue;
  if(models.length&&c.modelIds.length&&!c.modelIds.some(id=>models.includes(id)))continue;
  if(!prepared.has(c)){const corpus=c.phenomenon+' '+c.terms.join(' ');prepared.set(c,{caseTags:faultTags(corpus),caseWords:tokens(corpus)});}
  const {caseTags,caseWords}=prepared.get(c);
  if(tags.length&&caseTags.length&&!tags.some(t=>caseTags.includes(t)))continue;
  const common=[...words].filter(w=>caseWords.has(w));
  const exact=text.trim().length>=6&&c.phenomenon.includes(text.trim());
  const matchedTags=tags.filter(t=>caseTags.includes(t));
  if(!exact&&!matchedTags.length&&common.length<2)continue;
  const score=(exact?100:0)+matchedTags.length*15+common.length+(models.some(m=>c.modelIds.includes(m))?30:0);
  ranked.push({case:c,score,evidence:{exactCustomerPhrase:exact,matchedTags,matchedTokens:common,matchedModels:models.filter(m=>c.modelIds.includes(m))}});
 }
 ranked.sort((a,b)=>b.score-a.score||a.case.stableId.localeCompare(b.case.stableId));
 const seen=new Set();return ranked.filter(r=>{if(seen.has(r.case.duplicateGroup))return false;seen.add(r.case.duplicateGroup);return true;});
}
module.exports={retrieve,faultTags};
