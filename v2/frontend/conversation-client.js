// Browser-local ordinary history; temporary conversations never enter this store.
window.ConversationClient = Object.freeze({create(ui,channel) {
 'use strict';
 const {state,events,clearImage:clearOcrImage}=ui;
 const requestedScope=new URLSearchParams(location.search).get('mode');
 const scope=['ordering','cases'].includes(requestedScope)?requestedScope:'all';
 const STORE='xhj_v2_conversations_v1',ACTIVE='xhj_v2_active_conversation_'+scope;
 const id=()=> 'w-'+crypto.randomUUID();
 let items=[];
 try{const value=JSON.parse(localStorage.getItem(STORE)||'[]');if(Array.isArray(value))items=value.filter(x=>x&&typeof x.id==='string'&&Array.isArray(x.turns)).slice(0,20);}catch{}
 let activeId;try{activeId=sessionStorage.getItem(ACTIVE);}catch{}
 let current=items.find(x=>x.id===activeId&&(x.mode||'all')===scope)||{id:id(),turns:[],fields:{},draft:'',mode:scope};
 let normalId=current.id,temporary=false,restoring=false,timer;
 ui.setSessionId(current.id);

  const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const messages=document.getElementById('aiMessages'),input=document.getElementById('aiInput'),send=document.getElementById('aiSendBtn'),tempButton=document.getElementById('v2NewQuery'),toolbar=tempButton.parentElement,mode=document.getElementById('v2WorkMode');
  const normalButton=make('button','普通对话'),guestButton=make('button','访客对话');normalButton.type=guestButton.type='button';normalButton.id='v2NormalConversation';guestButton.id='v2GuestConversation';tempButton.hidden=true;
  const controls=make('div');controls.className='v2-conversation-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','对话保存方式');controls.append(normalButton,guestButton);
  toolbar.append(controls);
  const liveNodes=new Map();let storageError=false,normalRecord=current,replayAt;
  function messageTime(){
   const at=restoring?replayAt:new Date().toISOString(),date=new Date(at||'');
   if(!Number.isFinite(date.getTime()))return null;
   const row=messages.lastElementChild;if(!row||row.id==='aiLoading')return at;
   const previous=[...messages.querySelectorAll('.ai-msg[data-message-at]')].filter(node=>node!==row).at(-1),prior=new Date(previous?.dataset.messageAt||'');
   row.dataset.messageAt=at;row.title=date.toLocaleString('zh-CN',{hour12:false});
   if(!previous||!Number.isFinite(prior.getTime())||date.getTime()-prior.getTime()>=300000||date.toDateString()!==prior.toDateString()){
    const now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
    const clock=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
    const day=date.toDateString()===now.toDateString()?'':date.toDateString()===yesterday.toDateString()?'昨天 ':date.toLocaleDateString('zh-CN',{...(date.getFullYear()!==now.getFullYear()?{year:'numeric'}:{}),month:'numeric',day:'numeric'})+' ';
    const time=make('time',day+clock);time.className='v2-time-divider';time.dateTime=at;time.title=row.title;messages.insertBefore(time,row);
   }return at;
  }
  const fields=()=>[...document.querySelectorAll('#v2Conditions input,#v2Conditions textarea')];
  const fieldKey=(e,i)=>e.dataset.fact||e.id||'field-'+i;
  function notice(){normalButton.setAttribute('aria-pressed',String(!temporary));guestButton.setAttribute('aria-pressed',String(temporary));channel.setConversationType?.(temporary?'guest':'normal');}
  function write(){try{localStorage.setItem(STORE,JSON.stringify(items));storageError=false;}catch{storageError=true;}notice();}
  function remember(){clearTimeout(timer);if(temporary||restoring)return;
   current.draft=input.value;current.mode=mode.value;current.fields=Object.fromEntries(fields().map((e,i)=>[fieldKey(e,i),e.type==='checkbox'?e.checked:e.value]));current.updated=Date.now();
   liveNodes.set(current.id,[...messages.childNodes]);
   if(current.turns.length){const first=current.turns.find(x=>x.role==='user');current.title=(first?.text||'普通对话').slice(0,40);items=[current,...items.filter(x=>x.id!==current.id)].slice(0,20);write();}
   try{sessionStorage.setItem(ACTIVE,current.id);}catch{}
  }
  function later(){if(!temporary&&!restoring){clearTimeout(timer);timer=setTimeout(remember,150);}}
  function show(record,isTemporary){clearTimeout(timer);restoring=true;temporary=isTemporary;current=record;ui.setSessionId(record.id);
   state.history=[];state.triage=null;state.numeric=null;window.__v2LastReply=null;clearOcrImage();input.value=record.draft||'';mode.value=['all','cases','ordering'].includes(record.mode)?record.mode:'all';modeChangeDisplay();
   fields().forEach((e,i)=>{const v=record.fields?.[fieldKey(e,i)];if(e.type==='checkbox')e.checked=!!v;else e.value=typeof v==='string'?v:'';});
   const nodes=liveNodes.get(record.id);messages.replaceChildren(...(nodes||[]));
   if(!nodes){for(const turn of record.turns){replayAt=turn.at;if(turn.role==='user')ui.addUserMessage(turn.text);else ui.addAssistantMessage({model:'v2-offline-search',reply:turn.text});}replayAt=undefined;}
   state.history=record.turns.map(t=>({role:t.role,content:t.text}));document.querySelector('.v2-feedback').textContent='';messages.scrollTop=messages.scrollHeight;restoring=false;notice();input.focus();
  }
  function modeChangeDisplay(){channel.setMode();}
  events.addEventListener('user-message',event=>{const at=messageTime();if(!restoring){const text=event.detail.text;current.turns.push({role:'user',text:typeof text==='string'&&text?text:'图片消息（图片不保存在前端历史）',at});later();}});
  events.addEventListener('assistant-message',event=>{const at=messageTime();if(!restoring){const data=event.detail;current.turns.push({role:'assistant',text:String(data.reply||data.clarifyQuestion||'结果已返回，详细资料或工程方案请重新查询。').slice(0,8000),at});current.turns=current.turns.slice(-80);later();}});
  events.addEventListener('session-change',()=>{if(restoring)return;remember();current=items.find(x=>x.id===ui.getSessionId())||{id:ui.getSessionId(),turns:[],fields:{},draft:'',mode:mode.value};normalId=current.id;normalRecord=current;temporary=false;notice();});
  window.v2Conversations={startTemporary(){if(send.disabled)return;remember();if(temporary)liveNodes.delete(current.id);else{normalId=current.id;normalRecord=current;}show({id:id(),turns:[],fields:{},draft:'',mode:mode.value},true);}};
  guestButton.onclick=()=>{if(!temporary)window.v2Conversations.startTemporary();};
  normalButton.onclick=()=>{if(send.disabled||!temporary)return;channel.releaseGuest?.(current.id);liveNodes.delete(current.id);const record=items.find(x=>x.id===normalId)||normalRecord;show(record,false);};
  const busy=()=>{normalButton.disabled=guestButton.disabled=send.disabled;};new MutationObserver(busy).observe(send,{attributes:true,attributeFilter:['disabled']});busy();
  input.addEventListener('input',later);document.getElementById('v2Conditions').addEventListener('input',later);
  window.addEventListener('pagehide',()=>{if(temporary)leaveTemporary();else remember();});
  window.addEventListener('storage',e=>{if(e.key!==STORE)return;try{const records=JSON.parse(e.newValue||'[]');if(Array.isArray(records))items=records.filter(x=>x&&typeof x.id==='string'&&Array.isArray(x.turns)).slice(0,20);}catch{}});
  // Leaving a temporary conversation discards it even when a request is pending.
  function leaveTemporary(){channel.releaseGuest?.(current.id);liveNodes.delete(current.id);show(items.find(x=>x.id===normalId)||normalRecord,false);}
  new MutationObserver(()=>{if(document.body.dataset.view!=='ai'&&temporary)leaveTemporary();}).observe(document.body,{attributes:true,attributeFilter:['data-view']});
  const originalRecord=current;
  if(originalRecord.turns.length){show(originalRecord,false);}else{current.mode=mode.value;notice();}
  remember();
}});
