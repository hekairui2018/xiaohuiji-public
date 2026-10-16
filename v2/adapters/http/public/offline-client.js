'use strict';
// Existing website style and DOM, independent no-model search/browse controls.
(() => {
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const fetchOriginal=window.fetch.bind(window);
 const css=make('style');css.textContent='.v2-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0;color:#53687a}.v2-toolbar select,.v2-toolbar button,.v2-record button{font:inherit;padding:7px;border:1px solid #d6e0e8;border-radius:7px;background:white;color:#173047}.v2-record{border:1px solid #dbe4ec;border-radius:10px;padding:12px;margin:10px 0;overflow-wrap:anywhere}.v2-record pre{white-space:pre-wrap;max-height:340px;overflow:auto;font:inherit;background:#f6f8fa;padding:10px}.v2-record small{display:block;color:#63788a;margin:7px 0}.v2-record a{display:inline-block;margin:5px 10px 5px 0;color:#2169a0}.v2-note{color:#63788a;font-size:13px}.v2-order-help{font-size:13px;max-width:700px}.v2-order-help code{white-space:pre-wrap}';document.head.append(css);
 const place=l=>typeof l==='string'?l:Object.entries(l||{}).map(([k,v])=>({page:'页',paragraph:'段',row:'行',sheet:'工作表',slide:'幻灯片',table:'表',section:'章节',part:'位置',line:'行'}[k]||k)+'：'+v).join(' · ');
 const labels={chips:'芯片',pitches:'点间距',scans:'扫描方式',softwareVersions:'软件版本',firmwareVersions:'固件版本',hardwareVersions:'硬件版本',additionalConditions:'其他条件'};
 const safeUrl=s=>typeof s==='string'&&/^\/[^/]/.test(s);
 function link(box,url,label){if(!safeUrl(url))return;const a=make('a',label);a.href=url;a.target='_blank';a.rel='noopener';box.append(a);}
 async function read(url,target){target.textContent='读取原文…';try{const r=await fetchOriginal(url).then(r=>r.json());if(r.error)throw Error(r.error);target.textContent=(r.blocks||[]).map(b=>place(b.locator)+'\n'+b.text).join('\n\n');window.__v2LastRead=r;}catch{target.textContent='原文暂不可读，请稍后重试。';}}
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
   box.append(make('small','记录状态：'+({unknown:'尚未核对',reference_only:'经验参考',verified:'来源已核对',verified_by_case:'个案记录支持'}[r.verificationStatus]||r.verificationStatus||'尚未核对')+' · '+r.resultStatus));
   if(r.applicability){const names={modelIds:'设备型号',chips:'芯片',scans:'扫描方式',pitches:'点间距',softwareVersions:'软件版本',firmwareVersions:'固件版本',hardwareVersions:'硬件版本',software:'软件名称',faultScope:'故障范围',temporalPattern:'发生频率',recentOperations:'最近操作','denial-not-confirmed-in-record':'已排除方向的依据'};box.append(make('small',r.applicability.status==='conditional-reference'?'需核对条件后参考':'可直接对照原记录（不是诊断结论）'));if(r.applicability.missingFields.length)box.append(make('small','还需核对：'+r.applicability.missingFields.map(k=>names[k]||k).join('、')));}
   const original=make('details');original.append(make('summary',r.excerptKind==='existing-case-index-excerpt'?'既有案例摘录及出处（原件链接尚未建立）':'原文摘录及出处'),make('pre',r.sourceExcerpt||'原文摘录缺失'));
   for(const s of r.sources||[]){original.append(make('small',s.name+' · '+place(s.locator)));link(original,s.original,'查看原件');}box.append(original);
   if(r.missingEvidence)box.append(make('small','仍需核对：'+r.missingEvidence));
  }else{
   box.append(make('small',place(r.locator)+' · '+((r.versions||[]).join('、')||'版本未明确')));
   if(r.text)box.append(make('pre',r.text));
   if(r.mentionedModels?.length)box.append(make('small','正文提及：'+r.mentionedModels.join('、')+'（不代表兼容性确认）'));
   link(box,r.download,'打开原文件');
   if(r.readUrl){const button=make('button','阅读上下文'),more=make('pre');button.type='button';button.onclick=()=>read(r.readUrl,more);box.append(button,more);}
  }return box;
 }
 const toolbar=make('div');toolbar.className='v2-toolbar';const mode=make('select');mode.id='v2WorkMode';
 for(const [value,label]of [['all','资料与操作检索'],['cases','历史售后案例'],['ordering','工程配单']]){const o=make('option',label);o.value=value;mode.append(o);}
 const reset=make('button','新查询');reset.type='button';reset.id='v2NewQuery';reset.onclick=()=>{localStorage.setItem('xhj_sid','w-'+crypto.randomUUID());chatHistory=[];triagePath=null;lastNumericOptions=null;window.__v2LastReply=null;document.getElementById('aiMessages').replaceChildren();};
 toolbar.append(make('span','V2 · 无模型'),mode,reset);document.querySelector('.ai-input-row').before(toolbar);
 const help=make('details');help.className='v2-order-help';help.hidden=true;help.append(make('summary','配单输入示例与范围'),make('p','填写点间距、模组像素、扫描、接口、模组排列及接收卡。未核实的条件不会自动放行。也可提交标准需求JSON。'),make('code','配单 P2 模组160x80 40扫 HUB75 全彩 室内 同步接收卡 10宽8高 R716'));toolbar.after(help);
 const conditions=make('details');conditions.id='v2Conditions';conditions.append(make('summary','已知现场条件（可选，不填写代表未知）'));const factInputs={};
 for(const [key,label]of [['modelIds','设备型号'],['chips','芯片'],['scans','扫描方式'],['pitches','点间距'],['softwareVersions','软件版本'],['firmwareVersions','固件版本'],['hardwareVersions','硬件版本'],['faultScope','故障范围：局部/整屏'],['temporalPattern','间歇/持续'],['timeRelations','时间关系，如升级后'],['recentOperations','最近操作'],['knownNormal','明确正常的条件'],['knownAbnormal','明确异常的条件'],['deniedInformation','明确排除的原因或条件']]){const field=make('input');field.placeholder=label;field.dataset.fact=key;factInputs[key]=field;conditions.append(field);}
 const checkAction=make('input'),checkResult=make('input');checkAction.placeholder='已做的检查';checkResult.placeholder='该检查的实际结果';conditions.append(checkAction,checkResult);
 const originalMessage=make('textarea');originalMessage.maxLength=8000;originalMessage.rows=3;originalMessage.placeholder='原始客户完整描述（可选）；上方输入框填写检索词，原话单独保存，不改写。';originalMessage.style.width='100%';conditions.append(originalMessage);
 const continuation=make('input');continuation.type='checkbox';continuation.id='v2ContinueQuery';const cl=make('label','将本轮文字作为上一轮的补充检索');cl.prepend(continuation);conditions.append(cl);toolbar.after(conditions);
 const facts=()=>Object.fromEntries(Object.entries(factInputs).map(([key,input])=>[key,input.value.split(/[;；、]/).map(s=>s.trim()).filter(Boolean)]));
 const modeChange=()=>{help.hidden=mode.value!=='ordering';conditions.hidden=mode.value!=='cases';document.getElementById('aiInput').placeholder=mode.value==='ordering'?'输入完整工程需求，或标准需求JSON':mode.value==='cases'?'输入故障现象、准确型号或版本':'输入型号、文件名、软件功能或正文关键词';};mode.onchange=modeChange;modeChange();
 reset.addEventListener('click',()=>{for(const input of Object.values(factInputs))input.value='';checkAction.value='';checkResult.value='';originalMessage.value='';continuation.checked=false;});
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
  if(!text.trim()||button.disabled)return;const sessionId=getSid();input.value='';input.disabled=true;button.disabled=true;reset.disabled=true;mode.disabled=true;addUserMessage(display||text);addAssistantLoading(mode.value==='ordering'?'计算并校验方案…':'检索资料…');
  try{const response=await window.fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,sessionId})}).then(r=>r.json());if(getSid()!==sessionId)return;removeLoading();window.addAssistantMessage(response);chatHistory.push({role:'user',content:text},{role:'assistant',content:response.reply||''});}
  catch{removeLoading();window.addAssistantMessage({model:'v2-offline-search',reply:'请求未完成，请稍后重试。'});}finally{input.disabled=false;button.disabled=false;reset.disabled=false;mode.disabled=false;input.focus();}};
 // V2 fixes the legacy imageId block-scope bug without editing the V1 frontend.
 window.sendImageMessage=async dataUrl=>{ocrState={dataUrl,text:'',busy:true};reset.disabled=true;mode.disabled=true;document.getElementById('aiSendBtn').disabled=true;document.getElementById('aiInput').disabled=true;addUserMessage('',dataUrl);addAssistantLoading('本地识别图片文字…');
  try{const r=await fetchOriginal('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:dataUrl})}).then(r=>r.json());window.__v2LastOCR=r;removeLoading();
   if(!r.ok||!r.text){window.addAssistantMessage({model:'v2-offline-search',reply:r.message||'图片未识别到文字，请输入文字。'});return;}
   if(r.text.length>240){originalMessage.value=r.text.slice(0,8000);conditions.hidden=false;conditions.open=true;window.addAssistantMessage({model:'v2-offline-search',reply:'已识别文字并放入原始描述栏，完整识别结果已本地留存。请输入简短检索词后查询。'});return;}
   addAssistantLoading('检索资料…');const body={message:r.text,sessionId:getSid(),facts:facts(),images:[r.imageId]},response=await window.fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());removeLoading();window.addAssistantMessage(response);
  }catch{removeLoading();window.addAssistantMessage({model:'v2-offline-search',reply:'本地图片识别未完成，可继续文字查询。'});}finally{ocrState={dataUrl:null,text:'',busy:false};reset.disabled=false;mode.disabled=false;document.getElementById('aiSendBtn').disabled=false;document.getElementById('aiInput').disabled=false;}};
 const quick=make('select');quick.id='v2SearchMode';quick.className='v2-toolbar';
 for(const [value,label]of [['products','产品速查（参数/软件/固件/视频）'],['all','全部原始资料'],['files','文件与目录'],['text','文档正文'],['cases','历史故障案例']]){const o=make('option',label);o.value=value;quick.append(o);}
 document.getElementById('quickSearchInput').before(quick);
 async function search(){const q=document.getElementById('quickSearchInput').value.trim(),out=document.getElementById('searchResults');out.style.display='block';out.replaceChildren(make('p','检索中…'));if(!q){out.replaceChildren(make('p','请输入型号或检索词。'));return;}
  try{const endpoint=quick.value==='cases'?'cases':'search',r=await fetchOriginal('/v2/offline/'+endpoint+'?q='+encodeURIComponent(q)+'&mode='+(quick.value==='cases'?'all':quick.value)).then(r=>r.json());if(r.error)throw Error(r.error);
   window.__v2LastSearch=r;out.replaceChildren(make('p',r.results.length+' 条'+(r.rawEvidence?.length?'历史记录，'+r.rawEvidence.length+' 条原文':'')+(r.elapsedMs!==undefined?' · '+r.elapsedMs+' ms':'')));
   if(!r.results.length)out.append(make('p','未找到资料，请核对完整型号、版本或更换关键词。'));
   for(const hit of r.results)out.append(card(hit,quick.value==='cases'));
   if(r.rawEvidence?.length){out.append(make('h4','相关原始资料（不等于已核验案例）'));for(const hit of r.rawEvidence)out.append(card(hit));}
  }catch{out.replaceChildren(make('p','资料服务暂不可用，可切回产品速查继续使用。'));}}
 document.getElementById('quickSearchBtn').addEventListener('click',e=>{if(quick.value==='products')return;e.preventDefault();e.stopImmediatePropagation();search();},true);
 document.getElementById('quickSearchInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&quick.value!=='products'){e.preventDefault();e.stopImmediatePropagation();search();}},true);
})();
