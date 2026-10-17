'use strict';
const {DOC_CATEGORIES,classifyDocModel}=require('../../../backend/doc-category.cjs');
const CATEGORIES=[{key:'software-cloud',label:'软件 · APP · 云平台'},{key:'lcd',label:'LCD 商显 · 安卓主板'},...DOC_CATEGORIES.filter(g=>g.key!=='other'),{key:'training',label:'基础知识 · 培训'},{key:'projects',label:'项目方案 · 产品演示'},{key:'other',label:'通用资料 · 分类待核对'}];
const software=/HD\s*(?:Set|Player|Show|Sign|2018|2020)|云平台|小灰云|屏掌控|Cloud|APP|软件安装|软件下载/i;
function classifyResource({name='',folders=[],model='',metadata=''}={}){
 const folderText=folders.join(' / '),reasons=[],related=new Set();
 const lcd=/LCD|液晶|商显|Huidu\s*OS|MagicPlayer/i.test(name)||/LCD|液晶|商显/i.test(folderText);
 if(lcd)related.add('lcd');
 let key;
 if(software.test(name)){key='software-cloud';reasons.push('software-or-platform-label');}
 else if(/接收卡|视频处理器|处理器|发送卡|发送盒|单双色|单色|配件|传感器/.test(name)){key=/接收卡/.test(name)?'receiver':/处理器/.test(name)?'processor':/发送卡|发送盒/.test(name)?'sender':/单双色|单色/.test(name)?'mono':'accessory';reasons.push('explicit-product-category-title');}
 else if(lcd){key='lcd';reasons.push('lcd-title-or-folder');}
 else if(/宣传|展厅|展览|应用案例|解决方案/.test(name)||/宣传|解决方案/.test(folderText)){key='projects';reasons.push('project-or-demonstration-label');}
 else if(/基础知识|产品知识|入职培训/.test(name)||/入职培训/.test(folderText)){key='training';reasons.push('training-label');}
 else {
  const tokens=model?[model]:(name.match(/(?:HD[-_ ]?)?(?:VPX|VP|KV|VS|RB|RP|R|C|A|B|H|T|WF|W|D|MS|VM|DCS|K)\d+[A-Z0-9]*(?:-[A-Z0-9]+)*/ig)||[]);
  const keys=[...new Set(tokens.map(m=>classifyDocModel(m,metadata)).filter(k=>k!=='other'))];
  if(keys.length===1){key=keys[0];reasons.push(model?'product-metadata':'exact-model-token');}
  else if(keys.length>1){key='other';keys.forEach(k=>related.add(k));reasons.push('multiple-product-categories');}
  else {const hints=[['software-cloud',software],['receiver',/接收卡/],['processor',/视频处理器|拼接器/],['sender',/发送卡|发送盒/],['mono',/单双色|单色|门头/],['player',/异步全彩|异步播放|播放盒/],['board',/控制板/],['accessory',/配件|中控|传感器接线/]];key=hints.find(([,re])=>re.test(folderText))?.[0]||'other';reasons.push(key==='other'?'insufficient-category-evidence':'source-folder-label');}
 }
 return {categoryKey:key,categoryLabel:CATEGORIES.find(c=>c.key===key)?.label||key,relatedCategoryKeys:[...related].filter(k=>k!==key),categoryBasis:reasons};
}
function groupVideos(videos,resources=[]){
 const byName=new Map();for(const r of resources){if(!byName.has(r.name))byName.set(r.name,[]);byName.get(r.name).push(r);}
 const groups=new Map(),seen=new Map();
 for(const v of videos){
  const copies=byName.get(v.name)||[],folders=[...new Set(copies.flatMap(r=>r.folders||[]))];
  const info=classifyResource({name:v.name,folders});
  const identity=v.sha256?'sha256:'+v.sha256:v.url?.startsWith('/')?'url:'+v.url:'name:'+v.name;
  if(seen.has(identity)){const previous=seen.get(identity);previous.alternativeNames=[...new Set([...(previous.alternativeNames||[]),v.name])];continue;}
  const language=/中英|双语/.test(v.name)?'bilingual':/英文|英语|English|[-_（(]英(?:[)）.]|$)|(?:^|[\s_.(-])ENG?(?:[\s_.)-]|$)/i.test(v.name)?'en':/中文|国语|简中|（中）|\(中\)| - 中/.test(v.name)?'zh':'unknown';
  const operationName=v.name.replace(/\.(mp4|webm|mov)$/i,'');
  const item={...v,...info,operationName,language,languageLabel:{bilingual:'中英双语',en:'英文',zh:'中文',unknown:'语言未确认'}[language]};seen.set(identity,item);
  if(!groups.has(info.categoryKey))groups.set(info.categoryKey,{key:info.categoryKey,label:info.categoryLabel,videos:[]});groups.get(info.categoryKey).videos.push(item);
 }
 return CATEGORIES.filter(c=>groups.has(c.key)).map(c=>{const g=groups.get(c.key);g.videos.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans-CN',{numeric:true}));return {...g,count:g.videos.length};});
}
module.exports={CATEGORIES,classifyResource,groupVideos};
