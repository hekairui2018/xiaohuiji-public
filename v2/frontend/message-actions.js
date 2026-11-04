// Message presentation only. No model requests, hidden prompts or history rewriting.
(() => {
 'use strict';
 const messages=document.getElementById('aiMessages'),input=document.getElementById('aiInput');
 if(!messages||!input)return;
 const paths={copy:'M9 9h11v11H9z M5 15H3V3h12v2',edit:'m15 4 5 5 M4 20l4-1L20 7l-5-5L3 14z',up:'M7 10v11H3V10z M7 10l5-8c3 0 2 5 2 6h5c2 0 2 2 2 3l-2 9H7',down:'M7 14V3H3v11z M7 14l5 8c3 0 2-5 2-6h5c2 0 2-2 2-3l-2-9H7',voice:'M10 5 5 9H2v6h3l5 4z M15 8q5 4 0 8 M18 4q9 8 0 16',more:'M4 12h.01 M12 12h.01 M20 12h.01'};
 const status=document.createElement('div');status.className='v2-message-action-notice';status.setAttribute('role','status');document.body.append(status);let noticeTimer,speaking;
 function notify(text){status.textContent=text;status.classList.add('visible');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>status.classList.remove('visible'),2600);}
 function textOf(row){const bubble=row.querySelector('.ai-msg-bubble');if(!bubble)return '';const clone=bubble.cloneNode(true);clone.querySelectorAll('.v2-answer-process,.v2-answer-time,button,script,style').forEach(n=>n.remove());return clone.textContent.trim();}
 function exportText(row){
  const bubble=row.querySelector('.ai-msg-bubble');if(!bubble)return '';
  const clone=bubble.cloneNode(true);clone.querySelectorAll('.v2-answer-process,.v2-answer-time,button,script,style').forEach(n=>n.remove());
  for(const link of clone.querySelectorAll('a[href]')){try{const url=new URL(link.getAttribute('href'),location.href);if(!['http:','https:'].includes(url.protocol))continue;const label=link.getAttribute('aria-label')||link.title||link.textContent.trim()||'链接';link.replaceWith(document.createTextNode('\n'+label+'：'+url.href+'\n'));}catch{}}
  for(const br of clone.querySelectorAll('br'))br.replaceWith(document.createTextNode('\n'));
  for(const block of [...clone.querySelectorAll('p,div,article,section,details,summary,li,pre,tr,h1,h2,h3,h4,strong,small')].reverse()){block.before(document.createTextNode('\n'));block.after(document.createTextNode('\n'));}
  return clone.textContent.replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 }
 function draft(text){if(!text){notify('这条消息没有可编辑的文字');return;}input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);notify('已放入输入框，修改后发送；原消息保留');}
 function button(kind,label,action){const b=document.createElement('button');b.type='button';b.title=b.ariaLabel=label;b.dataset.messageAction=kind;b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[kind]+'"/></svg>';b.onclick=action;return b;}
 function stopSpeech(){window.speechSynthesis?.cancel();if(speaking){speaking.setAttribute('aria-pressed','false');speaking.title=speaking.ariaLabel='朗读回答';speaking=null;}}
 function decorate(row){
  if(row.id==='aiLoading'||row.querySelector(':scope > .v2-message-actions')||!row.querySelector('.ai-msg-bubble'))return;
  const own=row.classList.contains('ai-msg-user'),bar=document.createElement('div');bar.className='v2-message-actions';bar.setAttribute('role','group');bar.setAttribute('aria-label',own?'我的消息操作':'小灰机回答操作');
  bar.append(button('copy','复制',async()=>{try{await navigator.clipboard.writeText(textOf(row));notify('已复制');}catch{notify('复制未完成，请选中文字复制');}}));
  if(own)bar.append(button('edit','编辑',()=>draft(textOf(row))));
  else{
   for(const [kind,label]of [['up','有帮助'],['down','没帮助']]){const b=button(kind,label+'（本机标记）',()=>{const value=row.dataset.localFeedback===kind?'':kind;row.dataset.localFeedback=value;for(const other of bar.querySelectorAll('[data-message-action="up"],[data-message-action="down"]'))other.setAttribute('aria-pressed',String(other.dataset.messageAction===value));notify(value?'已在本机标记'+label:'已取消标记');});b.setAttribute('aria-pressed','false');bar.append(b);}
   if('speechSynthesis'in window&&'SpeechSynthesisUtterance'in window){const voice=button('voice','朗读回答',()=>{if(speaking===voice){stopSpeech();return;}stopSpeech();const text=textOf(row);if(!text)return;const utterance=new SpeechSynthesisUtterance(text);utterance.lang='zh-CN';speaking=voice;voice.setAttribute('aria-pressed','true');voice.title=voice.ariaLabel='停止朗读';utterance.onend=utterance.onerror=()=>{if(speaking===voice){voice.setAttribute('aria-pressed','false');voice.title=voice.ariaLabel='朗读回答';speaking=null;}};speechSynthesis.speak(utterance);});voice.setAttribute('aria-pressed','false');bar.append(voice);}
   const menu=document.createElement('div');menu.className='v2-message-menu';menu.hidden=true;
   const more=button('more','更多操作',()=>{const open=menu.hidden;closeMenus();menu.hidden=!open;more.setAttribute('aria-expanded',String(open));});more.setAttribute('aria-expanded','false');
   const again=document.createElement('button');again.type='button';again.textContent='重新提问';again.onclick=()=>{let previous=row.previousElementSibling;while(previous&&!previous.classList.contains('ai-msg-user'))previous=previous.previousElementSibling;if(previous)draft(textOf(previous));else notify('没有找到对应的客户消息');closeMenus();};
   const save=document.createElement('button');save.type='button';save.textContent='保存回答为文本';save.onclick=()=>{const url=URL.createObjectURL(new Blob([exportText(row)],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='小灰机回答.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);closeMenus();};menu.append(again,save);bar.append(more,menu);
  }
  const at=row.dataset.messageAt,date=new Date(at||'');if(at&&Number.isFinite(date.getTime())){const time=document.createElement('time');time.dateTime=at;time.title=date.toLocaleString('zh-CN',{hour12:false});time.textContent=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});bar.append(time);}
  row.classList.add('v2-action-message');row.append(bar);
 }
 function closeMenus(){for(const menu of messages.querySelectorAll('.v2-message-menu')){menu.hidden=true;menu.parentElement.querySelector('[data-message-action="more"]').setAttribute('aria-expanded','false');}}
 document.addEventListener('click',e=>{if(!e.target.closest('.v2-message-actions'))closeMenus();});
 messages.addEventListener('keydown',e=>{if(e.key==='Escape'){const bar=e.target.closest('.v2-message-actions');closeMenus();bar?.querySelector('[data-message-action="more"]')?.focus();}});
 new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.matches('.ai-msg'))decorate(node);for(const row of node.querySelectorAll('.ai-msg'))decorate(row);}if(speaking&&!speaking.isConnected)stopSpeech();}).observe(messages,{childList:true,subtree:true});
 messages.querySelectorAll('.ai-msg').forEach(decorate);window.addEventListener('pagehide',stopSpeech);
})();
