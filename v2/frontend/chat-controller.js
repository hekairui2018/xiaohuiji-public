'use strict';
// The only text/OCR send lifecycle. Channels supply request data and presentation, never replace browser functions.
window.ChatController = Object.freeze({async readResponse(response,onText,onSummary){
 if(!(response.headers?.get('content-type')||'').includes('application/x-ndjson'))return response.json();
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',final;
 const line=value=>{if(!value.trim())return;const event=JSON.parse(value);if(event.type==='text'&&typeof event.text==='string')onText?.(event.text);if(event.type==='progress')onSummary?.(event.summary);if(event.type==='final')final=event.data;};
 try{for(;;){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});if(buffer.length>1024*1024)throw Error('回复数据过长');let at;while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at));buffer=buffer.slice(at+1);}}buffer+=decoder.decode();if(buffer.trim())line(buffer);if(!final)throw Error('回复中断，请重试');return final;}finally{reader.releaseLock();}
},create(ui, channel = {}) {
 const legacy = channel.legacy !== false;
 const request = channel.request || (async body => {
  const response = await fetch('/api/ai/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  return window.ChatController.readResponse(response,text=>window.dispatchEvent(new CustomEvent('v2-answer-text',{detail:{sessionId:body.sessionId,text}})),summary=>window.dispatchEvent(new CustomEvent('v2-answer-summary',{detail:{sessionId:body.sessionId,summary}})));
 });
 let sending = false;
 let composing = false;
 ui.messages.addEventListener('v2-ordering-select',async event=>{
  const root=event.target,optionId=event.detail?.optionId;
  if(!Number.isSafeInteger(optionId)||optionId<1||sending||!root.matches?.('.v2-ordering-result'))return;
  const panels=ui.messages.querySelectorAll('.v2-ordering-result');
  if(panels[panels.length-1]!==root)return;
  const sessionId=ui.getSessionId();busy(true);
  const buttons=root.querySelectorAll('.v2-ordering-choices button');buttons.forEach(b=>b.disabled=true);
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='正在切换方案…';root.append(status);
  try{
   const response=await request(payload('配单方案：'+optionId,sessionId));
   if(ui.getSessionId()!==sessionId||!root.isConnected)return;
   if(!response.result?.plan&&!response.result?.nativeOrdering)throw Error(response.reply||'方案未能切换');
   const bubble=root.closest('.ai-msg-bubble'),description=bubble?.firstElementChild;
   if(description&&description!==root&&['DIV','P'].includes(description.tagName)&&typeof response.reply==='string')description.textContent=response.reply;
   root.replaceWith(renderV2Ordering(response.result));
   window.__v2LastReply=response;
  }catch(error){if(ui.getSessionId()===sessionId&&root.isConnected)status.textContent='切换失败：'+error.message;}
  finally{busy(false);buttons.forEach(b=>b.disabled=false);}
 });
 ui.input.addEventListener('compositionstart',()=>{composing=true;});
 ui.input.addEventListener('compositionend',()=>{composing=false;});
 ui.input.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.shiftKey||event.isComposing||composing||event.keyCode===229)return;
  event.preventDefault();if(!event.repeat)send();
 });
 function busy(value) {
  sending = value;
  ui.input.disabled = ui.sendButton.disabled = value;
  channel.setBusy?.(value);
 }
 function payload(text, sessionId, imageId) {
  return {message:text, sessionId, ...(legacy ? {history:ui.state.history.slice(-8),source:ui.isSelftestEnv()?'web-selftest':'quick-site'} : {}), ...(imageId ? {images:[imageId]} : {})};
 }
 async function query(text, sessionId, imageId) {
  const started=performance.now();
  const response = await request(payload(text, sessionId, imageId));
  response.clientElapsedMs=performance.now()-started;
  if (ui.getSessionId() !== sessionId) return false;
  ui.removeLoading();ui.addAssistantMessage(response);
  appendDetails(response);
  ui.state.history.push({role:'user',content:text},{role:'assistant',content:legacy?ui.assistantTextOf(response):response.reply||''});
  return true;
 }
 function appendDetails(data){
  const rows=ui.messages.querySelectorAll('.ai-msg-assistant');const bubble=rows[rows.length-1]?.querySelector('.ai-msg-bubble');if(!bubble)return;
  const summary=data.processingSummary;
  const comparison=data.parameterComparison;
  if(data.actualMode==='expert'&&Array.isArray(comparison?.models)&&comparison.models.length>1&&Array.isArray(comparison.rows)){
   const wrap=document.createElement('div');wrap.style.cssText='overflow-x:auto;max-width:100%;margin:12px 0';
   const table=document.createElement('table');table.className='v2-parameter-comparison';table.style.cssText='border-collapse:collapse;width:100%;font-size:13px';
   const head=document.createElement('tr');for(const text of ['参数项',...comparison.models.map(m=>(m.brand||'')+' '+m.model)]){const cell=document.createElement('th');cell.textContent=text;cell.style.cssText='border:1px solid #dce5ec;padding:8px;text-align:left';head.append(cell);}table.append(head);
   for(const row of comparison.rows){const tr=document.createElement('tr');if(row.different)tr.style.background='#f0f7ff';for(const text of [row.parameter,...row.values.map(v=>v.value)]){const cell=document.createElement('td');cell.textContent=text;cell.style.cssText='border:1px solid #dce5ec;padding:8px;white-space:pre-wrap';tr.append(cell);}table.append(tr);}wrap.append(table);bubble.append(wrap);
  }
  if(data.actualMode==='expert'&&summary?.version===1&&Array.isArray(summary.steps)&&summary.steps.length){
   const details=document.createElement('details');details.className='v2-answer-process';
   const title=document.createElement('summary');title.textContent='查看处理过程';details.append(title);
   const list=document.createElement('ol');for(const step of summary.steps.slice(0,8)){if(typeof step.label!=='string'||typeof step.detail!=='string')continue;const item=document.createElement('li');const label=document.createElement('strong');label.textContent=step.label+'：';item.append(label,document.createTextNode(step.detail));list.append(item);}details.append(list);bubble.append(details);
  }
  const elapsed=Number.isFinite(data.clientElapsedMs)?data.clientElapsedMs:data.elapsedMs;
  if(Number.isFinite(elapsed)&&elapsed>=0){const time=document.createElement('div');time.className='v2-answer-time';time.textContent='耗时 '+(elapsed/1000).toFixed(1)+' s';const speed=data.generationSpeed;if(speed&&Number.isFinite(speed.tokensPerSecond)&&speed.tokensPerSecond>0){time.textContent+=' · '+(speed.kind==='decode'?'解码 ':'生成均速 ')+speed.tokensPerSecond.toFixed(1)+' Token/s'+(speed.includesThinking?'（含思考）':'');}bubble.append(time);}
 }
 let clock,clockStarted=0,clockSession;
 function recordProgress(label){
  if(!sending||clockSession!==ui.getSessionId()||typeof label!=='string')return;
  const loading=document.getElementById('aiLoading');if(!loading)return;
  let details=loading.querySelector('.v2-loading-process');
  if(!details){details=document.createElement('details');details.className='v2-answer-process v2-loading-process';details.open=true;const summary=document.createElement('summary');summary.textContent='处理进度';details.append(summary,document.createElement('ol'));loading.append(details);}
  const list=details.querySelector('ol');if(list.lastElementChild?.dataset.label===label)return;
  const row=document.createElement('li');row.dataset.label=label;row.textContent=label+' · '+((performance.now()-clockStarted)/1000).toFixed(1)+' s';list.append(row);
 }
 window.addEventListener('v2-answer-progress',event=>{if(event.detail?.sessionId===clockSession)recordProgress(event.detail.label);});
 window.addEventListener('v2-answer-summary',event=>{
  if(!sending||event.detail?.sessionId!==clockSession||ui.getSessionId()!==clockSession)return;
  const summary=event.detail.summary,loading=document.getElementById('aiLoading');if(!loading||summary?.version!==1||!Array.isArray(summary.steps))return;
  let details=loading.querySelector('.v2-live-summary');if(!details){details=document.createElement('details');details.className='v2-answer-process v2-live-summary';details.open=true;const title=document.createElement('summary');title.textContent='查看处理过程';details.append(title,document.createElement('ol'));loading.append(details);}
  const list=details.querySelector('ol');list.replaceChildren();for(const step of summary.steps.slice(0,8)){if(typeof step.label!=='string'||typeof step.detail!=='string')continue;const row=document.createElement('li'),label=document.createElement('strong');label.textContent=step.label+'：';row.append(label,document.createTextNode(step.detail));list.append(row);}
  const stages=loading.querySelector('.v2-loading-process');if(stages)stages.hidden=true;
 });
 window.addEventListener('v2-answer-text',event=>{
  if(!sending||event.detail?.sessionId!==clockSession||ui.getSessionId()!==clockSession)return;
  const loading=document.getElementById('aiLoading'),bubble=loading?.querySelector('.ai-msg-bubble');if(!bubble||typeof event.detail.text!=='string')return;
  loading.dataset.streaming='true';bubble.textContent=event.detail.text;bubble.style.whiteSpace='pre-wrap';
  recordProgress('正在生成回答');ui.followChatUpdates?.();
 });
 function startClock(){clearInterval(clock);clockStarted=performance.now();clockSession=ui.getSessionId();const update=()=>{const loading=document.getElementById('aiLoading');if(!loading)return;let timer=loading.querySelector('.v2-loading-time');if(!timer){timer=document.createElement('div');timer.className='v2-loading-time';loading.append(timer);}timer.textContent='已用时 '+((performance.now()-clockStarted)/1000).toFixed(1)+' s';};update();recordProgress('请求已发送');clock=setInterval(update,100);}
 async function send(value, display) {
  let text = typeof value==='string'?value:ui.input.value;
  if (legacy) text=text.trim();
  if (!text.trim() || sending || ui.sendButton.disabled) return;
  if (legacy && !ui.prepareLegacyMessage(text,value)) return;
  if (channel.validate?.(text)===false) return;
  channel.beforeSend?.();const sessionId=ui.getSessionId();
  const displayText=legacy?(display!==undefined?display:text.replace(/\[[A-Z_]+\]/g,'')).trim():display||text;
  ui.input.value='';ui.resizeInput?.();busy(true);ui.addUserMessage(displayText);ui.addLoading(channel.loadingLabel?.());startClock();const started=performance.now();
  try {await query(text,sessionId);}
  catch(error) {
   if (ui.getSessionId()!==sessionId) return;
   ui.removeLoading();
   ui.input.value=text;ui.resizeInput?.();
   if (!legacy) {ui.addAssistantMessage({model:'v2-offline-search',reply:'请求失败：'+error.message+'。输入已保留，可重试。'});appendDetails({clientElapsedMs:performance.now()-started});}
   else {const row=document.createElement('div');row.className='ai-msg ai-msg-assistant';const bubble=document.createElement('div');bubble.className='ai-msg-bubble';bubble.style.color='#c00';bubble.textContent='请求失败：'+error.message;row.append(bubble);ui.messages.append(row);}
  } finally {clearInterval(clock);busy(false);ui.resizeInput?.();ui.input.focus({preventScroll:true});}
 }
 async function sendImage(dataUrl) {
  if(channel.allowImages?.()===false)return;
  if (sending || ui.sendButton.disabled) return;
  channel.beforeSend?.();const sessionId=ui.getSessionId();
  ui.setImageState({dataUrl,text:'',busy:true});busy(true);ui.addUserMessage('',dataUrl);ui.addLoading(legacy?'识别图片中…':'本地识别图片文字…');
  try {
   const response=await fetch('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:dataUrl})});
   const result=await response.json();window.__v2LastOCR=result;
   if (ui.getSessionId()!==sessionId) return;
   ui.removeLoading();
   if (!response.ok || !result.ok || !result.text) {
    ui.addAssistantMessage({model:'v2-offline-search',reply:result.message||'图片未识别到文字，请输入文字。'});return;
   }
   if (channel.acceptOcr?.(result)===false) return;
   ui.addLoading(legacy?'思考中…':'检索资料…');startClock();await query(result.text,sessionId,result.imageId);
  } catch {
   if(ui.getSessionId()!==sessionId)return;
   ui.removeLoading();ui.addAssistantMessage({model:'v2-offline-search',reply:'本地图片识别未完成，可继续文字查询。'});
  } finally {clearInterval(clock);ui.setImageState({dataUrl:null,text:'',busy:false});busy(false);}
 }
 return Object.freeze({send,sendImage});
}});
