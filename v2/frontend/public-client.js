'use strict';
window.PublicClient=Object.freeze({create(ui){
 let conversationId=null;const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const tools=make('div');tools.className='ai-input-hint';const label=make('label','回答模式 '),select=make('select');select.setAttribute('aria-label','回答模式');
 for(const [value,text]of [['quick','快速回答'],['expert','专家问答']]){const option=make('option',text);option.value=value;select.append(option);}label.append(select);tools.append(label);
 const status=make('span',' 正在检查专家模型…');status.setAttribute('role','status');tools.append(status);document.querySelector('.ai-composer').prepend(tools);
 document.querySelector('.ai-hint').textContent='根据已批准公开的资料回答；内部资料与全文检索不对公网开放。';
 const welcome=document.querySelector('#aiMessages .ai-msg-bubble');if(welcome)welcome.textContent='你好，我是小灰机。可以咨询产品参数、资料和操作问题；专家问答仅引用已批准公开的证据。';
 document.getElementById('quickMoreDocsBtn')?.remove();document.querySelectorAll('#quickCats [data-cat=other],#quickCats [data-cat=pending]').forEach(e=>e.remove());
 document.getElementById('aiImgBtn').hidden=true;ui.input.disabled=false;ui.sendButton.disabled=false;ui.input.placeholder='请输入产品型号或问题…';
 fetch('/api/ai/capabilities').then(r=>r.json()).then(c=>{status.textContent=c.expert?.available?' 专家模型已连接':' 专家模型未连接；快速回答可用';}).catch(()=>{status.textContent=' 模型状态暂不可用';});
 return {legacy:false,allowImages:()=>false,
  async request(body){const r=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:body.message,mode:select.value,conversationId})});const data=await r.json();if(data.conversationId)conversationId=data.conversationId;return data;},
  render(data){const row=make('div');row.className='ai-msg ai-msg-assistant';const bubble=make('div');bubble.className='ai-msg-bubble';const text=make('div',data.reply||'本次未获得回答，请重试。');text.style.whiteSpace='pre-wrap';bubble.append(text);
   for(const r of data.results||[]){if(typeof r.download!=='string'||!r.download.startsWith('https://'))continue;const line=make('p'),a=make('a',r.name||'来源资料');a.href=r.download;a.target='_blank';a.rel='noopener noreferrer';line.append(a);bubble.append(line);}row.append(bubble);ui.messages.append(row);ui.scrollChatToBottom?.();return true;},
  reset(){conversationId=null;},setBusy(busy){select.disabled=busy;}
 };
}});
