(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MascotAdvice=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const norm=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
 function plan({query,results=[],models=[],approximateMatch=null}){
  const key=norm(query);if(!/^[A-Z]{1,6}\d[A-Z0-9+_-]*$/.test(key))return null;
  const exact=results.find(r=>norm(r.modelId||r.name)===key);
  const candidates=[...new Map(models.map(m=>[norm(m),m])).values()].filter(m=>norm(m)!==key&&norm(m).startsWith(key)).sort((a,b)=>norm(a).length-norm(b).length).slice(0,3);
  if(approximateMatch)return {kind:'model',message:'未找到完全一致的型号，当前按 '+approximateMatch.selected+' 展示，请核对是否是你的设备。',models:[approximateMatch.selected],input:query};
  if(exact&&candidates.length)return {kind:'model',message:'你是不是想找 '+candidates.join(' / ')+'？当前仍保留 '+(exact.name||query)+' 的结果。',models:candidates,input:query};
  if(!exact&&candidates.length)return {kind:'model',message:'这些是相近型号：'+candidates.join(' / ')+'。请核对完整型号后选择。',models:candidates,input:query};
  const highlights=exact?.competitiveHighlights?.filter(h=>h&&typeof h.text==='string').slice(0,2);
  return highlights?.length?{kind:'advantage',message:(exact.name||query)+' 的对标亮点：'+highlights.map(h=>h.text).join('；')+'。',models:[],input:query}:null;
 }
 return {plan};
});
