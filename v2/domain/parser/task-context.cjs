'use strict';
const {parseOrderingFields}=require('./ordering-fields.cjs');
const {chatIntent}=require('./chat-intent.cjs');
const {messageUpdate}=require('./task-update.cjs');
const clone=x=>structuredClone(x);
const isOutcomeUpdate=text=>/^(?:还是这样|还是一样|仍然如此|没有改善|没用|换了也没用|依旧如此)[。！!？?\s]*$/.test(text);
const valueAt=(obj,path)=>path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],obj);
function leaves(value,prefix=''){
 return Object.entries(value||{}).flatMap(([k,v])=>k==='provenance'?[]:v&&typeof v==='object'&&!Array.isArray(v)?leaves(v,prefix+'/'+k):[{path:prefix+'/'+k,value:v}]);
}
// Persist task ownership separately from expiring retrieval results. Migrate old
// sessions once; never infer confirmed slots from assistant prose or model hits.
function taskState(state){
 if(state.taskState?.version===1)return clone(state.taskState);
 const history=state.retrievalHistory||[],saved=history.findLast(r=>r.quickContext?.taskState)?.quickContext.taskState;
 if(saved)return clone(saved);
 const last=history.findLast(r=>r.quickContext)?.quickContext;
 const ordering=history.findLast(r=>r.quickContext?.ordering)?.quickContext.ordering;
 const tasks=[];
 if(ordering)tasks.push({id:'task-1',type:'ordering',status:!last?.intent||last.intent==='ordering'?'active':'suspended',revision:1,ordering:clone(ordering),context:{intent:'ordering',models:[],chips:[],software:[],query:''}});
 if(last&&!ordering&&last.intent!=='social'||last?.intent&&last.intent!=='ordering'&&last.intent!=='social')tasks.push({id:'task-'+(tasks.length+1),type:last.intent||'technical',status:'active',revision:1,context:{...clone(last),ordering:undefined,taskState:undefined}});
 return {version:1,sequence:tasks.length,activeId:tasks.find(t=>t.status==='active')?.id||null,tasks,events:[]};
}
function decideTask(message,lookup,state={}){
 const text=String(message).trim(),store=taskState(state);
 // Legacy chat-only sessions: recover only customer-origin explicit entities,
 // once, and only for a result follow-up. Assistant guesses are never sources.
 if(!store.tasks.length&&!state.taskState&&isOutcomeUpdate(text)){
  const previous=(state.messages||[]).filter(m=>m.role==='user'&&m.content!==text).findLast(m=>chatIntent(m.content,lookup).models.length);
  if(previous){const p=chatIntent(previous.content,lookup);store.tasks.push({id:'task-'+(++store.sequence),type:p.intent,status:'active',revision:0,context:{query:previous.content,intent:p.intent,models:p.models,chips:[],software:p.software||[]}});store.activeId=store.tasks[0].id;}
 }
 const active=store.tasks.find(t=>t.id===store.activeId);
 const reset=/(?:重新|另外|新)(?:.{0,4})(?:配单|配屏)|另一(?:块|面)屏/.test(text);
 // Resolve the relation and typed changes before allowing a standalone label
 // such as “是分辨率” to claim a new parameter-query task.
 const update=messageUpdate(text,reset?null:active);
 const planning=require('../ordering/planning-inference.cjs').planningPreference(text);
 update.planningPreference=planning;
 const raw=chatIntent(text,lookup),decision=raw.decision;
 const resume=/(?:继续|恢复|接着|回到)/.test(text)&&/(?:配|屏|方案|刚才|之前|上次)/.test(text);
 const cancel=/^(?:取消|结束|停止|放弃)(?:当前|这个|刚才的)?(?:配单|任务|方案)[。！!\s]*$/.test(text);
 const correction=/(?:不是|改成|改为|改用|更正|说错|不对)/.test(text);
 // Contrast grammar only exposes the positive replacement; preserve the
 // original user quote in the event. A number alone is never assigned a unit.
 const replacement=/^(?:不是|并非)[^，,；;]+[，,；;]\s*(?:而?是|改成|改为)\s*(.+)$/.exec(text);
 const input=replacement?replacement[1]:text;
 if(replacement)Object.assign(update,messageUpdate(input,active,{correction:true}));
 const delta=update.delta;
 if(active?.type==='ordering'&&update.commands.negate&&raw.models.length&&active.ordering?.confirmed.providedDevices?.some(d=>raw.models.includes(d.modelId))){
  delta.providedDevices=active.ordering.confirmed.providedDevices.filter(d=>!raw.models.includes(d.modelId));delta.provenance??={};delta.provenance['/providedDevices']={kind:'user-negated',text};update.commands.correct=true;update.clarification=null;update.pending=null;
 }
 // Registry-backed identity is a typed business constraint only in an explicit
 // engineering request/correction, never in an independent parameter query.
 if(raw.models.length&&!update.commands.negate&&(raw.intent==='ordering'||active?.type==='ordering'&&update.commands.correct&&!/[?？]|多少|怎么|规格书|固件|灰阶/.test(text))){delta.providedDevices=raw.models.map(modelId=>({modelId,revisionId:null}));delta.provenance??={};delta.provenance['/providedDevices']={kind:'user-stated',text};update.clarification=null;update.pending=null;update.operations.push({op:'set',path:'/providedDevices',value:delta.providedDevices,source:delta.provenance['/providedDevices']});}
 const fields=leaves(delta);
 const hasSlots=fields.length>0||update.operations.some(o=>['clear','exclude'].includes(o.op))||Object.values(delta.provenance||{}).some(p=>p.kind==='user-negated');
 const independent=['resources','parameters','operation','compatibility','aftersales','software-function','service','chip','product','technical'].includes(raw.intent);
 const explicitQuery=raw.models.length&&!update.commands.correct||raw.software?.length||/[?？]|多少|多大|怎么|如何|查|找|下载|给我|发我|规格书|说明书|灰阶|闪屏|黑屏|打不开/.test(text);
 const fieldReply=active?.type==='ordering'&&!explicitQuery&&(update.geometry.values||update.geometry.unit||update.commands.correct||update.commands.revert||update.commands.complete||update.commands.approve);
 const queryAct=!fieldReply&&['query-parameters','find-resources','guide-operation','confirm-compatibility','troubleshoot','ask-software-function','request-service'].includes(decision.action);
 const feedback=active&&!hasSlots&&!raw.models.length&&!queryAct&&/^(?:(?:这个|这|回答|答复|方案|感觉|还是|有点|我觉得)\s*)*(?:(?:不太|不够|不怎么|不|太)(?:行|满意|合适|准确|清楚)|答错了?|没看懂|看不懂)[啊呀呢吧了。！!\s]*$/.test(text);
 let relation='NEW_TOPIC',target=null,reason='independent-request',needsInput=false;
 if(raw.intent==='social'){relation='CONTINUE';target=active;reason='social-does-not-change-task';}
 else if(cancel){relation='CORRECT';target=active;reason='explicit-cancel';needsInput=!target;}
 else if((resume||update.commands.revert&&active?.type!=='ordering')&&!reset&&!queryAct){
  const candidates=store.tasks.filter(t=>t.type==='ordering'&&['active','suspended'].includes(t.status)&&fields.every(f=>JSON.stringify(valueAt(t.ordering?.confirmed,f.path))===JSON.stringify(f.value)));
  if(candidates.length===1){relation='RESUME';target=candidates[0];reason='unique-referenced-task';}
  else{relation='UNCLEAR';needsInput=true;reason=candidates.length?'multiple-resumable-tasks':'no-resumable-task';}
 }else if(feedback){relation='FEEDBACK';target=active;reason='evaluation-of-last-answer';}
 else if(active?.type==='aftersales'&&isOutcomeUpdate(text)){relation='CONTINUE';target=active;reason='reported-check-outcome';}
 else if(active&&raw.intent==='product'&&!active.context?.models?.length&&(active.context?.chips?.length||active.context?.missing?.includes('query-object'))){relation='CONTINUE';target=active;reason='fill-requested-identity';}
 else if(correction&&active?.type!=='ordering'&&active&&raw.models.length&&!queryAct){relation='CORRECT';target=active;reason='replace-task-object';}
 else if(active?.type==='ordering'&&/^配单方案[:：]\s*\d+$/.test(text)){relation='CONTINUE';target=active;reason='select-generated-plan';}
 else if(!reset&&active?.type==='ordering'&&planning.related&&!raw.models.length&&!raw.software?.length){relation='CONTINUE';target=active;reason='ordering-planning-preference';}
 else if(!reset&&active?.type==='ordering'&&!queryAct&&(hasSlots||fieldReply||update.pending||raw.intent==='ordering')){
  relation=correction||fields.some(f=>valueAt(active.ordering?.confirmed,f.path)!==undefined&&JSON.stringify(valueAt(active.ordering.confirmed,f.path))!==JSON.stringify(f.value))?'CORRECT':'CONTINUE';target=active;reason='typed-slot-update';
 }else if(!reset&&active&&active.type!=='ordering'&&independent&&(!raw.models.length||raw.models.every(m=>(active.context?.models||[]).includes(m)))&&decision.reference){relation=correction?'CORRECT':'CONTINUE';target=active;reason='explicit-task-reference';}
 else if(!reset&&active&&active.type!=='ordering'&&raw.intent==='resources'&&!raw.models.length&&!raw.unknownModels?.length&&!raw.software?.length&&active.context?.models?.length&&!decision.objects.some(o=>['interface','module','software'].includes(o.type))){relation='CONTINUE';target=active;reason='resource-followup-same-product';}
 else if(!reset&&active&&active.type!=='ordering'&&independent&&!raw.models.length&&!raw.software?.length&&decision.missing?.some(m=>['query-object','operation-object','referenced-file'].includes(m))){relation='CONTINUE';target=active;reason='same-object-missing-identity';}
 else if(active&&raw.intent==='clarify'||((hasSlots||update.geometry.values)&&active?.type!=='ordering'&&store.tasks.some(t=>t.type==='ordering'&&t.status==='suspended')&&!/配单|配屏|选型/.test(text))){relation='UNCLEAR';reason='unresolved-task-or-field';needsInput=true;}
 // Multiple goals must not silently update only the chosen focus clause.
 const slotAndQuery=active?.type==='ordering'&&queryAct&&(decision.frames||[]).some(c=>leaves(parseOrderingFields(c.text)).length>0&&chatIntent(c.text,lookup,{orderingContext:active.ordering}).intent==='ordering');
 if(decision.alternatives?.length>1||slotAndQuery){relation='UNCLEAR';target=null;needsInput=true;reason='multiple-actions';}
 const ordering=(target?.type==='ordering'||!target&&relation==='NEW_TOPIC'&&raw.intent==='ordering')&&!cancel&&['NEW_TOPIC','CONTINUE','CORRECT','RESUME'].includes(relation)&&raw.intent!=='social';
 let resolvedUpdate=target&&target!==active?messageUpdate(input,target):update;
 if(ordering&&resolvedUpdate.commands.revert&&relation!=='RESUME'){
  const revision=target?.revisions?.findLast(r=>r.changes?.length);
  if(revision){resolvedUpdate.restore=clone(revision.before);resolvedUpdate.pending=null;resolvedUpdate.clarification=null;}
  else{resolvedUpdate.clarification='当前任务没有可撤销的字段修改。请说明要恢复哪项条件或给出原值。';}
 }
 if(ordering&&resolvedUpdate.pending?.geometry&&!resolvedUpdate.clarification){const g=resolvedUpdate.pending.geometry;resolvedUpdate.clarification='还保留着'+Object.values(g.values||{}).join('×')+'，请确认这是'+(g.entity==='module'?'模组':'整屏')+'像素分辨率，还是实际尺寸（毫米或米）？';}
 if(ordering&&resolvedUpdate.clarification){needsInput=true;reason='field-meaning-needed';}
 return {relation,taskId:target?.id||null,reason,needsInput,cancel,ordering,original:text,executionText:ordering?input:text,raw,delta:resolvedUpdate.delta,update:resolvedUpdate,store,target,social:raw.intent==='social'};
}
function commitTask(plan,context,orderingState){
 const store=clone(plan.store);
 if(plan.social)return store;
 let target=store.tasks.find(t=>t.id===plan.taskId);
 if(plan.cancel&&target){target.status='cancelled';if(store.activeId===target.id)store.activeId=null;}
 else if(!['FEEDBACK','UNCLEAR'].includes(plan.relation)){
  if(!target){target={id:'task-'+(++store.sequence),type:context.intent,status:'active',revision:0};store.tasks.push(target);}
  for(const t of store.tasks)if(t.id!==target.id&&t.status==='active')t.status='suspended';
  target.status='active';store.activeId=target.id;target.revision++;
  if(target.type!=='ordering')target.type=context.intent;
  if(!plan.needsInput)target.context={...clone(context),ordering:undefined,taskState:undefined};
  const before=clone(target.ordering?.confirmed||{});
  if(orderingState)target.ordering=clone(orderingState);
  else if(target.type==='ordering'&&target.ordering&&plan.needsInput){target.ordering.confirmed=require('./ordering-demand.cjs').mergeOrderingDemand(target.ordering.confirmed,plan.delta);target.ordering.derived=[];target.ordering.simulations=[];target.ordering.candidates=[];}
  else if(target.type==='ordering'&&!target.ordering)target.ordering={confirmed:{schemaVersion:'2.0',operation:'ordering',...clone(plan.delta)},pending:[],derived:[],candidates:[],simulations:[],stage:'needs-input'};
  if(target.type==='ordering')target.pendingUpdate=clone(plan.update?.pending||null);
  if(plan.update?.resolvedGeometry)target.geometryFocus=clone(plan.update.resolvedGeometry);
  if(plan.update?.restore)delete target.geometryFocus;
  const after=target.ordering?.confirmed||{},keys=new Set([...leaves(before),...leaves(after)].filter(f=>!['/topic','/schemaVersion','/operation'].includes(f.path)).map(f=>f.path));
  const changes=[...keys].filter(path=>JSON.stringify(valueAt(before,path))!==JSON.stringify(valueAt(after,path))).map(path=>({path,before:valueAt(before,path)??null,after:valueAt(after,path)??null,source:after.provenance?.[path]||{kind:'user-change',text:plan.original}}));
  target.revisions=[...(target.revisions||[]),{revision:target.revision,userQuote:plan.original,relation:plan.relation,before,changes}].slice(-30);
  target.focus=target.pendingUpdate?{kind:'field-meaning',fields:['geometry.entity','geometry.unit']}:target.ordering?.pending?.[0]||{path:context.missing?.[0]||null};
  target.completed=plan.update?.commands.complete===true||target.completed||false;
  if(target.completed){target.status='completed';store.activeId=null;}
  target.lastRelation={relation:plan.relation,operations:clone(plan.update?.operations||[]),userQuote:plan.original};
  target.excludedConditions=[...(target.excludedConditions||[]),...(plan.update?.operations||[]).filter(o=>o.op==='exclude')].slice(-40);
 }
 store.events=[...(store.events||[]),{relation:plan.relation,taskId:target?.id||null,reason:plan.reason,revision:target?.revision||null,userQuote:plan.original,fields:leaves(plan.delta).map(f=>f.path)}].slice(-40);
 // Keep unfinished engineering tasks; expire old query tasks, not their chat log.
 const queries=store.tasks.filter(t=>t.type!=='ordering'&&t.id!==store.activeId);
 const discard=new Set(queries.slice(0,Math.max(0,queries.length-8)).map(t=>t.id));
 store.tasks=store.tasks.filter(t=>!discard.has(t.id));return store;
}
module.exports={taskState,decideTask,commitTask,isOutcomeUpdate};
