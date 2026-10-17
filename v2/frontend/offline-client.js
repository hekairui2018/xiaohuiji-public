'use strict';
// Existing website style and DOM, independent no-model search/browse controls.
(() => {
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const fetchOriginal=window.fetch.bind(window);
 async function json(url,init){const response=await fetchOriginal(url,init);let data;try{data=await response.json();}catch{throw Error('服务返回格式异常，请稍后重试。');}if(!response.ok||data.error)throw Error(typeof data.error==='string'?data.error:(data.reason||data.message||'服务暂不可用（'+response.status+'）'));return data;}

 const place=l=>typeof l==='string'?l:Object.entries(l||{}).map(([k,v])=>({page:'页',paragraph:'段',row:'行',sheet:'工作表',slide:'幻灯片',table:'表',section:'章节',part:'位置',line:'行'}[k]||k)+'：'+v).join(' · ');
 const labels={chips:'芯片',pitches:'点间距',scans:'扫描方式',softwareVersions:'软件版本',firmwareVersions:'固件版本',hardwareVersions:'硬件版本',additionalConditions:'其他条件'};
 const safeUrl=s=>typeof s==='string'&&/^\/[^/]/.test(s);
 function link(box,url,label,downloadName){if(!safeUrl(url))return;const a=make('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';if(downloadName!==undefined){a.download=downloadName;a.removeAttribute('target');}box.append(a);}
 const reader=make('dialog');reader.className='v2-reader';reader.setAttribute('aria-labelledby','v2ReaderTitle');
 const readerTitle=make('h3');readerTitle.id='v2ReaderTitle';const closeReader=make('button','关闭');closeReader.type='button';closeReader.onclick=()=>reader.close();
 const readerHead=make('header');readerHead.append(readerTitle,closeReader);const readerLinks=make('div');readerLinks.className='v2-reader-links';const readerText=make('pre');readerText.tabIndex=0;readerText.setAttribute('aria-live','polite');const retryRead=make('button','重新读取');retryRead.type='button';reader.append(readerHead,readerLinks,readerText,retryRead);document.body.append(reader);
 let readId=0;
 reader.addEventListener('close',()=>{readId++;});
 async function read(resource){const id=++readId;readerTitle.textContent=resource.name||'原文阅读';readerLinks.replaceChildren();link(readerLinks,resource.download,'打开原文件');link(readerLinks,resource.download,'下载文件',resource.name||'');readerText.textContent='读取原文…';readerText.scrollTop=0;retryRead.disabled=true;retryRead.onclick=()=>read(resource);if(!reader.open)reader.showModal();
  try{const r=await json(resource.readUrl);if(id!==readId)return;readerText.textContent=(r.blocks||[]).map(b=>place(b.locator)+'\n'+b.text).join('\n\n')||'该位置暂无正文，请打开原文件。';}catch(error){if(id!==readId)return;readerText.textContent='原文读取失败：'+error.message;}finally{if(id===readId)retryRead.disabled=false;}}
 function card(r,isCase=false){
  const box=make('article');box.className='v2-record';box.append(make('strong',isCase?r.title:r.name));
  if(isCase){
   box.append(make('small',(r.modelIds||[]).join(' / ')||'适用型号未明确'),make('p',r.phenomenon));
   const scope=Object.entries(r.scope||{}).filter(([,v])=>Array.isArray(v)&&v.length).map(([k,v])=>(labels[k]||k)+'：'+v.join('、')).join('\n');
   box.append(make('pre','适用条件\n'+(scope||'原记录未完整记载，请核对型号、软硬件版本及现场条件。')));
   if(r.checks?.length){const d=make('details');d.append(make('summary','参考排查（原记录）'),make('pre',r.checks.map(x=>x.text).join('\n')));box.append(d);}
   if(r.historicalMeasure)box.append(make('pre','历史处理措施（不代表当前已解决）\n'+r.historicalMeasure));
   if(r.facts?.checkResults?.length)box.append(make('pre','原记录的检查结果\n'+r.facts.checkResults.join('\n')));
   if(r.facts?.engineeringJudgement)box.append(make('pre','原记录的工程判断（限当时条件）\n'+r.facts.engineeringJudgement));
   if(r.facts?.recordedResult?.length)box.append(make('pre','原记录的结果栏（按原文保留）\n'+r.facts.recordedResult.join('\n')));
   box.append(make('small','记录状态：'+({unknown:'尚未核对',reference_only:'经验参考',verified:'来源已核对',verified_by_case:'个案记录支持'}[r.verificationStatus]||r.verificationStatus||'尚未核对')+' · '+(r.resultStatus||'结果未记载')));
   if(r.applicability){const names={modelIds:'设备型号',chips:'芯片',scans:'扫描方式',pitches:'点间距',softwareVersions:'软件版本',firmwareVersions:'固件版本',hardwareVersions:'硬件版本',software:'软件名称',faultScope:'故障范围',temporalPattern:'发生频率',recentOperations:'最近操作','denial-not-confirmed-in-record':'已排除方向的依据'};box.append(make('small',r.applicability.status==='conditional-reference'?'需核对条件后参考':'可直接对照原记录（不是诊断结论）'));if(r.applicability.missingFields?.length)box.append(make('small','还需核对：'+r.applicability.missingFields.map(k=>names[k]||k).join('、')));}
   const original=make('details');original.append(make('summary',r.excerptKind==='existing-case-index-excerpt'?'既有案例摘录及出处（原件链接尚未建立）':'原文摘录及出处'),make('pre',r.sourceExcerpt||'原文摘录缺失'));
   for(const s of r.sources||[]){original.append(make('small',s.name+' · '+place(s.locator)));link(original,s.original,'查看原件');}box.append(original);
   if(r.missingEvidence)box.append(make('small','仍需核对：'+r.missingEvidence));
  }else{
   box.append(make('small',place(r.locator)+' · '+((r.versions||[]).join('、')||'版本未明确')));
   if(r.text){const excerpt=make('pre',r.text);if(r.text.length>360){const details=make('details');details.append(make('summary','查看正文摘录'),excerpt);box.append(details);}else box.append(excerpt);}
   if(r.mentionedModels?.length)box.append(make('small','正文提及：'+r.mentionedModels.join('、')+'（不代表兼容性确认）'));
   link(box,r.download,'打开原文件');link(box,r.download,'下载文件',r.name||'');
   if(!safeUrl(r.download))box.append(make('small','原文件链接暂未提供'));
   if(safeUrl(r.readUrl)){const button=make('button','阅读上下文');button.type='button';button.onclick=()=>read(r);box.append(button);}
  }return box;
 }
 const toolbar=make('div');toolbar.className='v2-toolbar';const mode=make('select');mode.id='v2WorkMode';
 for(const [value,label]of [['all','资料与操作检索'],['cases','历史售后案例'],['ordering','工程配单']]){const o=make('option',label);o.value=value;mode.append(o);}
 const reset=make('button','新查询');reset.type='button';reset.id='v2NewQuery';reset.onclick=()=>{localStorage.setItem('xhj_sid','w-'+crypto.randomUUID());chatHistory=[];triagePath=null;lastNumericOptions=null;window.__v2LastReply=null;document.getElementById('aiMessages').replaceChildren();document.getElementById('aiInput').value='';document.getElementById('aiInput').focus();};
 mode.setAttribute('aria-label','查询方式');
 // Preserve explicit request scope internally; no query-purpose selector in the UI.
 mode.hidden=true;document.querySelector('.ai-section').append(mode);
 const speed=make('div');speed.className='v2-response-modes';speed.setAttribute('role','group');speed.setAttribute('aria-label','回答模式');
 const fast=make('button','快速模式');fast.type='button';fast.id='v2FastMode';fast.setAttribute('aria-pressed','true');fast.title='不调用本地大模型，使用现有检索与规则';
 const expert=make('button','专家模式');expert.type='button';expert.id='v2ExpertMode';expert.disabled=true;expert.title='本地大模型接口待接入，暂不可用';expert.setAttribute('aria-describedby','v2ExpertPending');
 const pending=make('span','专家模式待接入');pending.id='v2ExpertPending';pending.className='v2-mode-pending';speed.append(fast,expert);toolbar.append(speed,pending,reset);document.querySelector('.ai-input-row').before(toolbar);

 const help=make('details');help.className='v2-order-help';help.hidden=true;help.append(make('summary','配单输入示例与范围'),make('p','填写点间距、模组像素、扫描、接口、模组排列及接收卡。未核实的条件不会自动放行。也可提交标准需求JSON。'),make('code','配单 P2 模组160x80 40扫 HUB75 全彩 室内 同步接收卡 10宽8高 R716'));document.getElementById('aiMessages').before(help);
 const conditions=make('details');conditions.id='v2Conditions';conditions.append(make('summary','补充现场条件'));const factInputs={};
 for(const [key,label]of [['modelIds','设备型号'],['chips','芯片'],['scans','扫描方式'],['pitches','点间距'],['softwareVersions','软件版本'],['firmwareVersions','固件版本'],['hardwareVersions','硬件版本'],['faultScope','故障范围：局部/整屏'],['temporalPattern','间歇/持续'],['timeRelations','时间关系，如升级后'],['recentOperations','最近操作'],['knownNormal','明确正常的条件'],['knownAbnormal','明确异常的条件'],['deniedInformation','明确排除的原因或条件']]){const field=make('input');field.placeholder=label;field.maxLength=100;field.dataset.fact=key;const wrapper=make('label',label);wrapper.append(field);factInputs[key]=field;conditions.append(wrapper);}
 const checkAction=make('input'),checkResult=make('input');checkAction.placeholder='已做的检查';checkResult.placeholder='该检查的实际结果';checkAction.maxLength=240;checkResult.maxLength=240;for(const [field,label] of [[checkAction,'已做的检查'],[checkResult,'检查结果']]){const wrapper=make('label',label);wrapper.append(field);conditions.append(wrapper);}
 const originalMessage=make('textarea');originalMessage.maxLength=8000;originalMessage.rows=3;originalMessage.placeholder='原始客户完整描述（可选）；上方输入框填写检索词，原话单独保存，不改写。';originalMessage.setAttribute('aria-label','客户原始完整描述');conditions.append(originalMessage);
 const continuation=make('input');continuation.type='checkbox';continuation.id='v2ContinueQuery';const cl=make('label','将本轮文字作为上一轮的补充检索');cl.className='v2-continuation';cl.prepend(continuation);conditions.append(cl);document.getElementById('aiMessages').before(conditions);
 const feedback=make('p');feedback.className='v2-feedback';feedback.setAttribute('role','status');document.querySelector('.ai-input-row').before(feedback);
 const facts=()=>Object.fromEntries(Object.entries(factInputs).map(([key,input])=>[key,input.value.split(/[;；、]/).map(s=>s.trim()).filter(Boolean)]));
 const modeChange=()=>{help.hidden=mode.value!=='ordering';conditions.hidden=mode.value!=='cases';document.getElementById('aiInput').placeholder=mode.value==='ordering'?'输入完整工程需求，或标准需求JSON':mode.value==='cases'?'输入故障现象、准确型号或版本':'输入型号、文件名、软件功能或正文关键词';};mode.onchange=()=>{localStorage.setItem('xhj_sid','w-'+crypto.randomUUID());chatHistory=[];continuation.checked=false;modeChange();};const requestedMode=new URLSearchParams(location.search).get('mode');if(['ordering','cases'].includes(requestedMode))mode.value=requestedMode;modeChange();
 if(mode.value==='ordering'){document.querySelector('.ai-hint').textContent='填写完整屏体需求；配单结果由现有规则校验后展示。';document.querySelector('#aiMessages .ai-msg-bubble').textContent='请提供点间距、模组像素、排列及接收卡等已知条件，缺失条件会继续询问。';}else if(mode.value==='cases'){document.querySelector('.ai-hint').textContent='检索历史案例，结合型号、版本和现场条件核对。';document.querySelector('#aiMessages .ai-msg-bubble').textContent='输入故障现象和准确型号，可补充现场条件对照历史记录。历史措施不代表当前故障已经解决。';}
 const undo=make('button','撤销新查询');undo.type='button';undo.hidden=true;undo.className='v2-undo';toolbar.append(undo);
 let savedQuery=null,undoTimer;
 function forgetUndo(){savedQuery=null;clearTimeout(undoTimer);undo.hidden=true;}
 reset.addEventListener('click',()=>{const messages=document.getElementById('aiMessages');if(!messages.children.length&&!document.getElementById('aiInput').value&&!Object.values(factInputs).some(i=>i.value)&&!originalMessage.value&&!checkAction.value&&!checkResult.value)return;
 savedQuery={sid:getSid(),nodes:[...messages.childNodes],history:chatHistory.slice(),triage:triagePath,numeric:lastNumericOptions,reply:window.__v2LastReply,input:document.getElementById('aiInput').value,fields:Object.values(factInputs).map(i=>i.value),action:checkAction.value,result:checkResult.value,original:originalMessage.value,continue:continuation.checked};clearTimeout(undoTimer);undo.hidden=false;undoTimer=setTimeout(forgetUndo,10000);},true);
 undo.onclick=()=>{if(!savedQuery)return;const s=savedQuery;localStorage.setItem('xhj_sid',s.sid);document.getElementById('aiMessages').replaceChildren(...s.nodes);chatHistory=s.history;triagePath=s.triage;lastNumericOptions=s.numeric;window.__v2LastReply=s.reply;document.getElementById('aiInput').value=s.input;Object.values(factInputs).forEach((i,n)=>i.value=s.fields[n]);checkAction.value=s.action;checkResult.value=s.result;originalMessage.value=s.original;continuation.checked=s.continue;forgetUndo();document.getElementById('aiInput').focus();};
 mode.addEventListener('change',forgetUndo);
 reset.addEventListener('click',()=>{for(const input of Object.values(factInputs))input.value='';checkAction.value='';checkResult.value='';originalMessage.value='';continuation.checked=false;feedback.textContent='';clearOcrImage();});
 window.fetch=(input,init)=>{
  if(input==='/api/ai/chat'&&mode.value==='ordering')return fetchOriginal('/v2/ordering/chat',init);
  if(input==='/api/ai/chat'&&mode.value!=='ordering'){const b=JSON.parse(init.body);b.facts=facts();b.originalMessage=originalMessage.value||undefined;b.checks=checkAction.value||checkResult.value?[{action:checkAction.value,result:checkResult.value}]:[];b.continueQuery=continuation.checked;return fetchOriginal(input,{...init,headers:{...init?.headers,'X-V2-Offline-Knowledge':mode.value},body:JSON.stringify(b)});}
  return fetchOriginal(input,init);
 };
 const previous=window.addAssistantMessage;
 window.addAssistantMessage=data=>{
  if(data.model!=='v2-offline-search'&&!data.error)return previous(data);
  const row=make('div');row.className='ai-msg ai-msg-assistant';const bubble=make('div');bubble.className='ai-msg-bubble';bubble.append(make('p',data.reply||'请求未完成，请稍后重试。'));
  for(const r of data.results||[])bubble.append(card(r,data.kind==='cases'));
  if(data.rawEvidence?.length){bubble.append(make('h4','相关原始资料（不等于已核验案例）'));for(const r of data.rawEvidence)bubble.append(card(r));}
  row.append(bubble);const messages=document.getElementById('aiMessages');messages.append(row);messages.scrollTop=messages.scrollHeight;window.__v2LastReply=data;
 };
 // Keep legacy presentation, but do not let its option/intent handling own V2 search.
 window.sendMessage=async(value,display)=>{const input=document.getElementById('aiInput'),button=document.getElementById('aiSendBtn'),text=typeof value==='string'?value:input.value;
  if(!text.trim()||button.disabled)return;feedback.textContent='';if(mode.value!=='ordering'&&text.trim().length>240){feedback.textContent='检索词最多240字。请将完整描述放入现场条件，输入简短检索词。';conditions.hidden=false;conditions.open=true;return;}forgetUndo();const sessionId=getSid();input.value='';input.disabled=true;button.disabled=true;reset.disabled=true;mode.disabled=true;addUserMessage(display||text);addAssistantLoading(mode.value==='ordering'?'计算并校验方案…':'检索资料…');
  try{const response=await window.fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,sessionId})}).then(async r=>{const data=await r.json();if(!r.ok||data.error)throw Error(typeof data.error==='string'?data.error:(data.reason||'请求失败（'+r.status+'）'));return data;});if(getSid()!==sessionId)return;removeLoading();window.addAssistantMessage(response);chatHistory.push({role:'user',content:text},{role:'assistant',content:response.reply||''});}
  catch(error){removeLoading();input.value=text;window.addAssistantMessage({model:'v2-offline-search',reply:'请求失败：'+error.message+'。输入已保留，可重试。'});}finally{input.disabled=false;button.disabled=false;reset.disabled=false;mode.disabled=false;input.focus();}};
 // V2 fixes the legacy imageId block-scope bug without editing the V1 frontend.
 window.sendImageMessage=async dataUrl=>{forgetUndo();ocrState={dataUrl,text:'',busy:true};reset.disabled=true;mode.disabled=true;document.getElementById('aiSendBtn').disabled=true;document.getElementById('aiInput').disabled=true;addUserMessage('',dataUrl);addAssistantLoading('本地识别图片文字…');
  try{const r=await fetchOriginal('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:dataUrl})}).then(r=>r.json());window.__v2LastOCR=r;removeLoading();
   if(!r.ok||!r.text){window.addAssistantMessage({model:'v2-offline-search',reply:r.message||'图片未识别到文字，请输入文字。'});return;}
   if(r.text.length>240){originalMessage.value=r.text.slice(0,8000);conditions.hidden=false;conditions.open=true;window.addAssistantMessage({model:'v2-offline-search',reply:'已识别文字并放入原始描述栏，完整识别结果已本地留存。请输入简短检索词后查询。'});return;}
   addAssistantLoading('检索资料…');const body={message:r.text,sessionId:getSid(),facts:facts(),images:[r.imageId]},response=await window.fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());removeLoading();window.addAssistantMessage(response);
  }catch{removeLoading();window.addAssistantMessage({model:'v2-offline-search',reply:'本地图片识别未完成，可继续文字查询。'});}finally{ocrState={dataUrl:null,text:'',busy:false};reset.disabled=false;mode.disabled=false;document.getElementById('aiSendBtn').disabled=false;document.getElementById('aiInput').disabled=false;}};
 const moreButton=document.getElementById('quickMoreDocsBtn');
 function highlight(text,query){
  const fragment=document.createDocumentFragment(),value=String(text||''),terms=(query.match(/[A-Za-z0-9.+_-]+|[\u4e00-\u9fff]+/g)||[]).filter(Boolean).slice(0,12);
  if(!terms.length){fragment.append(document.createTextNode(value));return fragment;}
  const expression=new RegExp(terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'ig');let start=0;
  for(const hit of value.matchAll(expression)){fragment.append(document.createTextNode(value.slice(start,hit.index)));const mark=make('mark',hit[0]);fragment.append(mark);start=hit.index+hit[0].length;}
  fragment.append(document.createTextNode(value.slice(start)));return fragment;
 }
 function searchRow(hits,query){
  const first=hits.find(h=>h.readUrl)||hits[0],row=make('article');row.className='v2-search-row';
  const extension=(first.extension||/\.[^.]+$/.exec(first.name)?.[0]||'').toLowerCase();
  const labels={'.pdf':['PDF','pdf'],'.docx':['W','word'],'.doc':['W','word'],'.xlsx':['X','sheet'],'.xls':['X','sheet'],'.csv':['X','sheet'],'.pptx':['P','slides'],'.mp4':['▶','video'],'.bin':['BIN','binary']};
  const icon=make('span',(labels[extension]||['文','file'])[0]);icon.className='v2-file-icon '+(labels[extension]||['文','file'])[1];icon.setAttribute('aria-hidden','true');row.append(icon);
  const content=make('div');content.className='v2-search-row-content';
  const title=make(first.readUrl?'button':safeUrl(first.download)?'a':'strong');title.className='v2-search-title';title.append(highlight(first.name,query));
  if(first.readUrl){title.type='button';title.onclick=()=>read(first);}else if(safeUrl(first.download)){title.href=first.download;title.target='_blank';title.rel='noopener';}
  content.append(title);
  const excerpts=[...new Set(hits.map(h=>h.text).filter(Boolean))].slice(0,2);
  for(const text of excerpts){const lower=text.toLowerCase(),term=(query.match(/[A-Za-z0-9]+|[\u4e00-\u9fff]+/g)||[]).map(t=>lower.indexOf(t.toLowerCase())).filter(i=>i>=0).sort((a,b)=>a-b)[0]||0,start=Math.max(0,term-45);const snippet=make('p');snippet.className='v2-search-snippet';snippet.append(highlight((start?'…':'')+text.slice(start,start+230)+(text.length>start+230?'…':''),query));content.append(snippet);}
  const meta=make('div');meta.className='v2-search-meta';meta.append(document.createTextNode([first.sourceDirectory||'本地已登记资料',...(first.versions||[]),first.locator?place(first.locator):'文件名或目录命中'].filter(Boolean).join(' · ')));
  if(first.localModifiedAt){const date=new Date(first.localModifiedAt);if(!Number.isNaN(date.getTime()))meta.append(make('span','本地修改：'+date.toLocaleDateString('zh-CN')));}
  if(hits.length>1)meta.append(make('span',hits.length+'处检索命中'));
  content.append(meta);const actions=make('div');actions.className='v2-search-actions';if(first.readUrl){const button=make('button','阅读上下文');button.type='button';button.onclick=()=>read(first);actions.append(button);}link(actions,first.download,'打开原文件');content.append(actions);row.append(content);return row;
 }
 const searchInput=document.getElementById('quickSearchInput');
 const scopeStatus=make('p');scopeStatus.className='v2-scope-status';scopeStatus.setAttribute('role','status');scopeStatus.hidden=true;
 document.querySelector('.search-box').after(scopeStatus);
 let products=true,searchId=0,controller;
 function invalidate(){searchId++;controller?.abort();clearTimeout(searchTimer);window.invalidateQuickRequest?.();document.getElementById('searchResults').setAttribute('aria-busy','false');}
 function updateScope(){
  document.getElementById('resourceSearchTitle').textContent=products?'产品速查':'全文搜索';
  document.getElementById('resourceSearchHint').textContent=products?'输入产品型号，查参数、规格书、说明书、软件、固件和操作视频。':'输入关键词，搜索已索引资料的文件名、目录和正文，查看原文及来源。';
  searchInput.setAttribute('aria-label',products?'产品型号或资料关键词':'文件名、目录名或正文关键词');
  document.getElementById('quickProductTitle').setAttribute('aria-pressed',String(products));document.getElementById('quickCats').hidden=!products;
  moreButton.setAttribute('aria-pressed',String(!products));scopeStatus.hidden=products;
  scopeStatus.textContent='全文搜索 · 已索引资料的文件名、目录与正文';
  document.querySelectorAll('#quickCats .qc-btn').forEach(b=>b.setAttribute('aria-selected',String(products&&b.classList.contains('active'))));
  document.getElementById('quickExamples').hidden=!products;
  if(products){setActiveCat(activeCat);updateQuickExamples();}
  else searchInput.placeholder='输入文件名、目录名或正文关键词';
 }
 function returnToProducts(run=true){invalidate();products=true;updateScope();if(run)onPickCategory(activeCat);}
 document.getElementById('quickProductTitle').onclick=()=>{returnToProducts(false);onPickCategory('all');};
 moreButton.onclick=()=>{invalidate();products=false;updateScope();search();if(!searchInput.value.trim())searchInput.focus();};
 document.getElementById('quickCats').addEventListener('click',e=>{if(!e.target.closest('.qc-btn')||products)return;returnToProducts(false);},true);
 searchInput.addEventListener('input',e=>{if(products)return;e.stopImmediatePropagation();invalidate();},true);
 searchInput.addEventListener('keydown',e=>{if(e.isComposing&&e.key==='Enter')e.stopImmediatePropagation();},true);
 async function search(){
  invalidate();const id=searchId,q=searchInput.value.trim(),out=document.getElementById('searchResults');out.style.display='block';out.replaceChildren(make('p','检索中…'));
  if(!q||q.length>240){out.replaceChildren(make('p',!q?'请输入文件名、目录名或正文关键词。':'检索词最多240字，请缩短后重试。'));return;}
  controller=new AbortController();out.setAttribute('aria-busy','true');
  try{const response=await json('/v2/offline/search?q='+encodeURIComponent(q)+'&mode=all&limit=50&view=list',{signal:controller.signal});if(id!==searchId)return;
   const grouped=new Map();for(const hit of response.results||[]){const key=hit.versionId||hit.download||hit.blockId;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(hit);}
   const heading=make('p','找到 '+grouped.size+' 份资料 · 当前返回 '+(response.results||[]).length+' 条匹配'+((response.results||[]).length===50?'（显示前50条，可补充关键词缩小范围）':''));heading.className='v2-search-summary';out.replaceChildren(heading);
   if(!response.results?.length)out.append(make('p','未找到资料，请更换关键词或切回产品速查。'));
   const list=make('div');list.className='v2-search-list';for(const hits of grouped.values())list.append(searchRow(hits,q));out.append(list);
  }catch(error){if(id!==searchId||error.name==='AbortError')return;out.replaceChildren(make('p','资料检索失败：'+error.message));const retry=make('button','重试');retry.type='button';retry.onclick=search;out.append(retry);}
  finally{if(id===searchId)out.setAttribute('aria-busy','false');}
 }
 document.getElementById('quickSearchBtn').addEventListener('click',e=>{if(products)return;e.preventDefault();e.stopImmediatePropagation();search();},true);
 searchInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!products){e.preventDefault();e.stopImmediatePropagation();search();}},true);
})();
