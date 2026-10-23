'use strict';
// Arithmetic facts and planning preferences have separate provenance. Catalogue
// hypotheses never become customer-confirmed module or firmware properties.
function planningPreference(text){
 const value=String(text).trim();
 const unknown=/(?:不知道|不清楚|不懂|不记得|不确定|没有|没带|没|不知).{0,8}(?:模组|规格|扫描|接口)|(?:模组|规格|扫描|接口).{0,8}(?:不知道|不清楚|不懂|不记得|不确定)/.test(value);
 const requested=/(?:按|用|采用|选|照).{0,10}(?:常规|常见|标准|默认|推荐|暂定|候选|当前方案)|(?:你|帮我|直接).{0,8}(?:推荐|选模组|配就行|先配)|先.{0,6}(?:估算|出方案|出清单)/.test(value);
 const reject=/(?:不要|不按|不用|不能|不允许|取消).{0,8}(?:默认|常规|假设|暂定|候选)/.test(value);
 return {related:unknown||requested||reject,useCatalog:reject?false:unknown||requested?true:null,quote:value};
}
function inferModuleGeometry(input={}){
 const module=structuredClone(input),derived=[],conflicts=[];
 const put=(key,value,inputs)=>{if(!Number.isFinite(value)||value<=0)return;if(module[key]!==undefined){if(Math.abs(module[key]-value)>1e-6)conflicts.push(key);return;}module[key]=value;derived.push({field:'/module/'+key,value,basis:'pitch-mm-times-pixels',inputs});};
 for(const suffix of ['Width','Height']){
  const px='pixel'+suffix,mm='physical'+suffix+'Mm';
  if(module[px]&&module[mm])put('pitchMm',module[mm]/module[px],[px,mm]);
 }
 for(const suffix of ['Width','Height']){
  const px='pixel'+suffix,mm='physical'+suffix+'Mm';
  if(module.pitchMm&&module[px])put(mm,module.pitchMm*module[px],['pitchMm',px]);
  if(module.pitchMm&&module[mm]){const value=module[mm]/module.pitchMm;if(Number.isInteger(value))put(px,value,['pitchMm',mm]);else conflicts.push(px);}
 }
 return {module,derived,conflicts:[...new Set(conflicts)]};
}
module.exports={planningPreference,inferModuleGeometry};
