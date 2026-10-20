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
 function badge(parent,text,warning=false){const node=el('span',text);node.className='pr-badge'+(warning?' pr-warning':'');parent.append(node);return node;}
 function icon(kind){
  const paths={file:'M8 3H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4H8m4 0v4h4M7 11h6M7 14h4',preview:'M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5m11 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',download:'M10 3v9m-3-3 3 3 3-3M4 13v4h12v-4'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.4');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[kind]);svg.append(path);return svg;
 }
 function fileActions(item,{compact=true}={}){
  const actions=el('div');actions.className='pr-actions';
  function link(url,text,download){if(!valid(url))return;const a=el('a',compact?undefined:text);if(compact)a.append(icon(download?'download':'preview'));a.href=url;a.rel='noopener noreferrer';a.title=text+' '+(item.originalName||item.name||'');a.setAttribute('aria-label',a.title);if(download)a.download=item.originalName||item.name||'';else a.target='_blank';actions.append(a);}
  if(item.available!==false){const preview=previewTarget(item);if(preview.url)link(preview.url,'在线预览');else {const button=el('button',compact?undefined:'在线预览');if(compact)button.append(icon('preview'));button.type='button';button.title=preview.reason;button.setAttribute('aria-label','预览 '+(item.name||'资料')+'：'+preview.reason);button.onclick=()=>window.alert(preview.reason);actions.append(button);}link(downloadTarget(item),'下载原件',true);}
  if(item.available===false||(!valid(item.url)&&!valid(item.downloadUrl)))actions.append(el('span',item.unavailableMessage||'原件暂不可用，请核对来源'));
  return actions;
 }
 function row(item,group,{compact=true}={}){
  const root=el('article');root.className='pr-resource'+(compact?' pr-resource-compact':'');if(compact){const mark=icon('file');mark.classList.add('pr-file-icon');root.append(mark);}
  const title=el('strong',item.name||item.originalName||item.clean||'未命名资料');title.className='pr-file-name';title.title=title.textContent;root.append(title);
  const meta=el('div');meta.className='pr-meta';badge(meta,group.label).classList.add('pr-category');
  if(item.documentDate)badge(meta,'原文日期 '+item.documentDate);
  // Firmware filename already carries its version; avoid a repeated subtitle.
  if(item.documentVersion&&group.key!=='firmware')badge(meta,'版本 '+item.documentVersion);
  if(group.key==='firmware'&&item.sameNameDifferentContent)badge(meta,'同名异内容 · '+String(item.sha256||'未知身份').slice(0,8),true);
  const conflict=item.versionBasis==='filename-cover-version-conflict';
  if(conflict)badge(meta,'版本冲突，需核对',true);
  if(item.documentLanguage)badge(meta,({zh:'中文','unspecified-or-en':'英文 / 未明确'}[item.documentLanguage]||item.documentLanguage));
  if(item.documentEdition)badge(meta,({standard:'普通版',neutral:'中性版'}[item.documentEdition]||item.documentEdition)).classList.add('pr-edition-'+item.documentEdition);
  root.append(meta);
  const scope=el('p');scope.className='pr-scope';
  // A browse association is not a verified compatibility claim.
  if(group.key==='firmware'){
   const approved=Array.isArray(item.applicableModels)?item.applicableModels:[];
   const associated=Array.isArray(item.associatedModels)?item.associatedModels:[];
   scope.textContent=approved.length?'原文标明型号：'+approved.join('、')+'（仍需核对硬件条件）':associated.length?'关联型号：'+associated.map(x=>x.replace(/^HD-/i,'')).join('、')+' · 适用性待核对':'适用型号待核对';
   root.append(scope);
  }else{
   scope.textContent=Array.isArray(item.applicableModels)&&item.applicableModels.length?'原文标明型号：'+item.applicableModels.join('、')+'':'适用型号未确认';
   if(item.applicableModels?.length)root.append(scope);
  }
  if(item.scopeEvidence?.length){const details=el('details'),summary=el('summary','适用条件依据');details.className='pr-evidence';details.append(summary);for(const evidence of item.scopeEvidence){const line=el('p');line.textContent=typeof evidence==='string'?evidence:JSON.stringify(evidence);details.append(line);}root.append(details);}
  const actions=fileActions(item,{compact});
  root.append(actions);root.dataset.search=[item.name,item.clean,item.documentVersion,...(item.applicableModels||[])].filter(Boolean).join(' ').toLocaleLowerCase();return root;
 }
 const historyCache=new Map();
 async function history(cat){if(historyCache.has(cat))return historyCache.get(cat);const request=(async()=>{const response=await fetch('/api/docs?cat='+encodeURIComponent(cat)+'&history=all');const data=await response.json();if(!response.ok||data.error)throw Error(typeof data.error==='string'?data.error:'历史资料读取失败');if(data.docs?.includeHistory!==true)throw Error('当前接口未启用历史版本返回，请后端确认 history=1 的处理。');return data.docs;})();historyCache.set(cat,request);try{return await request;}catch(error){historyCache.delete(cat);throw error;}}
 function render(product,sourceGroups,{collapsible=false,compact=false}={}){
  if(compact)collapsible=false;
  const primaryKeys=['spec','manual','firmware'];
  const root=el(collapsible?'details':'section');root.className='pr-panel'+(collapsible?' pr-panel-collapsible':'')+(compact?' pr-panel-compact':'');root.setAttribute('aria-label',product.name+'产品资料');
  const content=compact||collapsible?el('div'):root;if(compact)content.className='pr-primary-groups';else if(collapsible)content.className='pr-content';
  const heading=el(collapsible?'summary':'div');heading.className='pr-heading';heading.append(el('h4','相关资料'));
  if(collapsible){const count=el('span','· '+sourceGroups.reduce((n,g)=>n+g.items.length,0)+' 份');count.className='pr-total';heading.append(count);}
  const input=el('input');input.type='search';input.placeholder=compact?'搜索规格书、说明书、固件':'在该产品资料中筛选';input.setAttribute('aria-label',product.name+'资料筛选');root.append(heading);
  const navigation=el('div');navigation.className='pr-navigation';navigation.setAttribute('role','group');navigation.setAttribute('aria-label','产品资料类别');
  const other=compact?el('details'):null,otherInput=compact?el('input'):null,otherEmpty=el('p','没有匹配的其他资料。');otherEmpty.className='pr-empty';otherEmpty.hidden=true;
  if(compact){
   heading.append(input);root.append(navigation,content);
   other.className='pr-other-resources';other.dataset.resourceScope='other';const extra=sourceGroups.filter(g=>!primaryKeys.includes(g.key));
   if(extra.length){other.append(el('summary','其他资料 · '+extra.reduce((n,g)=>n+g.items.length,0)+' 份'));otherInput.type='search';otherInput.placeholder='在其他资料中搜索';otherInput.setAttribute('aria-label',product.name+'其他资料筛选');const tools=el('div');tools.className='pr-tools';tools.append(otherInput);other.append(tools);root.append(other);}
  }else if(collapsible){const tools=el('div');tools.className='pr-tools';tools.append(input);content.append(tools,navigation);root.append(content);}else {heading.append(input);content.append(navigation);}
  const sections=[],empty=el('p','没有匹配的资料，请缩短关键词或切换类别。');empty.className='pr-empty';empty.hidden=true;
  let selected=compact?(primaryKeys.find(key=>sourceGroups.some(g=>g.key===key&&g.items.length))||'spec'):'all';
  function filter(){let total=0,others=0;for(const record of sections){const auxiliary=compact&&!primaryKeys.includes(record.key),term=(auxiliary?otherInput.value:input.value).trim().toLocaleLowerCase();let count=0;
   for(const node of record.rows){node.hidden=!!term&&!node.dataset.search.includes(term);if(!node.hidden)count++;}
   record.section.hidden=!count||(!auxiliary&&selected!=='all'&&selected!==record.key);
   if(!record.section.hidden){if(auxiliary)others+=count;else total+=count;if(term||selected!=='all')record.section.open=true;}
  }empty.hidden=total>0;otherEmpty.hidden=others>0;}
  function tab(key,label,disabled=false){const button=el('button',label);button.type='button';button.dataset.category=key;button.disabled=disabled;button.setAttribute('aria-pressed',String(key===selected));button.onclick=()=>{selected=key;navigation.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));filter();};navigation.append(button);}
  if(compact)for(const key of primaryKeys){const count=sourceGroups.filter(g=>g.key===key).reduce((n,g)=>n+g.items.length,0);tab(key,({spec:'规格书',manual:'说明书',firmware:'固件'}[key])+' '+count,!count);}
  else tab('all','全部 '+sourceGroups.reduce((sum,g)=>sum+g.items.length,0));
  for(const group of sourceGroups){
   if(!compact)tab(group.key,group.label+' '+group.items.length);
   const primary=compact&&primaryKeys.includes(group.key),section=el(primary?'section':'details');section.className='pr-group';section.open=['spec','manual'].includes(group.key)||sourceGroups.length===1;
   if(!primary)section.append(el('summary',group.label+' · '+group.items.length+' 份'));
   const body=el('div');body.className='pr-group-body';const record={section,key:group.key,rows:[],entries:[]};
   if(group.key==='pending')body.append(el('p','以下资料由后端标为待确认，不能视为已确认适用。'));
   if(group.key==='firmware')body.append(el('p','下载前核对设备、硬件版本、芯片及固件适用条件。'));
   const preferred=group.items.filter(item=>item.versionSelection==='latest-in-explicit-document-family'&&item.versionBasis!=='filename-cover-version-conflict'&&!item.resourceOnly),remaining=group.items.filter(item=>!preferred.includes(item));
   for(const item of [...preferred,...remaining]){const node=row(item,group,{compact});record.rows.push(node);record.entries.push({item,node});body.append(node);}
   if(primary){
    const files=el('div');files.className='pr-current-files';
    for(const pair of documentRows(record.entries.map(e=>e.item))){const items=[pair.zh,pair.other].filter(Boolean),cells=el('div');cells.className='pr-featured-pair'+(items.length===1?' pr-featured-single':'');for(const item of items)cells.append(record.entries.find(e=>e.item===item).node);files.append(cells);}
    body.append(files);
   }
   if(['spec','manual'].includes(group.key)){const versions=el('details');versions.className='pr-history';versions.append(el('summary','历史版本与适用条件'));const historyContent=el('div');versions.append(historyContent);let loaded=false;
    versions.addEventListener('toggle',async()=>{if(!versions.open||loaded)return;loaded=true;historyContent.replaceChildren(el('p','读取历史版本…'));try{const docs=await history(group.key);const matches=(docs.groups||[]).flatMap(g=>g.products||[]).filter(p=>p.model===product.name),identities=new Set(group.items.map(identityKey).filter(Boolean)),extra=unique(matches.flatMap(p=>p.items||[])).filter(item=>!identityKey(item)||!identities.has(identityKey(item)));historyContent.replaceChildren();if(!extra.length)historyContent.append(el('p',matches.length?'后端未返回该产品的额外历史记录。':'历史目录未返回该产品的精确关联，请后端核对。'));for(const item of extra){const node=row(item,group,{compact});record.rows.push(node);historyContent.append(node);}filter();}catch(error){loaded=false;historyContent.replaceChildren(el('p',error.message));const retry=el('button','重试');retry.type='button';retry.onclick=()=>{versions.open=false;setTimeout(()=>versions.open=true,0);};historyContent.append(retry);}});body.append(versions);
   }
   section.append(body);(compact&&!primary?other:content).append(section);sections.push(record);
  }
  content.append(empty);input.oninput=filter;if(compact){other.append(otherEmpty);otherInput.oninput=filter;filter();}
  return root;
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
 // Visual feedback only: never cancel navigation, downloads, exports or existing handlers.
 if(typeof document!=='undefined')document.addEventListener('click',event=>{
  const action=event.target.closest?.('.pr-actions a,.doc-file-actions a,.sw-doc-link,.sw-actions a,.sw-row-actions a,.sw-video-dl,.vid-dl,.v2-reader-links a,.v2-record>a,.local-evidence>a,.v2-search-actions a,.v2-search-actions button,.v2-file-link,.ord-topo-btn');
  if(!action||action.getAttribute('aria-disabled')==='true'||action.disabled)return;
  action.classList.add('file-action-used');if(action.closest('.pr-actions'))action.classList.add('pr-action-used');
 });
 window.ProductResources={groups,render,unique,row,fileActions,documentRows,previewTarget,downloadTarget};
})();
