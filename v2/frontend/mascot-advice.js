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
  return highlights?.length?{kind:'advantage',title:(exact.name||query)+' · 产品亮点',highlights:highlights.map(h=>h.text),message:(exact.name||query)+' 的对标亮点：'+highlights.map(h=>h.text).join('；')+'。',models:[],input:query}:null;
 }
 // Optional presentation hints: these never supply compatibility, diagnose faults or alter answers.
 function guide({event='search',query='',models=[],chip=false,previousModel=null,category='all'}={}){
  const q=String(query).normalize('NFKC').trim(),ask=(label,message)=>({label,type:'ask',message}),cat=(label,category,query='')=>({label,type:'category',category,query});
  const hint=(topic,message,actions)=>({kind:'guide',topic,title:'小灰机 · 下一步',message,actions});
  if(event==='firmware-download')return hint('upgrade','升级前先保存当前参数，并核对卡上丝印、硬件版本和芯片。升级后如需恢复，再用原模组和连屏配置。',[cat('找升级教程','video','升级'),ask('核对升级条件','升级前需要核对接收卡的哪些条件？')]);
  if(event==='module-config')return hint('module','同名模组也可能使用不同芯片或扫描方式，加载前先核对厂家、芯片和扫描数。',[ask('帮我核对配置','我要核对模组配置文件，需提供哪些厂家、芯片和扫描信息？')]);
  if(event==='ordered')return hint('ordered','配单结果有了，接下来可核对模组配置和连屏设置；连接图、BOM和配置文件各有用途。',[cat('找模组配置','module-config'),cat('看连屏教程','video','连屏')]);
  const tokens=q.toUpperCase().match(/(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9+_-]*/g)||[];
  const found=[...new Set(tokens.map(t=>models.find(m=>norm(m)===norm(t))).filter(Boolean))];
  if(tokens.length===1&&!found.length&&!chip){const correction=resolve(tokens[0],models);if(correction.candidates.length)return {...hint('model-correction','型号可能不完整或有拼写差异，你想找的是下面哪一款？',[]),models:correction.candidates};}
  if(found.length>=2)return hint('compare','要比较 '+found.slice(0,2).join(' 和 ')+' 吗？可以按资料核对带载、接口及播放方式的实际差异。',[ask('比较这两款','请对比 '+found.slice(0,2).join(' 和 ')+'，并列参数，指出有资料支持的主要差异。')]);
  if(chip)return hint('chip','芯片丝印和软件中的智能设置名称可能不同。固件还需结合接收卡型号和硬件版本核对。',[ask('核对芯片与卡型',q+' 芯片的智能设置名称是什么？请说明还需核对哪些接收卡信息。')]);
  if(category==='firmware'&&/^(?:HDPlayer|HDSet|HDShow|HD2016|HD2020|HD2018|HDSign)$/i.test(q))return hint('category','你搜的是软件名称，当前在固件分类里。要切到软件查找吗？',[cat('去软件分类','software',q)]);
  const fault=/黑屏|花屏|闪屏|全蓝|死机|无法连接|连不上|blue screen|black screen|flicker|garbled|not connecting/i.test(q),operation=/升级|固件|调试|发节目|软件|upgrade|firmware|software|setup/i.test(q);
  if(!tokens.length&&previousModel&&(fault||operation))return hint('context','是刚才查看的 '+previousModel+' 吗？确认后才会把这个型号带入问题。',[{label:'是，沿用 '+previousModel,type:'confirm-model',model:previousModel,message:previousModel+'：'+q},ask('不是，另一个设备',q+'（另一台设备，型号待确认）')]);
  if(fault)return hint('fault','这是故障现象。它是升级后出现，还是刚安装就这样？带上发生时机，更容易找到适用的处理步骤。',[ask('升级后出现',q+'；故障在升级后出现，请按适用资料排查。'),ask('刚安装就出现',q+'；刚安装就出现，请按适用资料排查。')]);
  if(/带载|分辨率|像素|\bP\s*\d.*(?:米|宽|高|块)|(?:宽|高).*\d|resolution|pixel load|screen size/i.test(q))return hint('sizing','除了总像素，还需要核对宽高限制和网口分配，可以把已知条件交给配单计算。',[ask('带着这些条件配单','请根据这些条件配单：'+q)]);
  if(found.length===1)return hint('device','准备调屏、发节目，还是先看资料？选一个，我帮你带上 '+found[0]+'。',[ask('调屏指导',found[0]+' 怎么调屏？请提供适用的操作步骤和教程。'),ask('发节目',found[0]+' 怎样发送节目？请核对适用软件和步骤。'),cat('查看说明书','manual',found[0])]);
  return null;
 }
 return {plan,resolve,guide};
});
