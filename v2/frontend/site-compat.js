'use strict';
// V2-only response presentation. The shared legacy frontend remains read-only.
(() => {
 const previousText=window.assistantTextOf,previousRender=window.addAssistantMessage;
 window.assistantTextOf=function(data){return data.model==='v2-rules'&&data.result?.bom?data.reply||'':previousText(data);};
 window.addAssistantMessage=function(data){
  if(data.model!=='v2-rules'||data.status!=='answer'||!data.result?.bom)return previousRender(data);
  const row=document.createElement('div');row.className='ai-msg ai-msg-assistant';
  const bubble=document.createElement('div');bubble.className='ai-msg-bubble';bubble.appendChild(renderV2Ordering(data.result));
  row.appendChild(bubble);const messages=document.getElementById('aiMessages');messages.appendChild(row);messages.scrollTop=messages.scrollHeight;
 };
})();
