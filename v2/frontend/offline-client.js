'use strict';
// Existing website style and DOM, independent no-model search/browse controls.
window.OfflineClient = Object.freeze({create(ui) {
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const fetchOriginal=window.fetch.bind(window);
 const {state,getSessionId:getSid,clearImage:clearOcrImage}=ui;
 async function json(url,init){const response=await fetchOriginal(url,init);let data;try{data=await response.json();}catch{throw Error('服务返回格式异常，请稍后重试。');}if(!response.ok||data.error)throw Error(data.reply||data.message||(typeof data.error==='string'?data.error:(data.reason||'服务暂不可用（'+response.status+'）')));return data;}

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
   box.append(make('small',[place(r.locator),(r.versions||[]).join('、')].filter(Boolean).join(' · ')));
   if(r.text){const excerpt=make('pre',r.text);if(r.text.length>360){const details=make('details');details.append(make('summary','查看正文摘录'),excerpt);box.append(details);}else box.append(excerpt);}
   if(r.mentionedModels?.length)box.append(make('small','正文提及：'+r.mentionedModels.join('、')+'（不代表兼容性确认）'));
   link(box,r.download,'打开原文件');link(box,r.download,'下载文件',r.name||'');
   if(!safeUrl(r.download))box.append(make('small','原文件链接暂未提供'));
   if(safeUrl(r.readUrl)){const button=make('button','阅读上下文');button.type='button';button.onclick=()=>read(r);box.append(button);}
  }return box;
 }
 const toolbar=make('div');toolbar.className='v2-toolbar';const mode=make('select');mode.id='v2WorkMode';
 for(const [value,label]of [['all','资料与操作检索'],['cases','历史售后案例'],['ordering','工程配单']]){const o=make('option',label);o.value=value;mode.append(o);}
 const reset=make('button','新查询');reset.type='button';reset.id='v2NewQuery';reset.onclick=()=>{ui.setSessionId(window.createV2SessionId());state.history=[];state.triage=null;state.numeric=null;window.__v2LastReply=null;document.getElementById('aiMessages').replaceChildren();document.getElementById('aiInput').value='';document.getElementById('aiInput').focus();};
 mode.setAttribute('aria-label','查询方式');
 // Preserve explicit request scope internally; no query-purpose selector in the UI.
 mode.hidden=true;document.querySelector('.ai-section').append(mode);
 const speed=make('div');speed.className='v2-response-modes';speed.setAttribute('role','group');speed.setAttribute('aria-label','回答模式');
 const fast=make('button','快速模式');fast.type='button';fast.id='v2FastMode';fast.setAttribute('aria-pressed','true');fast.title='不调用本地大模型，使用现有检索与规则';
 const expert=make('button','专家模式');expert.type='button';expert.id='v2ExpertMode';expert.disabled=true;expert.title='本地大模型接口待接入，暂不可用';expert.setAttribute('aria-describedby','v2ExpertPending');
 const pending=make('span','专家模式待接入');pending.id='v2ExpertPending';pending.className='v2-mode-pending';speed.append(fast,expert);toolbar.append(speed,pending,reset);document.querySelector('.ai-input-row').before(toolbar);
 let responseMode='quick',modelAvailable=false,queryBusy=false,modeChosen=false,conversationType='normal';
 function updateResponseMode(){
  const ordering=mode.value==='ordering';
  fast.setAttribute('aria-pressed',String(ordering||responseMode==='quick'));expert.setAttribute('aria-pressed',String(!ordering&&responseMode==='expert'));
  fast.disabled=queryBusy;expert.disabled=queryBusy||ordering||!modelAvailable;
  expert.title=ordering?'工程配单使用现有规则':modelAvailable?'使用本地大模型结合原文资料回答':'本地模型未连接，请检查模型服务';
 }
 fast.onclick=()=>{modeChosen=true;responseMode='quick';updateResponseMode();};
 expert.onclick=()=>{if(modelAvailable&&!queryBusy&&mode.value!=='ordering'){modeChosen=true;responseMode='expert';updateResponseMode();}};
 async function refreshModel(){
  try{const capability=await json('/v2/offline/capabilities');modelAvailable=capability.expert?.available===true;
   pending.textContent=modelAvailable?(capability.expert?.trial?'0.8B检索试用 · 16K · 最近5轮':'本地模型已连接'):'本地模型未连接';pending.title=capability.expert?.model?'服务模型：'+capability.expert.model:'请启动本地模型服务';
   expert.textContent=capability.expert?.trial?'0.8B 检索试用':'专家模式';
   if(modelAvailable&&!modeChosen)responseMode='expert';
  }catch{modelAvailable=false;pending.textContent='本地模型连接失败';}
  updateResponseMode();
 }
 refreshModel();window.addEventListener('focus',refreshModel);mode.addEventListener('change',updateResponseMode);

 const help=make('details');help.className='v2-order-help';help.hidden=true;help.append(make('summary','配单输入示例与范围'),make('p','填写点间距、模组像素、扫描、接口、模组排列及接收卡。未核实的条件不会自动放行。也可提交标准需求JSON。'),make('code','配单 P2 模组160x80 40扫 HUB75 全彩 室内 同步接收卡 10宽8高 R716'));document.getElementById('aiMessages').before(help);
 const conditions=make('details');conditions.id='v2Conditions';conditions.append(make('summary','补充现场条件'));const factInputs={};
 for(const [key,label]of [['modelIds','设备型号'],['chips','芯片'],['scans','扫描方式'],['pitches','点间距'],['softwareVersions','软件版本'],['firmwareVersions','固件版本'],['hardwareVersions','硬件版本'],['faultScope','故障范围：局部/整屏'],['temporalPattern','间歇/持续'],['timeRelations','时间关系，如升级后'],['recentOperations','最近操作'],['knownNormal','明确正常的条件'],['knownAbnormal','明确异常的条件'],['deniedInformation','明确排除的原因或条件']]){const field=make('input');field.placeholder=label;field.maxLength=100;field.dataset.fact=key;const wrapper=make('label',label);wrapper.append(field);factInputs[key]=field;conditions.append(wrapper);}
 const checkAction=make('input'),checkResult=make('input');checkAction.placeholder='已做的检查';checkResult.placeholder='该检查的实际结果';checkAction.maxLength=240;checkResult.maxLength=240;for(const [field,label] of [[checkAction,'已做的检查'],[checkResult,'检查结果']]){const wrapper=make('label',label);wrapper.append(field);conditions.append(wrapper);}
 const originalMessage=make('textarea');originalMessage.maxLength=8000;originalMessage.rows=3;originalMessage.placeholder='原始客户完整描述（可选）；上方输入框填写检索词，原话单独保存，不改写。';originalMessage.setAttribute('aria-label','客户原始完整描述');conditions.append(originalMessage);
 const continuation=make('input');continuation.type='checkbox';continuation.id='v2ContinueQuery';const cl=make('label','将本轮文字作为上一轮的补充检索');cl.className='v2-continuation';cl.prepend(continuation);conditions.append(cl);document.getElementById('aiMessages').before(conditions);
 const feedback=make('p');feedback.className='v2-feedback';feedback.setAttribute('role','status');document.querySelector('.ai-input-row').before(feedback);
 const facts=()=>Object.fromEntries(Object.entries(factInputs).map(([key,input])=>[key,input.value.split(/[;；、]/).map(s=>s.trim()).filter(Boolean)]));
 const modeChange=()=>{help.hidden=mode.value!=='ordering';conditions.hidden=mode.value!=='cases';document.getElementById('aiInput').placeholder=mode.value==='ordering'?'输入完整工程需求，或标准需求JSON':mode.value==='cases'?'输入故障现象、准确型号或版本':'输入型号、文件名、软件功能或正文关键词';};mode.onchange=()=>{ui.setSessionId(window.createV2SessionId());state.history=[];continuation.checked=false;modeChange();};const requestedMode=new URLSearchParams(location.search).get('mode');if(['ordering','cases'].includes(requestedMode))mode.value=requestedMode;modeChange();
 if(mode.value==='ordering'){document.querySelector('.ai-hint').textContent='填写完整屏体需求；配单结果由现有规则校验后展示。';document.querySelector('#aiMessages .ai-msg-bubble').textContent='请提供点间距、模组像素、排列及接收卡等已知条件，缺失条件会继续询问。';}else if(mode.value==='cases'){document.querySelector('.ai-hint').textContent='检索历史案例，结合型号、版本和现场条件核对。';document.querySelector('#aiMessages .ai-msg-bubble').textContent='输入故障现象和准确型号，可补充现场条件对照历史记录。历史措施不代表当前故障已经解决。';}
 const undo=make('button','撤销新查询');undo.type='button';undo.hidden=true;undo.className='v2-undo';toolbar.append(undo);
 let savedQuery=null,undoTimer;
 function forgetUndo(){savedQuery=null;clearTimeout(undoTimer);undo.hidden=true;}
 reset.addEventListener('click',()=>{const messages=document.getElementById('aiMessages');if(!messages.children.length&&!document.getElementById('aiInput').value&&!Object.values(factInputs).some(i=>i.value)&&!originalMessage.value&&!checkAction.value&&!checkResult.value)return;
 savedQuery={sid:getSid(),nodes:[...messages.childNodes],history:state.history.slice(),triage:state.triage,numeric:state.numeric,reply:window.__v2LastReply,input:document.getElementById('aiInput').value,fields:Object.values(factInputs).map(i=>i.value),action:checkAction.value,result:checkResult.value,original:originalMessage.value,continue:continuation.checked};clearTimeout(undoTimer);undo.hidden=false;undoTimer=setTimeout(forgetUndo,10000);},true);
 undo.onclick=()=>{if(!savedQuery)return;const s=savedQuery;ui.setSessionId(s.sid);document.getElementById('aiMessages').replaceChildren(...s.nodes);state.history=s.history;state.triage=s.triage;state.numeric=s.numeric;window.__v2LastReply=s.reply;document.getElementById('aiInput').value=s.input;Object.values(factInputs).forEach((i,n)=>i.value=s.fields[n]);checkAction.value=s.action;checkResult.value=s.result;originalMessage.value=s.original;continuation.checked=s.continue;forgetUndo();document.getElementById('aiInput').focus();};
 mode.addEventListener('change',forgetUndo);
 reset.addEventListener('click',()=>{for(const input of Object.values(factInputs))input.value='';checkAction.value='';checkResult.value='';originalMessage.value='';continuation.checked=false;feedback.textContent='';clearOcrImage();});
 async function request(body){
  const ordering=mode.value==='ordering';
  if(!ordering)body={...body,mode:responseMode,conversationType,facts:facts(),originalMessage:originalMessage.value||undefined,checks:checkAction.value||checkResult.value?[{action:checkAction.value,result:checkResult.value}]:[],continueQuery:continuation.checked};
  if(!ordering)fetchOriginal('/v2/offline/suggestions?q='+encodeURIComponent(body.message.slice(0,240))).then(r=>r.ok?r.json():null).then(data=>{if(data?.suggestion&&getSid()===body.sessionId)window.dispatchEvent(new CustomEvent('v2-model-suggestion',{detail:{...data.suggestion,view:'ai'}}));}).catch(()=>{});
  const requestId=window.createV2SessionId(),sessionId=body.sessionId;body={...body,requestId};
  let done=false,timer,pollController;
  const stages={understanding:'正在理解问题',searching:'正在检索资料',reading:'正在阅读原文','evidence-found':'已找到相关依据',composing:'正在整理回答',completed:'回答已完成',failed:'本次处理未完成'};
  const poll=async()=>{if(done||getSid()!==sessionId)return;pollController=new AbortController();try{
   const response=await fetchOriginal('/v2/offline/progress?session='+encodeURIComponent(sessionId)+'&request='+encodeURIComponent(requestId),{signal:pollController.signal});
   if(response.ok){const event=await response.json();if(!done&&getSid()===sessionId){const target=document.querySelector('#aiLoading .ai-msg-bubble');if(target&&stages[event.stage]&&target.textContent!==stages[event.stage]+'…'){target.textContent=stages[event.stage]+'…';target.setAttribute('role','status');}}}
  }catch{}finally{if(!done)timer=setTimeout(poll,300);}};
  if(!ordering)poll();
  try{return await json(ordering?'/v2/ordering/chat':'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',...(!ordering?{'X-V2-Offline-Knowledge':mode.value}:{})},body:JSON.stringify(body)});}
  finally{done=true;clearTimeout(timer);pollController?.abort();}
 }
 function render(data){
  if(data.model!=='v2-offline-search'&&data.actualMode!=='expert'&&!data.error)return false;
  const row=make('div');row.className='ai-msg ai-msg-assistant';const bubble=make('div');bubble.className='ai-msg-bubble';bubble.append(make('p',data.reply||'请求未完成，请稍后重试。'));
  for(const r of data.results||[])bubble.append(card(r,data.kind==='cases'));
  if(data.rawEvidence?.length){bubble.append(make('h4','相关原始资料（不等于已核验案例）'));for(const r of data.rawEvidence)bubble.append(card(r));}
  row.append(bubble);const messages=document.getElementById('aiMessages');messages.append(row);messages.scrollTop=messages.scrollHeight;window.__v2LastReply=data;return true;
 };
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
  // Present a file's location and role, not raw parser offsets / XML internals.
  const pathRow=make('div');pathRow.className='v2-search-directory';
  pathRow.append(make('span','来源目录：'),make('span',first.sourceDirectory||'尚未登记目录'));
  content.append(pathRow);
  const typeLabel=({'.pdf':'PDF','.docx':'Word','.doc':'Word','.xlsx':'Excel','.xls':'Excel','.pptx':'PPT','.txt':'文本','.mp4':'视频','.bin':'固件'}[extension]||'文件');
  const meta=make('div');meta.className='v2-search-meta';
  if(first.source?.cloudMappingStatus==='not-registered')meta.append(make('span','云盘链接未登记'));
  meta.append(document.createTextNode([typeLabel,...(first.versions||[])].filter(Boolean).join(' · ')));
  if(first.localModifiedAt){const date=new Date(first.localModifiedAt);if(!Number.isNaN(date.getTime()))meta.append(make('span','本地修改：'+date.toLocaleDateString('zh-CN')));}
  if(hits.length>1)meta.append(make('span',hits.length+'处检索命中'));
  content.append(meta);
  const positions=first.matchedLocations||[];
  if(positions.length){const locations=make('details'),label=make('summary','命中位置 '+first.candidatePassages+' 处'+(first.locationsTruncated?'（部分展示）':''));locations.className='v2-search-locations';locations.append(label);
   for(const pos of positions){const button=make('button',place(pos.locator)||'原文位置');button.type='button';button.onclick=()=>read({...first,readUrl:pos.readUrl});locations.append(button);}content.append(locations);
  }else if(first.locator){content.append(make('small','原文位置：'+place(first.locator)));}
  const actions=make('div');actions.className='v2-search-actions';if(first.readUrl){const button=make('button','阅读上下文');button.type='button';button.onclick=()=>read(first);actions.append(button);}if(window.ProductResources?.fileActions)actions.append(window.ProductResources.fileActions({...first,url:first.download,available:!!first.download}));else link(actions,first.download,'打开原文件');content.append(actions);row.append(content);return row;
 }
 const searchInput=document.getElementById('quickSearchInput');
 const scopeStatus=make('p');scopeStatus.className='v2-scope-status';scopeStatus.setAttribute('role','status');scopeStatus.hidden=true;
 document.querySelector('.search-box').after(scopeStatus);
 let products=true,searchId=0,controller;
 function invalidate(){searchId++;controller?.abort();ui.catalog.invalidate();document.getElementById('searchResults').setAttribute('aria-busy','false');}
 function updateScope(){
  document.getElementById('resourceSearchTitle').textContent=products?'产品速查':'全文搜索';
  document.getElementById('resourceSearchHint').textContent=products?'输入产品型号，查参数、规格书、说明书、软件、固件和操作视频。':'输入关键词，搜索已索引资料的文件名、目录和正文，查看原文及来源。';
  searchInput.setAttribute('aria-label',products?'产品型号或资料关键词':'文件名、目录名或正文关键词');
  document.getElementById('quickProductTitle').setAttribute('aria-pressed',String(products));document.getElementById('quickCats').hidden=!products;
  moreButton.setAttribute('aria-pressed',String(!products));scopeStatus.hidden=products;
  scopeStatus.textContent='全文搜索 · 已索引资料的文件名、目录与正文';
  document.querySelectorAll('#quickCats .qc-btn').forEach(b=>b.setAttribute('aria-selected',String(products&&b.classList.contains('active'))));
  document.getElementById('quickExamples').hidden=!products;
  if(products){ui.catalog.setActiveCat(ui.catalog.activeCat);ui.catalog.updateQuickExamples();}
  else searchInput.placeholder='输入文件名、目录名或正文关键词';
 }
 function returnToProducts(run=true){invalidate();products=true;updateScope();if(run)ui.catalog.onPickCategory(ui.catalog.activeCat);}
 document.getElementById('quickProductTitle').onclick=()=>{returnToProducts(false);ui.catalog.onPickCategory('all');};
 moreButton.onclick=()=>{invalidate();products=false;updateScope();search();if(!searchInput.value.trim())searchInput.focus();};
 document.getElementById('quickCats').addEventListener('click',e=>{if(!e.target.closest('.qc-btn')||products)return;returnToProducts(false);},true);
 searchInput.addEventListener('input',e=>{if(products)return;e.stopImmediatePropagation();invalidate();},true);
 searchInput.addEventListener('keydown',e=>{if(e.isComposing&&e.key==='Enter')e.stopImmediatePropagation();},true);
 async function search(){
  invalidate();const id=searchId,q=searchInput.value.trim(),out=document.getElementById('searchResults');out.style.display='block';out.replaceChildren(make('p','检索中…'));
  if(!q||q.length>240){out.replaceChildren(make('p',!q?'请输入文件名、目录名或正文关键词。':'检索词最多240字，请缩短后重试。'));return;}
  controller=new AbortController();out.setAttribute('aria-busy','true');
  try{const response=await json('/v2/offline/search?q='+encodeURIComponent(q)+'&mode=all&limit=50&view=list',{signal:controller.signal});if(id!==searchId)return;
   // Defensive deduplication for old servers; the new server already groups
   // documents by content identity before applying its result limit.
   const grouped=new Map();for(const hit of response.results||[]){
    const key=hit.fileId||hit.sha256||hit.versionId||hit.download||hit.blockId;
    if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(hit);
   }
   const capped=response.limitReached||(response.results||[]).length>=50;
   const heading=make('p','本次显示 '+grouped.size+' 份相关资料'+(capped?' · 最多展示前50份，请补充关键词缩小范围':''));
   heading.className='v2-search-summary';out.replaceChildren(heading);
   if(!response.results?.length)out.append(make('p','未找到资料，请更换关键词或切回产品速查。'));
   const list=make('div');list.className='v2-search-list';for(const hits of grouped.values())list.append(searchRow(hits,q));out.append(list);
  }catch(error){if(id!==searchId||error.name==='AbortError')return;out.replaceChildren(make('p','资料检索失败：'+error.message));const retry=make('button','重试');retry.type='button';retry.onclick=search;out.append(retry);}
  finally{if(id===searchId)out.setAttribute('aria-busy','false');}
 }
 document.getElementById('quickSearchBtn').addEventListener('click',e=>{if(products)return;e.preventDefault();e.stopImmediatePropagation();search();},true);
 searchInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!products){e.preventDefault();e.stopImmediatePropagation();search();}},true);
 return {request,render,legacy:false,mode,reset,setMode:modeChange,setConversationType(value){conversationType=value;},releaseGuest(sessionId){fetchOriginal('/v2/offline/session/close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId}),keepalive:true}).catch(()=>{});},
  validate(text){feedback.textContent='';if(mode.value!=='ordering'&&text.trim().length>240){feedback.textContent='检索词最多240字。请将完整描述放入现场条件，输入简短检索词。';conditions.hidden=false;conditions.open=true;return false;}return true;},
  beforeSend:forgetUndo,setBusy(busy){reset.disabled=busy;mode.disabled=busy;queryBusy=busy;updateResponseMode();},loadingLabel:()=>mode.value==='ordering'?'计算并校验方案…':responseMode==='expert'?'正在阅读资料并思考…':'检索资料…',
  acceptOcr(result){if(result.text.length<=240)return true;originalMessage.value=result.text.slice(0,8000);conditions.hidden=false;conditions.open=true;ui.addAssistantMessage({model:'v2-offline-search',reply:'已识别文字并放入原始描述栏，完整识别结果已本地留存。请输入简短检索词后查询。'});return false;}
 };
}});
