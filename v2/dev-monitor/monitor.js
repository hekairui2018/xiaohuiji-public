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
  const names={search_evidence:'查找资料',read_document:'读取原文',calculate_ordering:'配单计算',quick_answer:'快速问答／参数／文件'};
  const kinds={cases:'售后案例',faq:'常见问题',tender:'控标资料',products:'产品参数',resources:'文件目录',files:'文件目录',firmware:'固件',text:'技术原文'};
  const actions={search:'查找资料',read:'读取原文',calculate:'交给配单算法计算',quick:'调用快速问答工具',deliver:'交付已找到的文件',answer:'给出回答',clarify:'补问关键条件',analyze:'继续分析'};
  const requests=new Map(rounds.map(r=>[r.request.sequence,r])),responses=new Map(rounds.filter(r=>r.response).map(r=>[r.response.sequence,r]));
  const frame=el('section',undefined,'chat-frame'),heads=el('div',undefined,'lane-heads');heads.append(el('strong','大模型'),el('span','真实通信 · 按时间顺序'),el('strong','小灰机'));frame.append(heads);parent.append(frame);
  const timeline=el('div',undefined,'timeline twin-timeline chat-scroll');timeline.setAttribute('role','log');timeline.setAttribute('aria-label','小灰机和大模型的聊天记录');timeline.dataset.recordId=record.id;frame.append(timeline);
  let lastActor=null,lastBubble=null;
  const bubble=(actor,title,event,cls='')=>{if(actor!==lastActor){const row=el('div',undefined,'exchange-row '+actor),box=el('article',undefined,'conversation-card '+cls),avatar=el('span',actor==='model'?'模':'灰','chat-avatar');avatar.setAttribute('aria-hidden','true');box.dataset.actor=actor;box.append(el('span',actor==='model'?'大模型':'小灰机','actor-label'));row.append(avatar,box);timeline.append(row);lastActor=actor;lastBubble=box;}const part=el('section',undefined,'event-part');part.append(el('h3',title),el('small','第 '+event.sequence+' 步 · 开始后 '+seconds(event.elapsedMs)));lastBubble.append(part);return part;};
  const args=(box,d,key)=>{const fields={query:'查什么',kind:'去哪里查',userQuotes:'交给工具的客户原话',models:'设备型号',chips:'芯片线索',version:'版本条件',problemDomain:'问题侧重',goals:'查找目标',concepts:'现象与关键词',blockId:'原文位置',offset:'继续读取的位置',reason:'模型给出的理由'};for(const [field,label]of Object.entries(fields))if(Object.hasOwn(d,field)){let value=d[field];if(field==='kind')value=kinds[value]||value;if(field==='problemDomain')value={display:'显示问题：芯片、模组优先',equipment:'设备问题：设备优先',unspecified:'尚未区分，平衡查找'}[value]||value;content(box,label,Array.isArray(value)?value.join('；'):value,key+'-'+field,opened);} };
  for(const event of record.events){const d=event.data,key='conversation-'+event.sequence;
   if(event.type==='customer.input'){
    const box=bubble('app','收到客户问题',event,'customer');content(box,'客户原话',d.originalQuestion??record.question,key,opened);
   }else if(requests.has(event.sequence)){
    const round=requests.get(event.sequence),p=d.payload||{},box=bubble('app','第 '+round.index+' 轮 · 把任务交给大模型 ←',event,'outgoing');box.id='sent-round-'+round.index;
    const systems=(p.messages||[]).filter(m=>['system','developer'].includes(m.role));
    content(box,'本轮完整提示词 · '+systems.length+' 段',systems.map(m=>textOf(m.content)).join('\n\n'),key+'-prompt',opened,{fold:true});
    for(const msg of p.messages||[]){if(msg.role!=='user')continue;const input=parse(msg.content);if(!input){content(box,'发送的消息',msg.content,key+'-message',opened);continue;}
     if(input.message&&round.index>1)content(box,'沿用的客户问题',input.message,key+'-customer',opened,{fold:true});
     if(input.history?.length)content(box,'带入的历史对话 · '+input.history.length+' 条',input.history,key+'-history',opened,{fold:true});
     if(input.preparedEvidence?.evidence?.length){const rows=input.preparedEvidence.evidence;content(box,'交给模型的资料 · '+rows.length+' 条',rows.map((e,i)=>(i+1)+'. '+(e.name||'未命名资料')).join('\n'),key+'-sources',opened);content(box,'查看实际发送的资料全文与条件',input.preparedEvidence,key+'-evidence',opened,{fold:true});}
     if(input.lastToolResult)content(box,'上一项工具的返回内容',input.lastToolResult,key+'-last-tool',opened,{fold:true});
    }
    box.append(el('p',(p.chat_template_kwargs?.enable_thinking===true?'思考已开启':'思考开关以完整请求为准')+' · 本轮生成上限 '+(p.max_tokens??'未返回')+' tokens','muted'));
    content(box,'完整发送记录 · 提示词、客户条件、工具结果',(p.messages||[]).map(m=>'【'+m.role+'】\n'+textOf(m.content)).join('\n\n'),key+'-sent-full',opened,{fold:true});
    content(box,'原始请求参数',p,key+'-request',opened,{fold:true,raw:true});
   }else if(responses.has(event.sequence)){
    const round=responses.get(event.sequence),box=bubble('model','第 '+round.index+' 轮 · 大模型的决定 →',event,'incoming'),u=d.body?.usage;box.append(el('p','模型用时 '+seconds(d.elapsedMs)+' · 输入 '+(u?.prompt_tokens??'未返回')+' tokens · 思考 '+(u?.completion_tokens_details?.reasoning_tokens??'未返回')+' tokens','muted'));
    for(const [i,choice]of(d.body?.choices||[]).entries()){const msg=choice.message||{},action=parse(msg.content);if(action?.action){box.append(el('h4',actions[action.action]||action.action));args(box,action,key+'-action-'+i);if(action.claims?.length)content(box,'模型写出的答案',action.claims.map(c=>c.text).join('\n\n'),key+'-answer-'+i,opened);if(action.generalAdvice?.length)content(box,'补充分析',action.generalAdvice.join('\n'),key+'-advice-'+i,opened);if(action.question)content(box,'需要补问',action.question,key+'-question-'+i,opened);if(action.action==='deliver')content(box,'模型选择的文件编号',action.evidenceIds,key+'-files-'+i,opened);content(box,'查看模型原始回复',msg.content,key+'-raw-'+i,opened,{fold:true,raw:true});}else if(msg.content)content(box,'实际回复',msg.content,key+'-text-'+i,opened);
     if(choice.finish_reason==='length')box.append(el('p','本轮到达生成上限，未正常完成。','warning'));
     if(!msg.content)box.append(el('p','服务未返回答案正文；不能由 token 数推测模型内部在想什么。','muted'));
    }
   }else if(event.type==='tool.start'){
    const box=bubble('app','执行工具：'+(names[d.name]||d.name),event,'tool');args(box,d.arguments||{},key);content(box,'完整工具参数',d.arguments,key+'-raw',opened,{fold:true,raw:true});
   }else if(event.type==='tool.result'){
    const box=bubble('app','工具返回：'+(names[d.name]||d.name),event,'tool'),r=d.result||{},state=r.calculationResult?.status||r.directAnswer?.status||r.notice?.status;
    box.append(el('p','用时 '+seconds(d.elapsedMs)+(state?' · '+({ready:'计算完成并通过校验',answer:'已找到可交付结果',needs_input:'需要补充条件',unsupported:'当前工具不支持'}[state]||state):''),'muted'));
    if(r.calculationReply||r.directAnswer?.reply)content(box,'工具给出的结果',r.calculationReply||r.directAnswer.reply,key+'-reply',opened);
    const result=r.calculationResult;if(result?.plan){const plan=result.plan;content(box,'配单结果','整屏 '+plan.screen.pixelWidth+' × '+plan.screen.pixelHeight+' 像素'+(plan.controller?.model?'；主控 '+plan.controller.model:'')+'；'+(result.validation?.passed?'校验通过':'校验状态见详情'),key+'-plan',opened);}
    if(r.evidence?.length)content(box,'找回 '+r.evidence.length+' 条资料',r.evidence.map((e,i)=>(i+1)+'. '+(e.name||e.evidenceId||'未命名资料')).join('\n'),key+'-list',opened);
    if(r.notice?.missing_parameters?.length)content(box,'缺少哪些条件',r.notice.missing_parameters.map(x=>x.reason||x.path).join('\n'),key+'-missing',opened);
    content(box,'展开完整工具结果 · 原文、条件、图片及参数',r,key+'-full',opened,{fold:true,raw:true});
   }else if(event.type==='assistant.final'){
    const box=bubble('app','交付给客户',event,d.status==='answer'?'final':'failure');box.append(el('p',states[d.status]||d.status,'muted'));content(box,'客户实际收到的内容',d.reply??d,key,opened);if(d.error)content(box,'未完成的原因',d.error,key+'-error',opened);
   }else if(['tool.error','request.error','model.transport-error','model.response-error'].includes(event.type)){
    if(d.path&&d.path!=='/v1/chat/completions')continue;const box=bubble(event.type.startsWith('model.')?'model':'app',labels[event.type],event,'failure');content(box,'实际错误',d.message||d,key,opened);
   }
  }
  if(!record.events.some(e=>e.type==='assistant.final'))timeline.append(el('p',record.status==='running'?'仍在处理，页面会自动更新。':'尚未采集到最终交付。','muted'));
 }
 function developer(parent,record,opened){
  parent.append(el('p','原始 JSON、诊断事件及 /v1/models、/props、/tokenize 等辅助通信均保留在这里。内容为已脱敏的采集记录。','muted'));
  content(parent,'展开或复制本次完整记录',record,'developer-full',opened,{fold:true,raw:true});
  for(const e of record.events)content(parent,e.sequence+'. '+(labels[e.type]||e.type)+(e.data?.path?' · '+e.data.path:'')+' · 开始后 '+seconds(e.elapsedMs),e,'developer-'+e.sequence,opened,{fold:true,raw:true});
 }
 function render(record){
  const previousChat=detail.querySelector('.chat-scroll'),chatPosition=previousChat?.dataset.recordId===record.id?{top:previousChat.scrollTop,bottom:previousChat.scrollHeight-previousChat.scrollTop-previousChat.clientHeight<30}:null;
  const opened=new Set([...detail.querySelectorAll('details[open]')].map(d=>d.dataset.event)),rounds=roundsFor(record.events),tools=record.events.filter(e=>e.type==='tool.start'),final=record.events.findLast(e=>e.type==='assistant.final')?.data;
  detail.replaceChildren();const top=el('div',undefined,'request-summary');top.append(el('h2','本次客户问题'));
  const exportButton=el('button','导出完整诊断'),exportFeedback=el('small');exportButton.type='button';exportFeedback.setAttribute('role','status');exportButton.onclick=()=>downloadDiagnostic(record.id,exportButton,exportFeedback);top.append(exportButton,exportFeedback);
  top.append(el('p',record.question,'customer-question'));
  const facts=el('div',undefined,'facts');for(const t of ['模型请求 '+rounds.length+' 次','实际工具执行 '+tools.length+' 次','状态：'+(states[record.status]||record.status),'全程 '+seconds(record.elapsedMs)])facts.append(el('span',t));top.append(facts,el('small','请求 '+record.id+' · 匿名会话 '+(record.session||'未提供')));
  if(final){top.append(el('h3',final.status==='answer'?'最终答案 · 小灰机实际交付':'最终交付 · '+(states[final.status]||final.status)));content(top,final.error?'查看错误详情 · '+final.error:'展开客户实际收到的答案',final.reply??final,'summary-final',opened,{fold:true});}else top.append(el('p','最终答案：'+(record.status==='running'?'尚未交付':'未记录'),'muted'));
  if(record.omitted)top.append(el('p','有 '+record.omitted+' 个事件因容量限制未保留。此记录不完整，缺失内容不作补造。','warning'));
  top.append(el('p','下方只呈现实际采集内容及字段标签；凭据和常见客户隐私沿用已有脱敏。没有记录的内容不会补写。','muted'));detail.append(top);statistics(detail,rounds,record);detail.querySelector('.statistics').open=opened.has('statistics');
  const tabs=el('div',undefined,'view-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','监控展示方式');const conv=el('div'),dev=el('div');conv.id='conversation-view';dev.id='developer-view';let built=false;
  const choices=[['conversation','对话视图',conv],['developer','开发详情',dev]];
  const switchView=view=>{activeView=view;for(const[name,,panel]of choices){panel.hidden=name!==view;document.getElementById('tab-'+name)?.setAttribute('aria-selected',String(name===view));}if(view==='developer'&&!built){developer(dev,record,opened);built=true;}};
  for(const[name,label,panel]of choices){const b=el('button',label);b.type='button';b.id='tab-'+name;b.setAttribute('role','tab');b.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id);b.onclick=()=>switchView(name);tabs.append(b);}
  detail.append(tabs,conv,dev);conversation(conv,record,rounds,opened);switchView(activeView);if(chatPosition){const chat=conv.querySelector('.chat-scroll');chat.scrollTop=chatPosition.bottom?chat.scrollHeight:chatPosition.top;}
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
