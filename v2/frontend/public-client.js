'use strict';
window.PublicClient=Object.freeze({create(ui){
 let conversationId=null,busy=false,generation=0,pendingRequest=null,modelAvailable=false;const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const tools=make('div');tools.className='ai-input-hint v2-toolbar';const label=make('label','回答模式 '),select=make('select');select.setAttribute('aria-label','回答模式');
 for(const [value,text]of [['quick','快速回答'],['expert','专家问答']]){const option=make('option',text);option.value=value;select.append(option);}label.append(select);tools.append(label);
 const status=make('span',' 正在检查专家模型…');status.setAttribute('role','status');tools.append(status);
 const refresh=make('button','检查模型'),reset=make('button','新咨询');refresh.type=reset.type='button';reset.id='v2PublicNewQuery';tools.append(refresh,reset);document.querySelector('.ai-composer').prepend(tools);
 document.querySelector('.ai-hint').textContent='根据已批准公开的资料回答；内部资料与全文检索不对公网开放。';
 const welcome=document.querySelector('#aiMessages .ai-msg-bubble');if(welcome)welcome.textContent='你好，我是小灰机。可以咨询产品参数、资料和操作问题；专家问答仅引用已批准公开的证据。';
 document.getElementById('quickMoreDocsBtn')?.remove();document.querySelectorAll('#quickCats [data-cat=other],#quickCats [data-cat=pending]').forEach(e=>e.remove());
 document.getElementById('aiImgBtn').hidden=true;ui.input.disabled=false;ui.sendButton.disabled=false;ui.input.placeholder='请输入产品型号或问题…';
 async function refreshModel(){refresh.disabled=true;try{const response=await fetch('/api/ai/capabilities');if(!response.ok)throw Error('unavailable');const c=await response.json();modelAvailable=c.expert?.available===true;status.textContent=modelAvailable?' 专家模型已连接':' 专家模型未连接；快速回答可用';}catch{modelAvailable=false;status.textContent=' 模型状态暂不可用；可重新检查';}finally{refresh.disabled=false;}}
 refresh.onclick=refreshModel;refreshModel();
 function resetConversation(){generation++;conversationId=null;pendingRequest?.abort();pendingRequest=null;}
 reset.onclick=()=>{resetConversation();ui.setSessionId?.(window.createV2SessionId());ui.resetState?.();ui.state.history=[];ui.messages.replaceChildren();ui.input.value='';ui.resizeInput?.();ui.scrollChatToBottom?.();if(!busy)ui.input.focus({preventScroll:true});};
 return {legacy:false,allowImages:()=>false,
  loadingLabel:()=>select.value==='expert'?'正在阅读资料并分析…':'检索公开资料…',
  async request(body){const requestGeneration=generation,requestSession=ui.getSessionId?.(),controller=new AbortController();pendingRequest=controller;try{const r=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({message:body.message,mode:select.value,conversationId})});let data;try{data=await r.json();}catch{throw Error('服务返回格式异常，请稍后重试');}if(requestGeneration!==generation||ui.getSessionId?.()!==requestSession)throw Error('该咨询已结束');if(!r.ok)throw Error(data.reply||'服务暂不可用，请稍后重试');if(data.conversationId)conversationId=data.conversationId;return data;}finally{if(pendingRequest===controller)pendingRequest=null;}},
  render(data){const row=make('div');row.className='ai-msg ai-msg-assistant';const bubble=make('div');bubble.className='ai-msg-bubble';const text=make('div',data.reply||'本次未获得回答，请重试。');text.style.whiteSpace='pre-wrap';bubble.append(text);
   for(const r of data.results||[]){if(typeof r.download!=='string'||!r.download.startsWith('https://'))continue;const line=make('p'),a=make('a',r.name||'来源资料');a.href=r.download;a.target='_blank';a.rel='noopener noreferrer';line.append(a);if(r.location)line.append(make('small',' · '+r.location));bubble.append(line);}
   if(data.interpretation?.corrections?.length)bubble.append(make('small','按以下词义检索：'+data.interpretation.corrections.map(c=>c.from+' → '+c.to).join('、')+'；原话已保留。'));
   if(data.expertSuggestion?.recommended){const notice=make('p',data.expertSuggestion.reason),button=make('button',data.expertSuggestion.label||'请专家继续分析'),sourceConversation=conversationId,sourceGeneration=generation;button.type='button';button.className='v2-expert-handoff';button.onclick=async()=>{if(busy||sourceConversation!==conversationId||sourceGeneration!==generation)return;if(!modelAvailable){await refreshModel();if(!modelAvailable||busy||sourceConversation!==conversationId||sourceGeneration!==generation)return;}select.value='expert';await window.FrontendApp.chat.send(data.expertSuggestion.message,'请专家结合上文继续分析');};bubble.append(notice,button);}
   row.append(bubble);ui.messages.append(row);ui.scrollChatToBottom?.();return true;},
  reset:resetConversation,setBusy(value){busy=value;select.disabled=value;}
 };
}});
