'use strict';
// The only text/OCR send lifecycle. Channels supply request data and presentation, never replace browser functions.
window.ChatController = Object.freeze({create(ui, channel = {}) {
 const legacy = channel.legacy !== false;
 const request = channel.request || (async body => {
  const response = await fetch('/api/ai/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  return response.json();
 });
 let sending = false;
 let composing = false;
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
  if(data.actualMode==='expert'&&summary?.version===1&&Array.isArray(summary.steps)&&summary.steps.length){
   const details=document.createElement('details');details.className='v2-answer-process';
   const title=document.createElement('summary');title.textContent='查看处理过程';details.append(title);
   const list=document.createElement('ol');for(const step of summary.steps.slice(0,8)){if(typeof step.label!=='string'||typeof step.detail!=='string')continue;const item=document.createElement('li');const label=document.createElement('strong');label.textContent=step.label+'：';item.append(label,document.createTextNode(step.detail));list.append(item);}details.append(list);bubble.append(details);
  }
  const elapsed=Number.isFinite(data.clientElapsedMs)?data.clientElapsedMs:data.elapsedMs;
  if(Number.isFinite(elapsed)&&elapsed>=0){const time=document.createElement('div');time.className='v2-answer-time';time.textContent='耗时 '+(elapsed/1000).toFixed(1)+' s';bubble.append(time);}
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
