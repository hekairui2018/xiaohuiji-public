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
 let composing = false,sendVersion=0,activeQuery=null,activeSession=null,stopping=false,queuePaused=false;
 const waitingMessages=[],queuePanel=document.createElement('section');queuePanel.className='v2-message-queue';queuePanel.hidden=true;queuePanel.setAttribute('aria-label','候补消息');ui.input.parentElement.before(queuePanel);
 function renderQueue(){queuePanel.replaceChildren();const rows=waitingMessages.filter(q=>q.session===ui.getSessionId());queuePanel.hidden=!rows.length;if(!rows.length)return;const title=document.createElement('strong');title.textContent='候补消息 '+rows.length+' 条 · '+(queuePaused?'上次处理未完成，已暂停':'当前回答结束后依次发送');queuePanel.append(title);if(queuePaused){const resume=document.createElement('button');resume.type='button';resume.textContent='继续发送候补';resume.disabled=sending;resume.onclick=()=>{queuePaused=false;renderQueue();drainQueue();};queuePanel.append(resume);}for(const q of rows){const row=document.createElement('div'),text=document.createElement('span'),remove=document.createElement('button');text.textContent=q.text;text.title=q.text;remove.type='button';remove.textContent='移除';remove.setAttribute('aria-label','移除此条候补消息');remove.onclick=()=>{waitingMessages.splice(waitingMessages.indexOf(q),1);renderQueue();};row.append(text,remove);queuePanel.append(row);}}
 function enqueue(){const text=ui.input.value.trim();if(!text)return;if(channel.validate?.(text)===false)return;if(!sending){send();return;}waitingMessages.push({session:ui.getSessionId(),text});ui.input.value='';ui.resizeInput?.();renderQueue();}
 function drainQueue(){if(sending||queuePaused)return;const index=waitingMessages.findIndex(q=>q.session===ui.getSessionId());if(index<0)return;const next=waitingMessages.splice(index,1)[0];renderQueue();send(next.text,undefined,true);}
 ui.events?.addEventListener('session-change',renderQueue);
 ui.input.title='回车发送；回答中回车打断并重新处理；Ctrl＋回车加入候补；Shift＋回车换行';

 ui.messages.addEventListener('v2-ordering-select',async event=>{
  const root=event.target,optionId=event.detail?.optionId;
  if(!Number.isSafeInteger(optionId)||optionId<1||sending||!root.matches?.('.v2-ordering-result'))return;
  const panels=ui.messages.querySelectorAll('.v2-ordering-result');
  if(panels[panels.length-1]!==root)return;
  const sessionId=ui.getSessionId();busy(true);
  const buttons=root.querySelectorAll('.v2-ordering-choices button');buttons.forEach(b=>b.disabled=true);
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='正在切换方案…';root.append(status);
  let completed=false;
  try{
   const response=await request(payload('配单方案：'+optionId,sessionId));
   if(ui.getSessionId()!==sessionId||!root.isConnected)return;
   if(!response.result?.plan&&!response.result?.nativeOrdering)throw Error(response.reply||'方案未能切换');
   const bubble=root.closest('.ai-msg-bubble'),description=bubble?.firstElementChild;
   if(description&&description!==root&&['DIV','P'].includes(description.tagName)&&typeof response.reply==='string')description.textContent=response.reply;
   root.replaceWith(renderV2Ordering(response.result));
   window.__v2LastReply=response;
   completed=true;queuePaused=false;
  }catch(error){queuePaused=true;if(ui.getSessionId()===sessionId&&root.isConnected)status.textContent='切换失败：'+error.message;}
  finally{busy(false,completed);buttons.forEach(b=>b.disabled=false);}
 });
 ui.input.addEventListener('compositionstart',()=>{composing=true;});
 ui.input.addEventListener('compositionend',()=>{composing=false;});
 ui.input.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.shiftKey||event.isComposing||composing||event.keyCode===229)return;
  event.preventDefault();if(event.repeat)return;if(event.ctrlKey||event.metaKey)enqueue();else send();
 });
 function busy(value,completed=false) {
  sending = value;
  ui.input.disabled = false;
  ui.sendButton.disabled = value && !channel.interrupt;
  const hint=document.getElementById('aiInputHint');if(hint)hint.textContent=(value&&channel.interrupt?'Enter 打断重发':'Enter 发送')+' · Ctrl+Enter 候补 · Shift+Enter 换行';
  channel.setBusy?.(value);
  renderQueue();
  if(!value&&completed)queueMicrotask(drainQueue);
 }
 function payload(text, sessionId, imageId) {
  return {message:text, sessionId, ...(legacy ? {history:ui.state.history.slice(-8),source:ui.isSelftestEnv()?'web-selftest':'quick-site'} : {}), ...(imageId ? {images:[imageId]} : {})};
 }
 async function query(text, sessionId, imageId, ticket=sendVersion) {
  const started=performance.now();
  const response = await request(payload(text, sessionId, imageId));
  response.clientElapsedMs=performance.now()-started;
  if (ui.getSessionId() !== sessionId || ticket!==sendVersion) return false;
  answerStarted();ui.removeLoading();ui.addAssistantMessage(response);
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
  if(Number.isFinite(elapsed)&&elapsed>=0){const time=document.createElement('div');time.className='v2-answer-time';time.textContent='耗时 '+(elapsed/1000).toFixed(1)+' s';const speed=data.generationSpeed;if(speed&&Number.isFinite(speed.tokensPerSecond)&&speed.tokensPerSecond>0){time.textContent+=' · 累计处理 '+speed.tokens.toLocaleString()+' tokens · 平均输入 '+(Number.isFinite(speed.inputTokensPerSecond)?speed.inputTokensPerSecond.toFixed(1)+' tokens/s':'未返回')+' · 平均输出 '+speed.tokensPerSecond.toFixed(1)+' tokens/s';}bubble.append(time);}
 }
 let clock,clockStarted=0,clockSession,waitingRow=null,waitingObserver=null,waitStage='understanding',waitPhase=null,stageStarted=0,roundSeen=0,detailSignature='';
 const stagePhrases={queued:['正在排队等候…','前面的请求结束后会开始处理…'],understanding:['正在理解问题…','正在结合上文理解你的要求…'],searching:['正在检索资料…','正在查找与你的问题相关的资料…'],reading:['正在阅读原文…','正在核对原文中的条件和说明…'],'evidence-found':['已找到相关资料…','资料已取得，接着核对适用条件…'],composing:['正在整理本轮结果…','正在核对依据与回答内容…'],completed:['处理完成'],failed:['本次处理未完成']};
 const writeText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};
 function setPhase(stage,phase){if(!Object.hasOwn(stagePhrases,stage))return;const nextPhase=stage==='composing'?(phase||waitPhase):null;if(stage!==waitStage||nextPhase!==waitPhase){waitStage=stage;waitPhase=nextPhase;stageStarted=performance.now();}paintWaiting();if(stage==='completed'||stage==='failed')stopWaiting();}
 function paintWaiting(){const row=waitingRow;if(!row||!row.isConnected||row.dataset.active==='false'||row.dataset.streaming==='true')return;
  if(ui.getSessionId()!==clockSession){stopWaiting();return;}const now=performance.now(),elapsed=(now-clockStarted)/1000;if(row.dataset.stage!==waitStage)row.dataset.stage=waitStage;
  let phrases=stagePhrases[waitStage]||stagePhrases.understanding;if(waitStage==='composing'&&waitPhase)phrases=waitPhase==='reasoning'?['模型思考中…','正在分析本轮条件与已有资料…']:waitPhase==='answer'?['正在生成本轮结果…','正在整理并校验本轮结果…']:['正在读取输入…','正在处理本轮上下文…'];
  writeText(row.querySelector('.v2-stage-label'),phrases[now-stageStarted>=6000?1:0]||phrases[0]);
  const n=row.dataset.generatedTokens;writeText(row.querySelector('.v2-token-count'),n===undefined?'累计处理：等待计数':'累计处理 '+Number(n).toLocaleString()+' tokens');writeText(row.querySelector('.v2-elapsed'),'耗时 '+(Math.floor(elapsed*4)/4).toFixed(1)+' s');
  const hint=elapsed<8?'':elapsed<20?'回车打断并重新处理；Ctrl＋回车加入候补。':'还在处理。型号说错也没关系，直接补一句更正。';const tip=row.querySelector('.v2-wait-tip');writeText(tip,hint);tip.hidden=!hint;
 }
 function stopWaiting(){clearInterval(clock);clock=null;waitingObserver?.disconnect();waitingObserver=null;if(waitingRow&&waitingRow.dataset.active!=='false'){waitingRow.dataset.active='false';const dots=waitingRow.querySelector('.v2-wait-dots');if(dots)dots.hidden=true;}}
 function answerStarted(){document.body.dataset.v2AnswerVisible='true';window.dispatchEvent(new CustomEvent('v2-mascot-reset'));stopWaiting();const row=waitingRow;if(row){row.dataset.streaming='true';for(const node of row.children)if(!node.classList.contains('ai-msg-bubble'))node.hidden=true;}}
 window.addEventListener('v2-answer-progress',event=>{if(event.detail?.sessionId!==clockSession||!sending||waitingRow?.dataset.streaming==='true')return;const stage=event.detail.stage;if(stage)setPhase(stage);});
 window.addEventListener('v2-answer-summary',event=>{if(!sending||event.detail?.sessionId!==clockSession||ui.getSessionId()!==clockSession||waitingRow?.dataset.streaming==='true')return;const summary=event.detail.summary,row=waitingRow;if(!row?.isConnected||summary?.version!==1||!Array.isArray(summary.steps))return;
  const live=summary.liveGeneration,round=summary.steps.find(x=>x.label==='模型处理')?.detail?.match(/\d+/)?.[0];if(round&&Number(round)>roundSeen){roundSeen=Number(round);waitPhase=null;}
  if(live){setPhase('composing',live.phase);if(Number.isSafeInteger(live.generatedTokens))row.dataset.generatedTokens=String(live.generatedTokens);const rate=n=>Number.isFinite(n)?n.toFixed(1)+' tokens/s':'等待计数';writeText(row.querySelector('.v2-input-rate'),'输入 '+rate(live.inputTokensPerSecond));writeText(row.querySelector('.v2-output-rate'),'输出 '+rate(live.outputTokensPerSecond));}
  const signature=JSON.stringify(summary.steps);if(signature!==detailSignature){detailSignature=signature;const list=row.querySelector('.v2-live-facts');list.replaceChildren();for(const step of summary.steps.slice(0,8)){if(typeof step.label!=='string'||typeof step.detail!=='string')continue;const li=document.createElement('li');li.textContent=step.label+'：'+step.detail;list.append(li);}}
  paintWaiting();
 });
 window.addEventListener('v2-answer-text',event=>{if(!sending||event.detail?.sessionId!==clockSession||ui.getSessionId()!==clockSession||typeof event.detail.text!=='string'||!event.detail.text)return;const row=waitingRow,bubble=row?.querySelector('.ai-msg-bubble');if(!bubble)return;answerStarted();bubble.replaceChildren();bubble.textContent=event.detail.text;bubble.style.whiteSpace='pre-wrap';ui.followChatUpdates?.();});
 function startClock(){stopWaiting();clockStarted=performance.now();clockSession=ui.getSessionId();waitStage='understanding';waitPhase=null;stageStarted=clockStarted;roundSeen=0;detailSignature='';document.body.dataset.v2AnswerVisible='false';const row=document.getElementById('aiLoading');waitingRow=row;if(!row)return;row.dataset.active='true';row.dataset.streaming='false';
  const bubble=row.querySelector('.ai-msg-bubble');bubble.replaceChildren();bubble.setAttribute('role','status');bubble.setAttribute('aria-live','polite');const dots=document.createElement('span');dots.className='v2-wait-dots';dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)dots.append(document.createElement('i'));const button=document.createElement('button');button.type='button';button.className='v2-stage-toggle';button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','展开处理详情');const label=document.createElement('span');label.className='v2-stage-label';button.append(label);bubble.append(dots,button);
  const timer=document.createElement('div');timer.className='v2-loading-time';timer.setAttribute('aria-live','off');const count=document.createElement('span');count.className='v2-token-count';const elapsed=document.createElement('span');elapsed.className='v2-elapsed';timer.append(count,elapsed);
  const speed=document.createElement('div');speed.className='v2-loading-speed';speed.setAttribute('aria-live','off');for(const [cls,text]of [['v2-input-rate','输入：等待计数'],['v2-output-rate','输出：等待计数']]){const span=document.createElement('span');span.className=cls;span.textContent=text;speed.append(span);}
  const tip=document.createElement('div');tip.className='v2-wait-tip';tip.hidden=true;tip.setAttribute('aria-live','off');
  const details=document.createElement('details');details.className='v2-answer-process v2-live-summary';details.id='v2-live-details-'+Math.random().toString(36).slice(2);const title=document.createElement('summary');title.textContent='处理详情';const facts=document.createElement('ol');facts.className='v2-live-facts';details.append(title,facts);button.setAttribute('aria-controls',details.id);button.onclick=()=>{details.open=!details.open;};details.addEventListener('toggle',()=>{button.setAttribute('aria-expanded',String(details.open));button.setAttribute('aria-label',details.open?'收起处理详情':'展开处理详情');});
  row.append(timer,speed,tip,details);paintWaiting();clock=setInterval(paintWaiting,250);waitingObserver=new MutationObserver(()=>{if(!row.isConnected||ui.getSessionId()!==clockSession)stopWaiting();});waitingObserver.observe(ui.messages,{childList:true});
 }
 async function send(value, display, fromQueue=false) {
  let text = typeof value==='string'?value:ui.input.value;
  if (legacy) text=text.trim();
  if (!text.trim() || stopping || sending&&(!channel.interrupt||!activeQuery) || ui.sendButton.disabled) return;
  if (legacy && !ui.prepareLegacyMessage(text,value)) return;
  if (channel.validate?.(text)===false) return;
  const ticket=++sendVersion,sessionId=ui.getSessionId();
  const draftAtSend=ui.input.value;
  if(sending&&channel.interrupt){stopping=true;try{await channel.interrupt(activeSession);await activeQuery?.catch(()=>{});}catch(error){if(ticket===sendVersion){queuePaused=true;stopWaiting();ui.removeLoading();ui.setImageState({dataUrl:null,text:'',busy:false});activeQuery=null;busy(false);ui.addAssistantMessage({model:'v2-offline-search',reply:'前一条停止未确认：'+error.message+'。新消息仍在输入框，请稍后重试。'});}return;}finally{stopping=false;}ui.setImageState({dataUrl:null,text:'',busy:false});if(ticket!==sendVersion||ui.getSessionId()!==sessionId){activeQuery=null;busy(false);return;}ui.removeLoading();stopWaiting();}
  channel.beforeSend?.();
  const displayText=legacy?(display!==undefined?display:text.replace(/\[[A-Z_]+\]/g,'')).trim():display||text;
  if(!fromQueue&&ui.input.value===draftAtSend)ui.input.value='';ui.resizeInput?.();busy(true);ui.addUserMessage(displayText);ui.addLoading(channel.loadingLabel?.());startClock();const started=performance.now();let completed=false;
  try {activeSession=sessionId;activeQuery=query(text,sessionId,undefined,ticket);completed=await activeQuery;if(completed)queuePaused=false;}
  catch(error) {
   if (ui.getSessionId()!==sessionId||ticket!==sendVersion) return;
   queuePaused=true;stopWaiting();ui.removeLoading();
   if(!ui.input.value.trim())ui.input.value=text;ui.resizeInput?.();
   if (!legacy) {ui.addAssistantMessage({model:'v2-offline-search',reply:'请求失败：'+error.message+'。输入已保留，可重试。'});appendDetails({clientElapsedMs:performance.now()-started});}
   else {const row=document.createElement('div');row.className='ai-msg ai-msg-assistant';const bubble=document.createElement('div');bubble.className='ai-msg-bubble';bubble.style.color='#c00';bubble.textContent='请求失败：'+error.message;row.append(bubble);ui.messages.append(row);}
  } finally {if(ticket===sendVersion){activeQuery=null;stopWaiting();busy(false,completed);ui.resizeInput?.();ui.input.focus({preventScroll:true});}}
 }
 async function sendImage(dataUrl) {
  if(channel.allowImages?.()===false)return;
  if (sending || ui.sendButton.disabled) return;
  channel.beforeSend?.();const sessionId=ui.getSessionId(),ticket=++sendVersion;let completed=false;
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
   ui.addLoading(legacy?'思考中…':'检索资料…');startClock();activeSession=sessionId;activeQuery=query(result.text,sessionId,result.imageId,ticket);completed=await activeQuery;if(completed)queuePaused=false;
  } catch {
   if(ui.getSessionId()!==sessionId||ticket!==sendVersion)return;
   queuePaused=true;
   ui.removeLoading();ui.addAssistantMessage({model:'v2-offline-search',reply:'本地图片识别未完成，可继续文字查询。'});
  } finally {if(ticket===sendVersion){if(!completed)queuePaused=true;activeQuery=null;stopWaiting();ui.setImageState({dataUrl:null,text:'',busy:false});busy(false,completed);}}
 }
 return Object.freeze({send,sendImage});
}});
