// Browser-local ordinary history; temporary conversations never enter this store.
(() => {
 'use strict';
 const requestedScope=new URLSearchParams(location.search).get('mode');
 const scope=['ordering','cases'].includes(requestedScope)?requestedScope:'all';
 const STORE='xhj_v2_conversations_v1',ACTIVE='xhj_v2_active_conversation_'+scope;
 const id=()=> 'w-'+crypto.randomUUID();
 let items=[];
 try{const value=JSON.parse(localStorage.getItem(STORE)||'[]');if(Array.isArray(value))items=value.filter(x=>x&&typeof x.id==='string'&&Array.isArray(x.turns)).slice(0,20);}catch{}
 let activeId;try{activeId=sessionStorage.getItem(ACTIVE);}catch{}
 let current=items.find(x=>x.id===activeId&&(x.mode||'all')===scope)||{id:id(),turns:[],fields:{},draft:'',mode:scope};
 let normalId=current.id,temporary=false,restoring=false,timer;
 window.__v2SessionId=current.id;
 window.addEventListener('DOMContentLoaded',()=>{
  const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const messages=document.getElementById('aiMessages'),input=document.getElementById('aiInput'),send=document.getElementById('aiSendBtn'),tempButton=document.getElementById('v2NewQuery'),toolbar=tempButton.parentElement,mode=document.getElementById('v2WorkMode');
  const normalButton=make('button','普通对话'),historyButton=make('button','历史对话');normalButton.type=historyButton.type='button';normalButton.id='v2NormalConversation';historyButton.id='v2ConversationHistory';
  const controls=make('div');controls.className='v2-conversation-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','对话保存方式');controls.append(normalButton,tempButton,historyButton);
  const status=make('p');status.className='v2-conversation-status';status.setAttribute('role','status');toolbar.before(controls,status);
  const dialog=make('dialog');dialog.className='v2-history-dialog';dialog.setAttribute('aria-labelledby','v2HistoryTitle');const title=make('h3','历史对话');title.id='v2HistoryTitle';const close=make('button','关闭');close.type='button';close.onclick=()=>dialog.close();const head=make('header');head.append(title,close);const list=make('div');list.className='v2-history-list';const create=make('button','新建普通对话');create.type='button';dialog.append(head,make('p','仅此浏览器可见，最多20段，每段最近80条文字。图片和资料卡片需重新查询。'),list,create);document.body.append(dialog);
  const liveNodes=new Map();let storageError=false,normalRecord=current;
  const fields=()=>[...document.querySelectorAll('#v2Conditions input,#v2Conditions textarea')];
  const fieldKey=(e,i)=>e.dataset.fact||e.id||'field-'+i;
  function notice(){normalButton.setAttribute('aria-pressed',String(!temporary));tempButton.setAttribute('aria-pressed',String(temporary));status.textContent=temporary?'临时对话 · 不加入前端历史；离开或刷新后清空。后端仍可能保存会话和日志。':storageError?'普通对话 · 浏览器保存失败，请勿依赖历史恢复。':'普通对话 · '+(current.title||'尚未开始')+' · 仅保存在此浏览器';}
  function write(){try{localStorage.setItem(STORE,JSON.stringify(items));storageError=false;}catch{storageError=true;}notice();}
  function remember(){clearTimeout(timer);if(temporary||restoring)return;
   current.draft=input.value;current.mode=mode.value;current.fields=Object.fromEntries(fields().map((e,i)=>[fieldKey(e,i),e.type==='checkbox'?e.checked:e.value]));current.updated=Date.now();
   liveNodes.set(current.id,[...messages.childNodes]);
   if(current.turns.length){const first=current.turns.find(x=>x.role==='user');current.title=(first?.text||'普通对话').slice(0,40);items=[current,...items.filter(x=>x.id!==current.id)].slice(0,20);write();}
   try{sessionStorage.setItem(ACTIVE,current.id);}catch{}
  }
  function later(){if(!temporary&&!restoring){clearTimeout(timer);timer=setTimeout(remember,150);}}
  function show(record,isTemporary){clearTimeout(timer);restoring=true;temporary=isTemporary;current=record;window.__v2SessionId=record.id;
   chatHistory=[];triagePath=null;lastNumericOptions=null;window.__v2LastReply=null;clearOcrImage();input.value=record.draft||'';mode.value=['all','cases','ordering'].includes(record.mode)?record.mode:'all';modeChangeDisplay();
   fields().forEach((e,i)=>{const v=record.fields?.[fieldKey(e,i)];if(e.type==='checkbox')e.checked=!!v;else e.value=typeof v==='string'?v:'';});
   const nodes=liveNodes.get(record.id);messages.replaceChildren(...(nodes||[]));
   if(!nodes){for(const turn of record.turns){if(turn.role==='user')window.addUserMessage(turn.text);else window.addAssistantMessage({model:'v2-offline-search',reply:turn.text});}}
   chatHistory=record.turns.map(t=>({role:t.role,content:t.text}));document.querySelector('.v2-feedback').textContent='';messages.scrollTop=messages.scrollHeight;restoring=false;notice();input.focus();
  }
  function modeChangeDisplay(){document.querySelector('.v2-order-help').hidden=mode.value!=='ordering';document.getElementById('v2Conditions').hidden=mode.value!=='cases';input.placeholder=mode.value==='ordering'?'输入完整工程需求，或标准需求JSON':mode.value==='cases'?'输入故障现象、准确型号或版本':'输入型号、文件名、软件功能或正文关键词';}
  const userMessage=window.addUserMessage,assistantMessage=window.addAssistantMessage;
  window.addUserMessage=function(text,...args){const result=userMessage.call(this,text,...args);if(!restoring){current.turns.push({role:'user',text:typeof text==='string'&&text?text:'图片消息（图片不保存在前端历史）'});later();}return result;};
  window.addAssistantMessage=function(data){const result=assistantMessage.call(this,data);if(!restoring){current.turns.push({role:'assistant',text:String(data.reply||data.clarifyQuestion||'结果已返回，详细资料或工程方案请重新查询。').slice(0,8000)});current.turns=current.turns.slice(-80);later();}return result;};
  window.v2Conversations={startTemporary(){if(send.disabled)return;remember();if(temporary)liveNodes.delete(current.id);else{normalId=current.id;normalRecord=current;}show({id:id(),turns:[],fields:{},draft:'',mode:mode.value},true);}};
  normalButton.onclick=()=>{if(send.disabled||!temporary)return;liveNodes.delete(current.id);const record=items.find(x=>x.id===normalId)||normalRecord;show(record,false);};
  historyButton.onclick=()=>{if(send.disabled)return;remember();list.replaceChildren();if(!items.length)list.append(make('p','还没有普通对话记录。'));for(const item of items){const button=make('button');button.type='button';button.append(make('strong',item.title||'普通对话'),make('small',new Date(item.updated).toLocaleString()));button.onclick=()=>{if(temporary)liveNodes.delete(current.id);normalId=item.id;normalRecord=item;show(item,false);dialog.close();remember();};list.append(button);}dialog.showModal();};
  create.onclick=()=>{if(temporary)liveNodes.delete(current.id);normalId=id();normalRecord={id:normalId,turns:[],fields:{},draft:'',mode:mode.value};show(normalRecord,false);dialog.close();remember();};
  const busy=()=>{normalButton.disabled=historyButton.disabled=send.disabled;};new MutationObserver(busy).observe(send,{attributes:true,attributeFilter:['disabled']});busy();
  input.addEventListener('input',later);document.getElementById('v2Conditions').addEventListener('input',later);
  window.addEventListener('pagehide',()=>{if(temporary)leaveTemporary();else remember();});
  window.addEventListener('storage',e=>{if(e.key!==STORE)return;try{const records=JSON.parse(e.newValue||'[]');if(Array.isArray(records))items=records.filter(x=>x&&typeof x.id==='string'&&Array.isArray(x.turns)).slice(0,20);}catch{}});
  // Leaving a temporary conversation discards it even when a request is pending.
  function leaveTemporary(){liveNodes.delete(current.id);show(items.find(x=>x.id===normalId)||normalRecord,false);}
  new MutationObserver(()=>{if(document.body.dataset.view!=='ai'&&temporary)leaveTemporary();}).observe(document.body,{attributes:true,attributeFilter:['data-view']});
  const originalRecord=current;
  if(originalRecord.turns.length){show(originalRecord,false);}else{current.mode=mode.value;notice();}
  remember();
 });
})();
