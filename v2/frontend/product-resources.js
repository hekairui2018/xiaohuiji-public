/* Presentation of product resources. Categories and version decisions belong to the API. */
(() => {
 'use strict';
 const labels={spec:'规格书',manual:'使用说明',software:'软件工具',firmware:'固件',video:'视频',other:'其他资料',pending:'待确认'};
 const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const valid=url=>typeof url==='string'&&(/^(https?:\/\/)/i.test(url)||/^\/[^/]/.test(url));
 const stable=item=>item.sha256?'sha256:'+item.sha256:item.resourceVersionId?'version:'+item.resourceVersionId:valid(item.url)?'url:'+item.url:null;
 // Never deduplicate by filename or by a resource ID that could span versions.
 function identityKey(item){const identity=stable(item);return identity&&JSON.stringify([identity,item.documentVersion,item.documentLanguage,item.documentEdition,item.versionBasis,item.versionSelection,item.associationStatus,item.resourceOnly,item.verificationStatus,item.available,item.scopeEvidence]);}
 function unique(items){const seen=new Map(),out=[];for(const item of items){const key=identityKey(item);if(key&&seen.has(key)){const previous=seen.get(key);previous.applicableModels=[...new Set([...(previous.applicableModels||[]),...(item.applicableModels||[])])];continue;}const copy={...item};out.push(copy);if(key)seen.set(key,copy);}return out;}
 function groups(product){const source=Array.isArray(product.docGroups)&&product.docGroups.length?product.docGroups:[...(product.specGroups||[]),...(product.firmwareGroup?[product.firmwareGroup]:[])];const map=new Map();for(const group of source){if(!group||!Array.isArray(group.items))continue;const key=String(group.key||'');if(!map.has(key))map.set(key,{key,label:labels[key]||group.label||'未标注类别',items:[]});map.get(key).items.push(...group.items);}return [...map.values()].map(group=>({...group,items:unique(group.items)})).filter(group=>group.items.length);}

 function previewTarget(item){
  const name=item.originalName||item.name||'',url=item.url;
  const supported=/\.(pdf|docx?|pptx?|xlsx?|csv|txt|md)$/i.test(name);
  if(item.available===false||!valid(url))return {url:null,reason:item.unavailableMessage||'原件暂不可用'};
  if(!supported)return {url:null,reason:'此格式暂不支持在线预览，请点击右侧下载原文件。'};
  if(/\/v2\/offline\/file\?/.test(url))return {url:url.replace('/v2/offline/file?','/v2/offline/preview?').replace(/([?&])download=1(&|$)/,'$1').replace(/[?&]$/,''),reason:null};
  if(!/\.pdf$/i.test(name)&&!/[\/]v2[\/]offline[\/]preview\?/.test(url))return {url:null,reason:'此文件尚未提供可用在线预览，请点击右侧下载原文件。'};
  return {url,reason:null};
 }
 function downloadTarget(item){
  const url=item.downloadUrl||item.url;
  if(item.available===false||!valid(url))return null;
  if(/\/v2\/offline\/(?:preview|file)\?/.test(url)){
   const file=url.replace('/v2/offline/preview?','/v2/offline/file?');
   return /[?&]download=1(?:&|$)/.test(file)?file:file+(file.includes('?')?'&':'?')+'download=1';
  }
  return url;
 }
 function badge(parent,text,warning=false){const node=el('span',text);node.className='pr-badge'+(warning?' pr-warning':'');parent.append(node);}
 function row(item,group){
  const root=el('article');root.className='pr-resource';
  const title=el('strong',item.name||item.originalName||item.clean||'未命名资料');title.className='pr-file-name';root.append(title);
  const meta=el('div');meta.className='pr-meta';badge(meta,group.label);
  if(item.documentDate)badge(meta,'原文日期 '+item.documentDate);
  if(item.documentVersion)badge(meta,'版本 '+item.documentVersion);
  const conflict=item.versionBasis==='filename-cover-version-conflict';
  if(conflict)badge(meta,'版本冲突，需核对',true);
  if(item.documentLanguage)badge(meta,({zh:'中文','unspecified-or-en':'英文 / 未明确'}[item.documentLanguage]||item.documentLanguage));
  if(item.documentEdition)badge(meta,({standard:'普通版',neutral:'中性版'}[item.documentEdition]||item.documentEdition));
  root.append(meta);
  const scope=el('p');scope.className='pr-scope';scope.textContent=Array.isArray(item.applicableModels)&&item.applicableModels.length?'原文标明型号：'+item.applicableModels.join('、')+'':'适用型号未确认';if(item.applicableModels?.length)root.append(scope);
  if(item.scopeEvidence?.length){const details=el('details'),summary=el('summary','适用条件依据');details.className='pr-evidence';details.append(summary);for(const evidence of item.scopeEvidence){const line=el('p');line.textContent=typeof evidence==='string'?evidence:JSON.stringify(evidence);details.append(line);}root.append(details);}
  const actions=el('div');actions.className='pr-actions';
  function link(url,text,download){if(!valid(url))return;const a=el('a',text);a.href=url;a.rel='noopener noreferrer';a.title=text+' '+(item.originalName||item.name||'');a.setAttribute('aria-label',a.title);if(download)a.download=item.originalName||item.name||'';else a.target='_blank';actions.append(a);}
  if(item.available!==false){const preview=previewTarget(item);if(preview.url)link(preview.url,'在线预览');else {const button=el('button','在线预览');button.type='button';button.title=preview.reason;button.setAttribute('aria-label','预览 '+(item.name||'资料')+'：'+preview.reason);button.onclick=()=>window.alert(preview.reason);actions.append(button);}link(downloadTarget(item),'下载原件',true);}
  if(item.available===false||(!valid(item.url)&&!valid(item.downloadUrl)))actions.append(el('span',item.unavailableMessage||'原件暂不可用，请核对来源'));
  root.append(actions);root.dataset.search=[item.name,item.clean,item.documentVersion,...(item.applicableModels||[])].filter(Boolean).join(' ').toLocaleLowerCase();return root;
 }
 const historyCache=new Map();
 async function history(cat){if(historyCache.has(cat))return historyCache.get(cat);const request=(async()=>{const response=await fetch('/api/docs?cat='+encodeURIComponent(cat)+'&history=all');const data=await response.json();if(!response.ok||data.error)throw Error(typeof data.error==='string'?data.error:'历史资料读取失败');if(data.docs?.includeHistory!==true)throw Error('当前接口未启用历史版本返回，请后端确认 history=1 的处理。');return data.docs;})();historyCache.set(cat,request);try{return await request;}catch(error){historyCache.delete(cat);throw error;}}
 function render(product,sourceGroups){
  const root=el('section');root.className='pr-panel';root.setAttribute('aria-label',product.name+'产品资料');
  const heading=el('div');heading.className='pr-heading';heading.append(el('h4','相关资料'));
  const input=el('input');input.type='search';input.placeholder='在该产品资料中筛选';input.setAttribute('aria-label',product.name+'资料筛选');heading.append(input);root.append(heading);
  const navigation=el('div');navigation.className='pr-navigation';navigation.setAttribute('role','group');navigation.setAttribute('aria-label','产品资料类别');root.append(navigation);
  const sections=[];const empty=el('p','没有匹配的资料，请缩短关键词或切换类别。');empty.className='pr-empty';empty.hidden=true;let selected='all';
  function filter(){const term=input.value.trim().toLocaleLowerCase();let total=0;for(const record of sections){let count=0;for(const node of record.rows){node.hidden=!!term&&!node.dataset.search.includes(term);if(!node.hidden)count++;}record.section.hidden=!count||(selected!=='all'&&selected!==record.key);if(!record.section.hidden){total+=count;if(term||selected!=='all')record.section.open=true;}}empty.hidden=total>0;}
  function tab(key,label){const button=el('button',label);button.type='button';button.setAttribute('aria-pressed',String(key===selected));button.onclick=()=>{selected=key;navigation.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));filter();};navigation.append(button);}
  tab('all','全部 '+sourceGroups.reduce((sum,g)=>sum+g.items.length,0));
  for(const group of sourceGroups){tab(group.key,group.label+' '+group.items.length);const section=el('details');section.className='pr-group';section.open=['spec','manual'].includes(group.key)||sourceGroups.length===1;const summary=el('summary',group.label+' · '+group.items.length+' 份');section.append(summary);const body=el('div');body.className='pr-group-body';const record={section,key:group.key,rows:[]};
   if(group.key==='pending')body.append(el('p','以下资料由后端标为待确认，不能视为已确认适用。'));
   if(group.key==='firmware')body.append(el('p','下载前核对设备、硬件版本、芯片及固件适用条件。'));
   const preferred=group.items.filter(item=>item.versionSelection==='latest-in-explicit-document-family'&&item.versionBasis!=='filename-cover-version-conflict'&&!item.resourceOnly);const remaining=group.items.filter(item=>!preferred.includes(item));
   for(const item of [...preferred,...remaining]){const node=row(item,group);record.rows.push(node);body.append(node);}
   if(['spec','manual'].includes(group.key)){const versions=el('details');versions.className='pr-history';versions.append(el('summary','历史版本与其他记录'));const content=el('div');versions.append(content);let loaded=false;
    versions.addEventListener('toggle',async()=>{if(!versions.open||loaded)return;loaded=true;content.replaceChildren(el('p','读取历史版本…'));try{const docs=await history(group.key);const matches=(docs.groups||[]).flatMap(g=>g.products||[]).filter(p=>p.model===product.name);const identities=new Set(group.items.map(identityKey).filter(Boolean));const extra=unique(matches.flatMap(p=>p.items||[])).filter(item=>!identityKey(item)||!identities.has(identityKey(item)));content.replaceChildren();if(!extra.length)content.append(el('p',matches.length?'后端未返回该产品的额外历史记录。':'历史目录未返回该产品的精确关联，请后端核对。'));for(const item of extra){const node=row(item,group);record.rows.push(node);content.append(node);}filter();}catch(error){loaded=false;content.replaceChildren(el('p',error.message));const retry=el('button','重试');retry.type='button';retry.onclick=()=>{versions.open=false;setTimeout(()=>versions.open=true,0);};content.append(retry);}});body.append(versions);
   }
   section.append(body);root.append(section);sections.push(record);
  }
  root.append(empty);input.oninput=filter;return root;
 }

 // Language pairing affects layout only; it never merges files or version families.
 function documentRows(items){
  const chinese=d=>{
   const qualifier=d.displayQualifier||d.clean||'';
   if(/(?:^|\/)\s*英文\s*$/.test(qualifier)||d.documentLanguage==='en')return false;
   if(/(?:^|\/)\s*中文\s*$/.test(qualifier)||d.documentLanguage==='zh')return true;
   return /[\u4e00-\u9fff]/.test(d.name||'');
  };
  const families=[
   ['cube',/立方屏APP|LED cube APP/i],
   ['screen-lcd',/屏掌控.*LCD|Screen Control.*LCD Version/i],
   ['screen-full',/屏掌控标准版.*全彩|Screen Control Standard Edition.*Full Color/i],
   ['screen-mono',/屏掌控单色版|Screen control monochrome version/i],
   ['cloud-lcd',/小灰云.*LCD|LCD display information management platform/i],
   ['cloud-led',/小灰云.*LED|LED display information management platform/i]
  ];
  const keys=new Map();
  for(const item of items){const family=families.find(([,pattern])=>pattern.test(item.name||''));const version=(item.name||'').match(/V(\d+(?:\.\d+)+)/i)?.[1];if(family&&version&&item.versionStatus!=='conflict')keys.set(item,family[0]+'|'+version);
   const named=(item.name||'').match(/^(?:HD[-_ ]?)?([A-Za-z]+\d+[A-Za-z0-9-]*(?:\s+(?:Pro|Plus))?(?:\s*[、,，&/+]\s*(?:HD[-_ ]?)?[A-Za-z]+\d+[A-Za-z0-9-]*)*)\s*(规格书|Specifications?|使用说明书|使用说明|用户手册|User\s+man(?:ual|aual))/i);
   if(named&&version&&item.versionStatus!=='conflict')keys.set(item,'model:'+named[1].replace(/\s/g,'').replace(/[、，&/+]/g,',').toUpperCase()+'|'+(/规格|spec/i.test(named[2])?'spec':'manual')+'|'+version);}
  const used=new Set(),rows=[];
  for(const item of [...items.filter(chinese),...items.filter(d=>!chinese(d))]){
   if(used.has(item))continue;used.add(item);let partner=null;
   if(keys.has(item)){const matches=items.filter(d=>!used.has(d)&&keys.get(d)===keys.get(item)&&chinese(d)!==chinese(item));if(matches.length===1)partner=matches[0];}
   else if(items.length===2&&!items.some(d=>d.versionStatus==='conflict'||families.some(([,pattern])=>pattern.test(d.name||'')))&&chinese(items[0])!==chinese(items[1]))partner=items.find(d=>d!==item&&!used.has(d));
   if(partner)used.add(partner);rows.push(chinese(item)?{zh:item,other:partner}:{zh:partner,other:item});
  }
  const packed=rows.filter(pair=>pair.zh&&pair.other),singles=rows.filter(pair=>!pair.zh||!pair.other).map(pair=>pair.zh||pair.other);
  for(let i=0;i<singles.length;i+=2)packed.push({zh:singles[i],other:singles[i+1]||null});
  return packed;
 }
 window.ProductResources={groups,render,unique,row,documentRows,previewTarget,downloadTarget};
})();
