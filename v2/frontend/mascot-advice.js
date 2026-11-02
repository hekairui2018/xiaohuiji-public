(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MascotAdvice=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const norm=s=>String(s||'').normalize('NFKC').trim().toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
 // One edit includes insertion, deletion, substitution and adjacent transposition.
 // Candidates must belong to the same alphabetic family. This never establishes compatibility.
 function oneEdit(a,b){
  if(a===b)return false;
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0;while(i<a.length&&a[i]===b[i])i++;
  if(a.length===b.length)return a.slice(i+1)===b.slice(i+1)||(a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2));
  return a.length>b.length?a.slice(i+1)===b.slice(i):a.slice(i)===b.slice(i+1);
 }
 function resolve(query,models,{resultModels=[]}={}){
  const key=norm(query),none={kind:'none',exact:false,candidates:[],autoSelect:null};
  if(!/^[A-Z]{1,6}\d[A-Z0-9+_-]*$/.test(key))return none;
  const catalogue=[...new Map(models.map(m=>[norm(m),m])).entries()];
  const exact=catalogue.some(([id])=>id===key)||resultModels.some(m=>norm(m)===key);
  const prefix=catalogue.filter(([id])=>id!==key&&id.startsWith(key)).sort((a,b)=>a[0].length-b[0].length);
  if(prefix.length)return {kind:exact?'exact-with-variants':'incomplete',exact,candidates:prefix.map(([,m])=>m).slice(0,3),autoSelect:!exact&&prefix.length===1&&key.length>=3?prefix[0][1]:null};
  if(exact)return {kind:'exact',exact:true,candidates:[],autoSelect:null};
  const family=key.match(/^[A-Z]+/)[0];
  const near=key.length>=3?catalogue.filter(([id])=>id.match(/^[A-Z]+/)?.[0]===family&&oneEdit(key,id)):[];
  return near.length?{kind:'possible-typo',exact:false,candidates:near.map(([,m])=>m).slice(0,3),autoSelect:near.length===1&&key.length>=5?near[0][1]:null}:none;
 }
 function plan({query,results=[],models=[],approximateMatch=null}){
  const key=norm(query);if(!/^[A-Z]{1,6}\d[A-Z0-9+_-]*$/.test(key))return null;
  const exact=results.find(r=>norm(r.modelId||r.name)===key);
  const resolution=resolve(query,models,{resultModels:results.map(r=>r.modelId||r.name)}),candidates=resolution.candidates;
  if(approximateMatch)return {kind:'model',message:'未找到完全一致的型号，当前按 '+approximateMatch.selected+' 展示，请核对是否是你的设备。',models:[approximateMatch.selected],input:query};
  if(exact&&candidates.length)return {kind:'model',message:'你是不是想找 '+candidates.join(' / ')+'？当前仍保留 '+(exact.name||query)+' 的结果。',models:candidates,input:query};
  if(!exact&&candidates.length)return {kind:'model',message:(resolution.kind==='possible-typo'?'型号可能有漏字、错字或顺序写反。':'型号可能没有输完整。')+'相近型号：'+candidates.join(' / ')+'，请核对后选择。',models:candidates,input:query};
  const highlights=exact?.competitiveHighlights?.filter(h=>h&&typeof h.text==='string').slice(0,2);
  return highlights?.length?{kind:'advantage',message:(exact.name||query)+' 的对标亮点：'+highlights.map(h=>h.text).join('；')+'。',models:[],input:query}:null;
 }
 return {plan,resolve};
});
