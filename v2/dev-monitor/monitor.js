'use strict';
(() => {
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const list=document.getElementById('requests'),detail=document.getElementById('detail'),status=document.getElementById('status');
 const states={running:'进行中',answer:'已回答',clarify:'待客户补充',unavailable:'未生成可确认回答',failed:'执行失败',completed:'已完成'};
 const labels={'customer.input':'客户输入','model.request':'发送 Bonsai 的完整请求','model.response':'Bonsai 完整响应','tool.start':'实际工具执行参数','tool.result':'工具执行结果','tool.error':'工具异常','expert.diagnostic':'专家诊断事件','assistant.final':'最终交付','request.error':'请求异常','model.transport-error':'模型通信异常','model.response-error':'模型响应解析异常'};
 let selected=null,lastVersion='',busy=false,activeView='conversation';
 const textOf=v=>typeof v==='string'?v:JSON.stringify(v,null,2)??'null';
 const numeric=v=>typeof v==='number'&&Number.isFinite(v);
 const seconds=v=>numeric(v)?(v/1000).toFixed(2)+' 秒':'未返回';
 const parse=v=>{if(typeof v!=='string')return null;try{return JSON.parse(v);}catch{return null;}};
 async function json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('读取失败：HTTP '+r.status);return r.json();}
 async function copy(text,button){try{await navigator.clipboard.writeText(text);button.textContent='已复制';}catch{const a=el('textarea');a.value=text;document.body.append(a);a.select();const ok=document.execCommand('copy');a.remove();button.textContent=ok?'已复制':'复制不可用，请选择全文复制';}}
 // Export-only second-pass redaction. Never mutates the retained capture or clips text.
 function redactExport(value){
  const secretKey=/(?:password|passwd|api[ _-]?key|authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|secret|cookie|credential|connection[_-]?string|(?:device|connection|auth|session|login)[_-]?(?:token|password|secret|key|user(?:name)?|pin)|wifi[_-]?(?:password|pwd|psk)|customer[_-]?(?:name|address)|contact[_-]?(?:name|address)|postal[_-]?address|id[_-]?card|national[_-]?id|full[_-]?name|real[_-]?name|phone|mobile[_-]?number|email|密码|口令|密钥|令牌|客户姓名|联系人|手机号|身份证|住址|联系地址)|^(?:token|pwd|psk|pin|username|姓名|地址)$/i;
  if(Array.isArray(value))return value.map(redactExport);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,secretKey.test(key)?'[已脱敏]':redactExport(item)]));
  if(typeof value!=='string')return value;
  if(/^\s*[\[{]/.test(value)){try{const parsed=JSON.parse(value),safe=redactExport(parsed);return JSON.stringify(parsed)===JSON.stringify(safe)?value:JSON.stringify(safe);}catch{}}
  return value.replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g,'[私钥已脱敏]')
   .replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,'[认证凭据已脱敏]')
   .replace(/\bsk-[A-Za-z0-9_-]{16,}/g,'[API Key 已脱敏]')
   .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[连接凭据已脱敏]@')
   .replace(/((?:api[ _-]?key|password|passwd|access[_-]?token|refresh[_-]?token|secret|token|pwd|psk|pin|密码|口令|密钥|令牌|联系人|客户姓名|姓名|联系地址|住址)["']?\s*[:=：]\s*)(["'])[\s\S]*?\2/gi,'$1"[已脱敏]"')
   .replace(/((?:api[ _-]?key|password|passwd|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|authorization|token|pwd|psk|pin|username|x-amz-signature|x-amz-credential|密码|口令|密钥|令牌|联系人|客户姓名|姓名|联系地址|住址|设备密码|连接密码|Wi-?Fi密码)["']?\s*[:=：]\s*["']?)[^\s"',;}，；&]+/gi,'$1[已脱敏]')
   .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已脱敏]')
   .replace(/(?<![\w])(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g,'[电话已脱敏]')
   .replace(/(?<!\w)\d{17}[0-9X](?!\w)/gi,'[证件号已脱敏]');
 }
 function diagnosticExport(record){
  const rounds=roundsFor(record.events),missing=[];
  const mark=(path,reason)=>missing.push({path,reason});
  if(record.omitted)mark('record.events',record.omitted+' 个事件已被采集容量上限省略，无法恢复');
  if(!record.events.some(e=>e.type==='customer.input'))mark('customer.input','未采集客户输入事件');
  const final=record.events.findLast(e=>e.type==='assistant.final')?.data;
  if(!final)mark('assistant.final',record.status==='running'?'导出时尚未交付':'没有采集最终交付');
  const stats=rounds.map(round=>{
   const response=round.response?.data,usage=response?.body?.usage;
   if(!response)mark('rounds['+round.index+'].response','未采集响应；可对照原始错误事件，不补造响应');
   for(const field of ['prompt_tokens','completion_tokens','total_tokens'])if(!numeric(usage?.[field]))mark('rounds['+round.index+'].usage.'+field,'模型响应未提供该统计');
   if(!Array.isArray(round.request.data.payload?.messages))mark('rounds['+round.index+'].messages','原请求未采集 messages');
   const payload=round.request.data.payload||{};
   return {round:round.index,callId:round.request.data.callId,requestSequence:round.request.sequence,responseSequence:round.response?.sequence??null,elapsedMs:response?.elapsedMs??null,usage:usage??null,usageSource:usage?'model-response.usage':'not-recorded',inputPreflight:round.diagnostic?.data.contextUsage??null,actualToolExecutions:round.tools.length,retainedRequestFields:{messages:Array.isArray(payload.messages)?'present':'not-present-in-retained-request',systemMessages:Array.isArray(payload.messages)?payload.messages.filter(m=>m.role==='system').length:null,response_format:Object.hasOwn(payload,'response_format')?'present':'not-present-in-retained-request',tools:Object.hasOwn(payload,'tools')?'present':'not-present-in-retained-request',requestHeaders:'not-collected'}};
  });
  const starts=record.events.filter(e=>e.type==='tool.start');
  for(const [i,start]of starts.entries())if(!record.events.some(e=>['tool.result','tool.error'].includes(e.type)&&e.sequence>start.sequence&&e.sequence<(starts[i+1]?.sequence??Infinity)))mark('tool.start.sequence.'+start.sequence,'未采集对应工具结果或工具错误');
  const totals={};for(const field of ['prompt_tokens','completion_tokens','total_tokens']){const values=stats.map(r=>r.usage?.[field]).filter(numeric);totals[field]={value:values.length?values.reduce((a,b)=>a+b,0):null,reportedRounds:values.length,totalRounds:stats.length,source:'model-response.usage',estimated:false};}
  return redactExport({format:'bonsai-diagnostic',formatVersion:1,exportedAt:new Date().toISOString(),scope:{requestId:record.id,singleCustomerQuestion:true,snapshotStatus:record.status},
   redaction:{applied:true,stage:'existing-capture-plus-export-second-pass',notice:'凭据与可识别个人信息已脱敏；型号、检索词和技术参数保留。未标注的自由文本个人信息可能无法自动识别，分享前请核对。'},
   completeness:{retainedTextTruncatedByExport:false,omittedEvents:record.omitted??0,missing,notes:['仅包含当前请求现存的采集记录；未采集或已淘汰的数据无法恢复。','请求头在采集阶段就未记录，避免泄露凭据。','未出现的工具或请求字段不代表缺失；以原始事件和实际协议为准。','逐条校验过程未单独采集；最终状态及错误保留在 finalDelivery 和原始事件中。']},
   statistics:{modelRequestCount:rounds.length,actualToolExecutionCount:starts.length,elapsedMs:record.elapsedMs??null,rounds:stats,totals},finalDelivery:final??null,
   record});
 }
 async function downloadDiagnostic(requestId,button,feedback){
  button.disabled=true;feedback.textContent='正在读取当前问题并脱敏…';
  try{
   const record=await json('/dev/bonsai/api/requests/'+encodeURIComponent(requestId));
   if(record.id!==requestId)throw Error('请求关联 ID 不匹配，已停止导出');
   const payload=diagnosticExport(record),blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
   const a=el('a');a.href=url;a.download='bonsai-diagnostic-'+new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\.\d{3}Z$/,'Z')+'.json';a.hidden=true;document.body.append(a);
   try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   feedback.textContent=payload.completeness.missing.length?'已导出当前问题；文件内已标明缺失项。':'已导出当前问题的完整现存记录。';
  }catch(error){feedback.textContent='导出失败：'+error.message+'。未调用模型，也未生成替代记录。';}finally{button.disabled=false;}
 }
 // No generated summaries or truncation: long content is built on expansion.
 function content(parent,title,value,key,opened,{fold=false,raw=false}={}){
  const text=textOf(value),collapsed=fold||text.length>700,box=el(collapsed?'details':'article',undefined,'content-block');box.dataset.event=key;
  box.append(el(collapsed?'summary':'h4',title));let built=false;
  const fill=()=>{if(built||collapsed&&!box.open)return;built=true;const b=el('button','复制全文');b.type='button';b.onclick=()=>copy(text,b);box.append(b,el('pre',text,raw?'raw-content':'message-content'));};
  if(collapsed){box.open=opened.has(key);box.addEventListener('toggle',fill);}parent.append(box);fill();
 }
 function card(parent,title,event,cls=''){const box=el('article',undefined,'conversation-card '+cls);box.append(el('h3',title));if(event)box.append(el('small','顺序 '+event.sequence+' · 开始后 '+seconds(event.elapsedMs)));parent.append(box);return box;}
 function message(parent,msg,prefix,key,opened){
  const parsed=parse(msg.content);
  if(msg.role==='system'||msg.role==='developer')content(parent,prefix+'系统提示词 · '+msg.role,msg.content,key,opened,{fold:true});
  else if(msg.role==='tool'||parsed&&Object.hasOwn(parsed,'toolResult'))content(parent,prefix+'实际发送的工具结果 · '+msg.role,msg.content,key,opened);
  else if(msg.role==='user'&&parsed&&(Object.hasOwn(parsed,'message')||Object.hasOwn(parsed,'history'))){
   if(Object.hasOwn(parsed,'message'))content(parent,prefix+'客户消息 · message',parsed.message,key+'-customer',opened);
   if(Object.hasOwn(parsed,'history'))content(parent,prefix+'历史消息 · history',parsed.history,key+'-history',opened,{fold:true});
   const other=Object.fromEntries(Object.entries(parsed).filter(([k])=>!['message','history'].includes(k)));
   if(Object.keys(other).length)content(parent,prefix+'同条消息中的其他实际字段',other,key+'-fields',opened,{fold:true});
   content(parent,prefix+'完整 user.content 原文',msg.content,key+'-original',opened,{fold:true});
  }else content(parent,prefix+(msg.role==='assistant'?'此前 Bonsai 消息 · assistant':'消息 · '+msg.role),msg.content,key,opened);
  const extra=Object.fromEntries(Object.entries(msg).filter(([k])=>!['role','content'].includes(k)));
  if(Object.keys(extra).length)content(parent,prefix+'消息附加字段',extra,key+'-extra',opened,{fold:true});
 }
 function roundsFor(events){
  const requests=events.filter(e=>e.type==='model.request'&&e.data.path==='/v1/chat/completions');
  return requests.map((request,i)=>{const end=requests[i+1]?.sequence??Infinity;return{request,index:i+1,response:events.find(e=>e.type==='model.response'&&e.data.callId===request.data.callId),diagnostic:events.find(e=>e.type==='expert.diagnostic'&&e.sequence>request.sequence&&e.sequence<end&&e.data.contextUsage),tools:events.filter(e=>e.type==='tool.start'&&e.sequence>request.sequence&&e.sequence<end)};});
 }
 function statistics(parent,rounds,record){
  const total=field=>{const values=rounds.map(r=>r.response?.data.body?.usage?.[field]).filter(numeric);return values.length?values.reduce((a,b)=>a+b,0).toLocaleString()+(values.length===rounds.length?'':'（仅 '+values.length+'/'+rounds.length+' 轮）'):'未返回';};
  const box=el('details',undefined,'statistics');box.dataset.event='statistics';box.append(el('summary','Token 统计 · 服务端累计输入 '+total('prompt_tokens')+' · 输出 '+total('completion_tokens')+' · 展开每轮明细'),el('p','输入/输出 Token 来自模型响应 usage；缺失显示“未返回”，不补算。输入预检单列显示来源，不计入用量累计。','muted'));
  const wrap=el('div',undefined,'table-scroll'),table=el('table'),head=el('thead'),tr=el('tr');for(const name of ['轮次','输入 Token · 服务端','输出 Token · 服务端','模型耗时','工具执行','输入预检 · 独立计数'])tr.append(el('th',name));head.append(tr);table.append(head);const body=el('tbody');
  for(const round of rounds){const u=round.response?.data.body?.usage,c=round.diagnostic?.data.contextUsage;const preflight=c&&numeric(c.inputTokens)?c.inputTokens+' · '+(c.countMethod==='server-tokenizer'?'服务端分词器':'估算/其他计数：'+(c.countMethod||'来源未标明')):'未记录';const row=el('tr');for(const v of [round.index,numeric(u?.prompt_tokens)?u.prompt_tokens:'未返回',numeric(u?.completion_tokens)?u.completion_tokens:'未返回',seconds(round.response?.data.elapsedMs),round.tools.length,preflight])row.append(el('td',v));body.append(row);}
  table.append(body);wrap.append(table);box.append(wrap);parent.append(box);
 }
 function conversation(parent,record,rounds,opened){
  const requests=new Map(rounds.map(r=>[r.request.sequence,r])),responses=new Map(rounds.filter(r=>r.response).map(r=>[r.response.sequence,r.index]));
  const timeline=el('div',undefined,'timeline');parent.append(timeline);
  for(const event of record.events){const d=event.data,key='conversation-'+event.sequence;
   if(event.type==='customer.input'){
    const box=card(timeline,'客户说了什么',event,'customer');content(box,'客户原始问题',d.originalQuestion??record.question,key,opened);
    if(d.message!==undefined&&d.message!==d.originalQuestion)content(box,'传入专家的实际 message',d.message,key+'-input',opened);
   }else if(requests.has(event.sequence)){
    const round=requests.get(event.sequence),p=d.payload||{},box=card(timeline,'第 '+round.index+' 轮 · 小灰机实际发给 Bonsai',event,'outgoing');
    const usage=round.response?.data.body?.usage;
    box.append(el('p','模型：'+(p.model??'未记录')+' · '+(p.messages?.length??0)+' 条消息','muted'));
    box.append(el('p','本轮服务端 Token：输入 '+(numeric(usage?.prompt_tokens)?usage.prompt_tokens:'未返回')+' · 输出 '+(numeric(usage?.completion_tokens)?usage.completion_tokens:'未返回')+' · 模型耗时 '+seconds(round.response?.data.elapsedMs)+' · 工具执行 '+round.tools.length+' 次','muted'));
    box.id='sent-round-'+round.index;
    const transcript=(p.messages||[]).map((msg,i)=>'【消息 '+(i+1)+' · '+msg.role+'】\n'+textOf(msg.content)).join('\n\n');
    content(box,'这一轮完整发送的消息 · 点击展开全文',transcript,key+'-sent-full',opened,{fold:true});
    content(box,'这一轮完整请求 JSON · 包含全部消息和参数',p,key+'-request-full',opened,{fold:true,raw:true});
    for(const [i,msg]of(p.messages||[]).entries())message(box,msg,(i+1)+'. ',key+'-message-'+i,opened);
    content(box,'本轮工具定义、动作协议及请求参数（实际字段）',Object.fromEntries(Object.entries(p).filter(([k])=>k!=='messages')),key+'-parameters',opened,{fold:true});
   }else if(responses.has(event.sequence)){
    const box=card(timeline,'第 '+responses.get(event.sequence)+' 轮 · Bonsai 实际回复',event,'incoming');
    for(const [i,choice]of(d.body?.choices||[]).entries()){
     const msg=choice.message,action=parse(msg?.content);
     if(msg&&Object.hasOwn(msg,'content'))content(box,'回复完整原文'+(i?' · '+i:''),msg.content,key+'-reply-'+i,opened,{fold:!!action?.action});
     if(action&&typeof action==='object'&&action.action){
      const name={search:'Bonsai 要求查找资料',read:'Bonsai 要求读取原文',answer:'Bonsai 提交的答案',clarify:'Bonsai 提出的追问',calculate:'Bonsai 要求执行计算',analyze:'Bonsai 要求分析'}[action.action]||'Bonsai JSON 动作';
      box.append(el('h4',name+' · '+action.action));
      for(const field of ['query','goals','reason','blockId','offset'])if(Object.hasOwn(action,field))content(box,{query:'实际检索词',goals:'实际检索目标',reason:'Bonsai 写出的理由',blockId:'实际读取位置 · blockId',offset:'实际读取偏移 · offset'}[field],action[field],key+'-action-'+i+'-'+field,opened);
      if(Array.isArray(action.claims))for(const[j,claim]of action.claims.entries()){
       content(box,'答案原文 '+(j+1),claim.text,key+'-claim-'+i+'-'+j,opened);
       content(box,'该条答案的实际引用及其他字段',Object.fromEntries(Object.entries(claim).filter(([k])=>k!=='text')),key+'-claim-source-'+i+'-'+j,opened,{fold:true});
      }
      if(Object.hasOwn(action,'generalAdvice'))content(box,'Bonsai 返回的建议原文',action.generalAdvice,key+'-advice-'+i,opened);
      if(Object.hasOwn(action,'question'))content(box,'Bonsai 返回的追问原文',action.question,key+'-question-'+i,opened);
      content(box,'完整 JSON 动作请求（同一回复，未另行执行）',action,key+'-action-'+i,opened,{fold:true});
     }
     if(msg?.tool_calls)content(box,'Bonsai 返回的工具调用',msg.tool_calls,key+'-calls-'+i,opened);
     const extra=Object.fromEntries(Object.entries(msg||{}).filter(([k])=>!['role','content','tool_calls'].includes(k)));if(Object.keys(extra).length)content(box,'其他实际回复字段',extra,key+'-extra-'+i,opened);
    }
    if(!d.body?.choices?.length)content(box,'实际响应内容',d.body,key+'-body',opened);
   }else if(event.type==='tool.start'){
    const box=card(timeline,'小灰机实际执行工具 · '+d.name,event,'tool');content(box,'实际执行参数',d.arguments,key,opened);
   }else if(event.type==='tool.result'){
    const box=card(timeline,'小灰机取得工具结果 · '+d.name,event,'tool');box.append(el('p','执行耗时 '+seconds(d.elapsedMs)+'。以下是执行器返回值；发给 Bonsai 的实际版本见下一轮“实际发送的工具结果”。','muted'));const r=d.result;
    if(Array.isArray(r?.evidence)){
     for(const [i,evidence]of r.evidence.entries()){
      content(box,'资料 '+(i+1)+' · '+(evidence.name??evidence.evidenceId??'未提供名称'),evidence.text,key+'-evidence-'+i,opened);
      content(box,'资料 '+(i+1)+' 的来源及实际字段',Object.fromEntries(Object.entries(evidence).filter(([k])=>k!=='text')),key+'-metadata-'+i,opened,{fold:true});
     }
     content(box,'工具返回状态及其他字段',Object.fromEntries(Object.entries(r).filter(([k])=>k!=='evidence')),key+'-notice',opened);
     if(!r.evidence.length)box.append(el('p','此工具返回的 evidence 数组为空。','muted'));
     content(box,'完整工具结果 JSON',r,key+'-full',opened,{fold:true});
    }else content(box,'完整工具结果',r,key,opened);
   }else if(event.type==='assistant.final'){
    const box=card(timeline,'小灰机最终交付给客户',event,d.status==='answer'?'final':'failure');box.append(el('p',(states[d.status]||d.status)+(d.error?' · '+d.error:''),'muted'));content(box,Object.hasOwn(d,'reply')?'最终原文':'实际交付对象（无 reply 字段）',d.reply??d,key,opened);
   }else if(['tool.error','request.error','model.transport-error','model.response-error'].includes(event.type)){
    if(d.path&&d.path!=='/v1/chat/completions')continue;const box=card(timeline,labels[event.type],event,'failure');content(box,'实际错误记录',d,key,opened);
   }
  }
  if(!record.events.some(e=>e.type==='assistant.final'))timeline.append(el('p',record.status==='running'?'尚未记录最终交付。':'未记录最终交付；不补造内容。','muted'));
 }
 function developer(parent,record,opened){
  parent.append(el('p','原始 JSON、诊断事件及 /v1/models、/props、/tokenize 等辅助通信均保留在这里。内容为已脱敏的采集记录。','muted'));
  content(parent,'展开或复制本次完整记录',record,'developer-full',opened,{fold:true,raw:true});
  for(const e of record.events)content(parent,e.sequence+'. '+(labels[e.type]||e.type)+(e.data?.path?' · '+e.data.path:'')+' · 开始后 '+seconds(e.elapsedMs),e,'developer-'+e.sequence,opened,{fold:true,raw:true});
 }
 function render(record){
  const opened=new Set([...detail.querySelectorAll('details[open]')].map(d=>d.dataset.event)),rounds=roundsFor(record.events),tools=record.events.filter(e=>e.type==='tool.start'),final=record.events.findLast(e=>e.type==='assistant.final')?.data;
  detail.replaceChildren();const top=el('div',undefined,'request-summary');top.append(el('h2','本次客户问题'));
  const exportButton=el('button','导出完整诊断'),exportFeedback=el('small');exportButton.type='button';exportFeedback.setAttribute('role','status');exportButton.onclick=()=>downloadDiagnostic(record.id,exportButton,exportFeedback);top.append(exportButton,exportFeedback);
  content(top,'客户原话',record.question,'summary-question',opened);
  const facts=el('div',undefined,'facts');for(const t of ['模型请求 '+rounds.length+' 次','实际工具执行 '+tools.length+' 次','状态：'+(states[record.status]||record.status),'全程 '+seconds(record.elapsedMs)])facts.append(el('span',t));top.append(facts,el('small','请求 '+record.id+' · 匿名会话 '+(record.session||'未提供')));
  if(final){top.append(el('h3',final.status==='answer'?'最终答案 · 小灰机实际交付':'最终交付 · '+(states[final.status]||final.status)));content(top,final.error?'原文 · '+final.error:'原文',final.reply??final,'summary-final',opened);}else top.append(el('p','最终答案：'+(record.status==='running'?'尚未交付':'未记录'),'muted'));
  if(record.omitted)top.append(el('p','有 '+record.omitted+' 个事件因容量限制未保留。此记录不完整，缺失内容不作补造。','warning'));
  top.append(el('p','下方只呈现实际采集内容及字段标签；凭据和常见客户隐私沿用已有脱敏。没有记录的内容不会补写。','muted'));detail.append(top);statistics(detail,rounds,record);detail.querySelector('.statistics').open=opened.has('statistics');
  const tabs=el('div',undefined,'view-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','监控展示方式');const conv=el('div'),dev=el('div');conv.id='conversation-view';dev.id='developer-view';let built=false;
  const choices=[['conversation','对话视图',conv],['developer','开发详情',dev]];
  const switchView=view=>{activeView=view;for(const[name,,panel]of choices){panel.hidden=name!==view;document.getElementById('tab-'+name)?.setAttribute('aria-selected',String(name===view));}if(view==='developer'&&!built){developer(dev,record,opened);built=true;}};
  for(const[name,label,panel]of choices){const b=el('button',label);b.type='button';b.id='tab-'+name;b.setAttribute('role','tab');b.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id);b.onclick=()=>switchView(name);tabs.append(b);}
  detail.append(tabs,conv,dev);conversation(conv,record,rounds,opened);switchView(activeView);
  const shortcuts=el('div',undefined,'send-shortcuts');shortcuts.append(el('strong','查看实际发送内容：'));
  for(const round of rounds){const b=el('button','第 '+round.index+' 轮');b.type='button';b.onclick=()=>{switchView('conversation');const box=document.getElementById('sent-round-'+round.index);box.querySelector('[data-event$="-sent-full"]').open=true;box.scrollIntoView({block:'start'});};shortcuts.append(b);}
  top.append(shortcuts);
 }
 async function refresh(){
  if(busy)return;busy=true;
  try{
   const[state,data]=await Promise.all([json('/dev/bonsai/api/status'),json('/dev/bonsai/api/requests')]);status.textContent='监控已开启 · 内存保存 '+state.records+'/'+state.maxRecords+' 条 · 凭据与常见隐私已脱敏 · 关闭进程清空记录';
   if(!selected&&data.requests.length)selected=data.requests[0].id;list.replaceChildren();if(!data.requests.length)list.append(el('p','尚无通信记录。请在小灰机里正常使用专家模式；快速模式不会调用 Bonsai。'));
   for(const r of data.requests){const b=el('button');b.type='button';b.setAttribute('aria-pressed',String(selected===r.id));b.append(el('strong',r.question||'无问题文字'),el('small',new Date(r.startedAt).toLocaleString('zh-CN')+' · '+(states[r.status]||r.status)));b.onclick=()=>{selected=r.id;lastVersion='';activeView='conversation';refresh();};list.append(b);}
   if(selected){const current=data.requests.find(r=>r.id===selected);if(!current){selected=null;lastVersion='';detail.replaceChildren(el('p','记录已按容量上限淘汰。'));return;}const version=JSON.stringify([current.id,current.status,current.eventCount,current.omitted,current.bytes]);if(version!==lastVersion){const r=await json('/dev/bonsai/api/requests/'+selected);render(r);lastVersion=version;}}
  }catch(error){status.textContent=error.message+'；监控可能已关闭。';}finally{busy=false;}
 }
 document.getElementById('refresh').onclick=()=>{lastVersion='';refresh();};refresh();setInterval(refresh,3000);
})();
