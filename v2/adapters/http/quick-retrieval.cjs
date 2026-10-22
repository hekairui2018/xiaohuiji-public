'use strict';
const {parseQuickQuery,matchesConcept,concepts,norm}=require('../../domain/knowledge/quick-query.cjs');
const {extractKnownModels}=require('../../domain/identity/extract-models.cjs');
const {modelId}=require('../../domain/identity/model-id.cjs');
const {createQuickService}=require('./quick-service.cjs');
const {aftersalesGuidance,operationExcerpt,relevantEvidence}=require('./quick-answer.cjs');
const {canonical,evidencePlan,compareScene,capabilityExcerpt}=require('../../domain/knowledge/evidence-plan.cjs');
const {videoPurpose}=require('../../domain/knowledge/video-purpose.cjs');
function createQuickRetrieval({app,knowledge,search,searchCases,faqLookup,localCatalog,resolveDocuments,localizeMedia=async x=>x,originalDocuments=[],businessAnswer,searchContext,readContext,filterEvidence=async rows=>rows}){
 const indexedProducts=new Map((knowledge?.products?.()||[]).map(p=>[p.modelId,p]));
 const lookup={findProducts:id=>knowledge?.findProducts?.(id)||(indexedProducts.has(id)?[indexedProducts.get(id)]:app?.quickSearch?.(id).records||[]),products:()=>[...indexedProducts.values()],chipLookup:t=>app?.chipLookup?.(t),softwareItems:t=>app?.resourceMedia?.softwareItems(t)||[],isSoftware:t=>!!app?.resourceMedia?.softwareItems(t).length};
 const quick=app&&createQuickService(app,{localCatalog,resolveDocuments});
 let videoCatalog=null,videoIndex=null;
 async function indexedVideos(){
  const catalog=await localCatalog();if(catalog===videoCatalog&&videoIndex)return videoIndex;
  const byModel=new Map(),all=[];
  for(const r of catalog){if(!/\.(mp4|webm|mov)$/i.test(r.name)||r.availabilityState&&r.availabilityState!=='present')continue;
   const purpose=videoPurpose(r,[r]);if(purpose.purpose!=='operation')continue;
   const titled=extractKnownModels(r.name,lookup),ids=titled.length?titled:extractKnownModels((r.folders||[]).join(' '),lookup);
   const row={type:'document',category:'video',name:r.name,sha256:r.sha256,resourceId:r.resourceId,resourceVersionId:r.versionId,sourceLocationId:r.locationId,modelIds:ids,associationBasis:titled.length?'exact-title-model':'registered-source-model',purposeBasis:purpose.purposeBasis,download:r.locationId?'/v2/offline/file?id='+r.locationId:r.url||r.publicUrl,evidenceId:r.sha256?'file-'+r.sha256:r.versionId||r.resourceId||'location-'+r.locationId};
   all.push(row);for(const id of ids){if(!byModel.has(id))byModel.set(id,[]);byModel.get(id).push(row);}
  }
  videoCatalog=catalog;return videoIndex={all,byModel,registeredVideoCount:catalog.filter(r=>/\.(mp4|webm|mov)$/i.test(r.name)).length};
 }
 const originalByModel=new Map();for(const {document:d} of originalDocuments)for(const id of extractKnownModels(d.name,lookup)){if(!originalByModel.has(id))originalByModel.set(id,[]);originalByModel.get(id).push(d);}
 function chipEvidence(query){const data=lookup.chipLookup(query);return (data?.items||[]).map(r=>({type:'chip',name:'芯片选型 '+r.sourceReference?.sourceVersion,text:r.models.join('/')+'；智能设置：'+r.smartSelection+'；资料固件类别：'+r.firmwareType,chips:r.models,locator:{page:r.page},evidenceId:'chip-'+r.models.join('-'),sourceReference:{name:'芯片选型 '+r.sourceReference?.sourceVersion,page:r.page,sha256:r.sourceReference?.sha256},verified:true}));}
 async function answer(message,{state={},facts={},currentFacts={},onProgress=()=>{}}={}){
  const q=parseQuickQuery(message,lookup,state),trace=[],lists=[],failures=[];
  // Session-global facts must not reintroduce identities excluded by task routing.
  facts={...(q.taskPlan.target?.context?.facts||{}),...require('../../domain/aftersales/case-search.cjs').validateFacts(currentFacts)};
  if(q.taskPlan.ordering||['UNCLEAR','FEEDBACK'].includes(q.taskPlan.relation))facts={};
  let scopedFacts=facts;
  const newTopicObject=!q.decision.reference&&(q.decision.objects||[]).some(o=>['interface','module','software'].includes(o.type));
  if(!q.social&&!q.ambiguous){if(!newTopicObject&&!q.models.length&&!q.unknownModels.length&&!q.numeric&&!q.chips.length&&!q.software.length&&facts.modelIds?.length)q.models=facts.modelIds.map(modelId).filter(m=>lookup.findProducts(m).length).slice(0,3);const sameModels=!facts.modelIds?.length||!q.models.length||q.models.every(m=>facts.modelIds.map(modelId).includes(m)),sameChips=!q.chips.length||!facts.chips?.length||q.chips.every(c=>facts.chips.includes(c));if(sameModels&&sameChips&&!q.software.length){q.chips=[...new Set([...q.chips,...facts.chips||[]])];for(const [field,kind]of [['hardwareVersions','hardware'],['firmwareVersions','firmware'],['softwareVersions','software']])for(const value of facts[field]||[])q.versions.push({kind,value});}}
  q.evidencePlan=evidencePlan(q);
  const routeLog={intent:q.intent,entities:{models:q.models,chips:q.chips,software:q.software||[]},decision:q.decision,evidencePlan:q.evidencePlan,contextUsed:!!q.contextUsed,numericCandidates:q.numericCandidates||[],sources:trace,candidates:[],recall:[],filtered:{},candidateCount:0,retainedCount:0,answerType:null};
  if(facts.modelIds?.length&&q.models.length&&!q.models.every(m=>facts.modelIds.map(modelId).includes(m))||facts.chips?.length&&q.chips.length&&!q.chips.every(c=>facts.chips.includes(c)))scopedFacts={};
  const finish=output=>{const {orderingState,...visible}=output;routeLog.answerType=visible.answerType||visible.status||visible.intent;if(orderingState){routeLog.entities.models=(orderingState.confirmed.providedDevices||[]).map(d=>d.modelId);routeLog.candidateCount=orderingState.candidates.length;routeLog.retainedCount=orderingState.candidates.length;routeLog.ordering={resumed:!!q.orderingContext,confirmedFields:Object.keys(orderingState.confirmed.provenance||{}),pendingFields:orderingState.pending.map(p=>p.path),candidateCount:orderingState.candidates.length,simulationCount:orderingState.simulations.length};}routeLog.businessStatus=visible.businessStatus||{intent:q.intent==='clarify'?'unrecognized':'identified',evidence:(visible.results||[]).length?'found':'none',answer:q.intent==='compatibility'&&q.decision.missing.length||visible.status==='clarify'||/insufficient|unavailable|not-registered|unrecognized/.test(visible.answerType||'')?'needs-input':visible.answerType==='conditional-cases'?'conditional-reference':visible.answerType==='resource-evidence'?'resources-found':'answered'};return {...visible,routeLog,quickContext:{models:q.models,chips:q.chips||[],software:q.software||[],intent:q.intent,query:q.query,ordering:orderingState||q.orderingContext||null}};};
  const oldFinish=finish;
  const complete=output=>{
   const result=oldFinish(output),context=result.quickContext;
   context.missing=q.decision.missing||[];
   context.retrieval={categories:q.categories,attributes:q.attributes,concepts:q.concepts,versions:q.versions,operation:q.operation};
   context.facts={...facts,modelIds:q.models,chips:q.chips||[]};
   for(const [field,kind]of [['hardwareVersions','hardware'],['firmwareVersions','firmware'],['softwareVersions','software']])context.facts[field]=q.versions?.filter(v=>v.kind===kind).map(v=>v.value)||[];
   context.taskState=require('../../domain/parser/task-context.cjs').commitTask(q.taskPlan,context,output.orderingState);
   // Compatibility projection only; ownership lives in taskState. Other tasks
   // cannot consume this projection as their confirmed conditions.
   context.ordering=(context.taskState.tasks.find(t=>t.id===context.taskState.activeId&&t.type==='ordering')||context.taskState.tasks.findLast(t=>t.type==='ordering'&&t.status==='suspended'))?.ordering||null;
   return result;
  };
  const base={intent:q.intent,kind:'all',query:q.original,queryPlan:q,results:[],retrievalTrace:trace,modelCallCount:0};
  if(q.taskPlan.cancel)return complete({...base,status:'clarify',answerType:'task-cancelled',reply:q.taskPlan.taskId?'已结束当前任务，聊天记录保留。':'当前没有可结束的任务。'});
  if(q.taskPlan.relation==='FEEDBACK')return complete({...base,intent:'feedback',status:'clarify',answerType:'answer-feedback',reply:'你对上一条答复不满意。是条件理解有误、选型不合适，还是需要换一种解释？已有条件先保留。'});
  if(q.taskPlan.needsInput&&q.taskPlan.reason!=='multiple-actions')return complete({...base,intent:q.taskPlan.ordering?'ordering':'clarify',status:'clarify',answerType:q.taskPlan.ordering?'task-field-clarification':'task-relation-unclear',reply:q.taskPlan.update?.clarification||(q.taskPlan.reason==='multiple-resumable-tasks'?'有多个未完成配单，请说明要继续哪块屏（例如点间距或尺寸）。':q.taskPlan.reason==='no-resumable-task'?'当前没有可恢复的配单，请告诉我要配哪块屏。':'这句话的归属尚不明确，请指出要继续哪个任务，已有条件保留。')});
  if(q.social)return complete({...base,intent:'social',reply:/谢|thanks/.test(q.original)?'不客气。':'你好！我可以查询产品参数、资料和历史售后案例，请告诉我型号或问题。'});
  if(q.intent==='aftersales'&&!q.models.length&&!q.software.length&&!q.chips.length&&!q.unknownModels.length){
   const discovery=q.concepts.includes('wifi')&&q.concepts.includes('discovery'),sending=q.concepts.includes('program-send');
   if(discovery||sending)return complete({...base,status:'clarify',answerType:'fault-scope-question',businessStatus:{intent:'identified',evidence:'task-object-needed',answer:'needs-input'},reply:discovery?'你是搜不到控制卡发出的Wi-Fi热点，还是软件连上Wi-Fi后搜不到设备？先确认这一点，再按对应环节排查。':'你现在使用哪款软件发送节目？先确认软件，再区分找不到设备、连接失败和发送失败。',results:[]});
  }
  if(q.intent==='aftersales'&&!q.models.length&&!q.software.length&&!q.chips.length&&q.unknownModels.length===0&&/连不上|连接不上|网口.{0,4}(?:没有输出|无输出)/.test(q.original)&&!q.symptoms.some(x=>!['network','no-output'].includes(x)))return complete({...base,status:'clarify',answerType:'fault-identity-question',reply:'你用的设备型号是什么？连接问题还请说明是网线、Wi-Fi还是USB；先确认这一步，再查对应原因。',results:[]});
  if(q.intent==='service')return complete({...base,status:'clarify',answerType:'service-needs-confirmation',businessStatus:{intent:'identified',evidence:'service-directory-not-registered',answer:'needs-input'},reply:/保修期|保修政策/.test(q.original)?'你问的是售后保修期限。目前未接入已核实的保修政策，请提供产品型号和购买日期后向售后核对，不能把其他产品的期限直接套用。':/钱|报价|价格/.test(q.original)?'你要咨询'+(q.models.length?q.models.join('、'):'产品')+'的价格。报价需要销售确认；请补充'+(q.models.length?'数量和所在地区':'型号、数量和所在地区')+'。':/上班|工作时间/.test(q.original)?'你问的是技术支持的工作时间。当前没有已核实的排班信息，请通过现有服务联系人确认。':/报修/.test(q.original)?'你需要报修。请先提供设备型号和故障现象，以便整理报修信息；目前尚未创建维修工单。':'你需要联系人工或销售。请告诉我所在地区和要咨询的事项；当前没有已核实的地区联系人，也尚未实际转接。'});
  if(q.decision.missing.includes('action-priority')){
   const labels={'query-parameters':'看参数','find-resources':'找说明书','troubleshoot':'排查故障','guide-operation':'看操作步骤','plan-engineering':'配单','confirm-compatibility':'核对兼容性','ask-software-function':'了解软件功能'};
   const goals=q.decision.alternatives.map(a=>labels[a]||'确认具体问题');
   return complete({...base,status:'clarify',answerType:'multiple-actions',businessStatus:{intent:'identified-multiple',evidence:'not-requested-yet',answer:'needs-input'},reply:goals.length===2&&goals.includes('看参数')&&goals.includes('找说明书')?'你同时提出了参数查询和找说明书两个需求，先看参数，还是先找说明书？':'你提出了多个需求，先'+goals.join('，还是先')+'？'});
  }
  if(q.ambiguous)return complete({...base,status:'clarify',answerType:'ambiguous-entity',reply:'这个数字有多个已登记候选：'+[...q.numericCandidates.map(c=>c.modelId),...q.chipCandidates.flatMap(c=>c.models)].join('、')+'。请确认完整型号或芯片名，确认前不套用参数或固件。'});
  if(q.evidencePlan.purpose==='service-access'&&!q.software.length)return complete({...base,status:'clarify',answerType:'service-object-needed',reply:'是哪款软件、平台或服务显示了到期提示？请先告诉我提示出现的位置，我再核对对应的服务或授权说明。',results:[]});
  if(q.evidencePlan.purpose==='software-selection'&&!q.models.length)return complete({...base,status:'clarify',answerType:'software-device-needed',reply:'请先告诉我盒子或控制设备的完整型号，我再核对适用的软件；升级教程里提到的软件不能直接当作这台设备的配套软件。',results:[]});
  if(q.intent==='resources'&&q.models.length>1&&!q.compatibility){
   if(q.models.length>4)return complete({...base,status:'clarify',answerType:'request-budget',reply:'请先选最多四款设备，我会分别核对各自的资料。'});
   const clauses=q.original.split(/[，,。；;！？!?]/).filter(Boolean),replies=[],combined=new Map(),subrequests=[];
   for(const id of q.models){const scoped=clauses.filter(c=>{const ids=extractKnownModels(c,lookup);return !ids.length||ids.includes(id);});let text=(scoped.length?scoped:clauses).join('；');
    text=text.replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*/gi,t=>extractKnownModels(t,lookup).some(m=>m!==id)?'':t);
    const child=await answer('查找资料：'+text,{state:{},facts:{},onProgress});replies.push(id+'：\n'+child.reply);subrequests.push({model:id,query:text,route:child.routeLog});
    for(const r of child.results){const key=r.sha256||r.resourceVersionId||r.download||r.evidenceId;const prior=combined.get(key);if(prior)prior.requestedForModels.push(id);else combined.set(key,{...r,requestedForModels:[id]});}
   }
   routeLog.subrequests=subrequests;routeLog.candidateCount=subrequests.reduce((s,r)=>s+r.route.candidateCount,0);return complete({...base,status:combined.size?'answer':'not-found',answerType:'multi-resource-answer',reply:replies.join('\n\n'),results:[...combined.values()]});
  }
  if(q.intent==='resources'&&q.categories.includes('video')&&q.models.length&&localCatalog){
   const index=await indexedVideos(),rows=q.models.flatMap(id=>index.byModel.get(id)||[]),allowed=await filterEvidence(rows);
   const ranked=rank(q,[{source:'registered-video-index',rows:allowed}],lookup,routeLog.filtered,routeLog.candidates),seen=new Set(),selected=[];
   for(const r of ranked){const key=r.candidate.sha256||r.candidate.resourceVersionId||r.candidate.download;if(!seen.has(key)){seen.add(key);selected.push({...r.candidate,rankingSignals:r.signals});}if(selected.length===4)break;}
   routeLog.videoIndex={registered:index.registeredVideoCount,operation:index.all.length,modelCandidates:rows.length,ranked:ranked.length,displayed:selected.length};routeLog.candidateCount=rows.length;routeLog.retainedCount=selected.length;
   trace.push({name:'registered-video-index',count:rows.length});return complete({...base,status:selected.length?'answer':'not-found',answerType:selected.length?'model-video-resources':'model-video-not-registered',reply:selected.length?'找到 '+q.models.join('、')+' 的相关操作视频：'+selected.map(r=>r.name).join('；')+'。关联依据为视频名称或已登记来源，不代表已验证所有版本适用。':'已查已登记操作视频，未找到能确认属于 '+q.models.join('、')+' 的对应资料；不会用其他型号或宣传视频替代。',results:selected});
  }

  if(q.intent==='ordering'&&q.decision.orderingKind==='accessory')return complete({...base,status:'clarify',answerType:'accessory-scope-question',reply:'你要选通信模块。请提供主控型号和当地运营商，我再查已登记模块的适用资料。',results:[]});
  // Choosing a product by capabilities is not yet a request to calculate an
  // LED screen BOM. Preserve supplied requirements and ask the missing usage
  // condition before invoking the screen-specific deterministic calculator.
  if(q.intent==='ordering'&&q.decision.orderingKind==='catalog-selection'&&(/LCD/i.test(q.original)?!/独立|复制|同一个画面/.test(q.original):!/同步|异步/.test(q.original)))return complete({...base,status:'clarify',answerType:'product-selection-scope',businessStatus:{intent:'identified',evidence:'usage-condition-needed',answer:'needs-input'},reply:'已保留你的设备能力要求：“'+q.original+'”。'+(/LCD/i.test(q.original)?'多路视频输出需要各路独立播放，还是复制同一个画面？':'你需要同步输入，还是异步播放？')+'确认使用方式后再核对产品适用证据。',results:[]});
  if(q.intent==='ordering'&&q.decision.orderingKind!=='catalog-selection'&&businessAnswer){const data=await businessAnswer({intent:'ordering',query:q.executionText||q.original,models:q.models,demand:q.demand,taskUpdate:q.taskUpdate,unknownModels:q.unknownModels,hardwareRequested:q.versions.some(v=>v.kind==='hardware')||!!facts.hardwareVersions?.length,progressive:true,orderingContext:q.orderingContext},{facts,sessionId:state.id});trace.push(...data.retrievalTrace||[]);return complete({...base,...data,answerType:'engineering'});}
  const add=(source,rows)=>{routeLog.recall.push(...rows.map(r=>({source,name:r.name,type:r.type,sha256:r.sha256,locator:r.locator,beforeRankingTruncated:false})));lists.push({source,rows});trace.push({name:source,count:rows.length,sourceKind:'evidence-list'});};
  async function call(name,fn){onProgress('searching');const at=Date.now();try{const rows=await fn();if(rows.length)onProgress('evidence-found');trace.push({name,elapsedMs:Date.now()-at,count:rows.length});return rows;}catch{failures.push(name);trace.push({name,elapsedMs:Date.now()-at,count:0,unavailable:true});return [];}}
  async function textSearch(query){const rows=await Promise.all((q.models.length?q.models.slice(0,3):[null]).map(model=>search(query,'text',{limit:24,model:model?.replace(/^HD-/,''),version:q.versions.find(v=>v.kind==='version')?.value})));const candidates=rows.flatMap(d=>d.results||[]).map(r=>{const parts=(r.text||'').split(' | '),faq=/\.csv$/i.test(r.name||'')&&/FAQ|FQA|常见问题|问答/i.test(r.name||'')&&parts.length>=3;return {...r,type:faq?'faq':'passage',...(faq?{standardQuestion:parts[1],standardAnswer:parts[2],faqExact:norm(q.original).replace(/[\s，。！？!?]/g,'')===norm(parts[1]).replace(/[\s，。！？!?]/g,'')}:{} )};});return faqLookup?.hydrate?faqLookup.hydrate(candidates):candidates;}
  if(q.evidencePlan.purpose==='component-dependency'&&q.models.length&&!q.versions.length){
   const rows=[];for(const id of q.models)for(const d of originalByModel.get(id)||[])for(const page of d.pages||[]){const text=capabilityExcerpt(page.text,q.evidencePlan);if(text)rows.push({type:'capability',name:d.name,text,modelIds:[id],sha256:d.sha256,locator:{page:page.page},download:'/v2/resources/original/'+d.sha256,evidenceId:d.sha256+'-architecture-'+page.page,sourceRole:'original-component-architecture'});}
   const allowed=await filterEvidence(rows),ranked=rank(q,[{source:'original-architecture',rows:allowed}],lookup,routeLog.filtered,routeLog.candidates);
   const proof=ranked.find(r=>/相当于自带|自带.{0,12}接收卡|built.in receiv/i.test(r.candidate.text));
   if(proof){routeLog.candidateCount=rows.length;routeLog.retainedCount=1;const r=proof.candidate;return complete({...base,status:'answer',answerType:'component-architecture-answer',reply:'不一定需要外接接收卡。该型号原文说明：\n'+r.text+'\n可使用板载接收能力；是否另配接收卡，还需核对屏幕分辨率、接口和带载条件。\n来源：'+r.name+' · 第'+r.locator.page+'页。',results:[{...r,rankingSignals:proof.signals}]});}
  }
  if(q.intent==='resources'&&q.categories.includes('firmware')&&q.chips.length&&!q.models.length){
   const chips=await filterEvidence(await call('registered-chip-table',async()=>chipEvidence(q.chips.join(' '))));
   return complete({...base,status:'clarify',answerType:'firmware-receiver-needed',businessStatus:{intent:'identified',evidence:chips.length?'registered-chip-table':'chip-not-confirmed',answer:'needs-input'},reply:'你给了芯片线索 '+q.chips.join('、')+'。要找对应固件，还需确认接收卡完整型号。你使用的是哪款接收卡？',results:chips});
  }
  // Reuse the registered software access/manual/video catalog, not case FTS,
  // for requests whose object is a software download or software tutorial.
  const softwareResource=q.intent==='resources'&&!q.models.length&&!q.chips.length&&(q.software.length||q.decision.objects.some(o=>o.type==='software')||/APP|软件下载|安装包/i.test(q.original));
  const genericSoftwareOperation=q.intent==='operation'&&q.software.length&&/^(?:请问|你好|您好|请|帮我|教我|一下|的|怎么|如何|使用|操作|方法|调试|软件|教程|有没有|步骤|步奏|[\s，。！？!?])*$/.test(q.original.replace(new RegExp(q.software.map(x=>x.replace(/\s/g,'').split('').map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s_-]*')).join('|'),'gi'),''));
  if(quick&&(softwareResource||genericSoftwareOperation)){
   if(!q.software.length)return complete({...base,status:'clarify',answerType:'software-choice',reply:'你要下载哪一款软件？请告诉我设备型号，或选择屏掌控、HDPlayer、HDSet、LCD Player；不同软件用途不同。',results:[]});
   const body=await localizeMedia(await quick.software(q.software.join(' '))),items=(body.software?.items||[]).filter(i=>q.software.some(name=>norm(name)===norm(i.name))),rows=[];
   for(const item of items){
    if(q.categories.includes('video')){for(const v of [item.videos?.primary,...item.videos?.more||[]].filter(Boolean))if(v.url||v.publicUrl)rows.push({type:'document',category:'video',name:v.name,download:v.url||v.publicUrl});}
    else if(q.categories.includes('manual')||genericSoftwareOperation){for(const m of item.manuals||[])if(m.url||m.publicUrl)rows.push({type:'document',category:'manual',name:m.name||m.label,documentLanguage:m.documentLanguage||m.language,download:m.url||m.publicUrl});}
    else if(item.downloadUrl)rows.push({type:'document',category:'software',name:item.name,download:item.downloadUrl});
   }
   const allowed=(await filterEvidence(rows)).filter(r=>matchesResourceRequest(q,r));
   if(allowed.length)return complete({...base,status:'answer',answerType:genericSoftwareOperation?'software-start-directions':'registered-software-resources',reply:genericSoftwareOperation?items.map(i=>i.name+'：'+i.purpose).join('\n')+'\n已列出对应操作资料。你现在要连接设备、编辑发送节目，还是调屏？': '已找到对应的'+(q.categories.includes('video')?'操作视频':q.categories.includes('manual')?'操作说明':'软件下载入口')+'，可从下方打开。',results:allowed.slice(0,8)});
  }
  // An exact existing FAQ question is evidence, never an intent classifier.
  // Present its complete row first rather than burying it under unrelated cases.
  if(faqLookup){
   const exact=await filterEvidence(await call('registered-faq-exact',()=>faqLookup(q.original)));
   if(exact.length){
    const answerGroups=new Map();for(const r of exact){const key=r.standardAnswer.trim();if(!answerGroups.has(key))answerGroups.set(key,[]);answerGroups.get(key).push(r);}
    const answers=[...answerGroups.keys()];
    const conflict=answers.length>1;
    const warning=q.compatibility?'仍需核对固件文件、硬件、芯片和当前实读版本；这条历史记录不能确认现场兼容，请勿据此互刷。':'这是已有FAQ原记录，请核对原文中的型号、版本及现场条件；其中历史固件或参数不自动视为当前推荐。';
    return complete({...base,status:conflict?'clarify':'answer',answerType:conflict?'faq-conflicting-records':'faq-exact-record',results:exact,
     businessStatus:{intent:q.intent==='clarify'?'needs-clarification':'identified',evidence:conflict?'conflicting-exact-records':'exact-question-row',answer:conflict||q.compatibility?'needs-input':'conditional-reference'},
     reply:(conflict?'同一问题有不同FAQ原记录，不能合并成一个确定结论。\n\n':'')+[...answerGroups.values()].map(group=>{const r=group[0];return 'FAQ原记录（原问题匹配）：'+r.standardQuestion+'\n'+r.standardAnswer+'\n来源：'+group.map(x=>x.name+' · 第'+x.locator.row+'行').join('；');}).join('\n\n')+'\n\n'+warning});
   }
  }
  // Structured catalog preparation is shared by all categories for a model.
  if(q.intent==='operation'&&q.models.length&&/(?:用|使用).{0,4}(?:什么|哪个|那个|哪款)软件|调试软件/.test(q.original)){
   const rows=[];
   for(const id of q.models)for(const d of originalByModel.get(id)||[]){
    if(!extractKnownModels(d.name,lookup).includes(id))continue;
    for(const page of d.pages||[])for(const line of page.text.split(/\n|(?<=[。；;])/))
     if(/HDSet|HDPlayer|HDSign|HDShow|LCD.?Player|屏掌控/i.test(line)&&(/制作|编辑|节目/.test(q.original)?/制作|编辑|节目/.test(line):/调试|设置/.test(line))&&line.length<700)
      rows.push({type:'operation',name:d.name,text:line,sha256:d.sha256,modelIds:[id],locator:{page:page.page},evidenceId:d.sha256+'-software-'+page.page});
   }
   const permitted=await filterEvidence(rows.slice(0,6));
   if(permitted.length)return complete({...base,status:'answer',answerType:'software-selection-original',reply:permitted.map(r=>r.text+'\n来源：'+r.name+' · 第'+r.locator.page+'页').join('\n\n'),results:permitted});
  }
  const products=quick&&['resources','product'].includes(q.intent)?await call('exact-product-catalog',async()=>{const rows=await Promise.all(q.models.slice(0,3).map(async id=>({id,data:await localizeMedia(await quick.search(id))})));return rows.flatMap(({id,data})=>(data.results||[]).filter(p=>p.modelId===id));}):[];
  const wanted=q.categories.length?q.categories:['spec','manual','firmware'];
  for(const category of wanted){const docs=products.flatMap(p=>(p.docGroups||[]).filter(g=>g.key===category).flatMap(g=>g.items.map(d=>({...d,associatedModel:p.modelId,category}))));add('catalog',docs.map(d=>({type:'document',resourceType:d.resourceType,source:d.source,relations:d.relations,scopeEvidence:d.scopeEvidence,applicableModels:d.applicableModels,name:d.name,documentLanguage:d.documentLanguage,category,modelIds:[d.associatedModel],text:d.reviewRequired?'资料关联仍需核对现场条件。':null,download:d.available?d.url:null,downloadUrl:d.downloadUrl,sha256:d.sha256,evidenceId:d.sha256?'file-'+d.sha256:d.resourceVersionId,documentVersion:d.documentVersion,available:d.available,associationStatus:d.associationStatus,hardwareConfirmed:false})));}
  const claims=[];
  for(const id of q.models)for(const p of lookup.findProducts(id))for(const c of (q.intent==='parameters'?p.claims||[]:[])){
   const refs=(c.sourceReferences||[c.sourceReference]).filter(r=>r?.originalSha256&&r.originalName&&r.verificationStatus==='verified');
   if(c.verificationStatus!=='verified'||!refs.length)continue;
   if(q.attributes.length&&!q.attributes.some(a=>matchesConcept(a,c.text)))continue;
   for(const ref of refs.slice(0,1))claims.push({type:'parameter',name:ref.originalName,text:c.text,conditions:ref.conditions||[],documentVersion:ref.documentVersion,modelIds:[id],evidenceId:c.claimId,sha256:ref.originalSha256,locator:ref.page?{page:ref.page}:ref.locator,download:'/v2/resources/original/'+ref.originalSha256,field:c.field,verified:true});
  }
  add('parameters',claims);
  if(q.attributes.length&&!claims.length){const raw=[];for(const id of q.models)for(const d of (originalByModel.get(id)||[]).slice(0,3))for(const page of (d.pages||[]).slice(0,20)){
   const lines=page.text.split(/\n|(?<=[。；;])/).filter(t=>/\d/.test(t)&&q.attributes.some(a=>matchesConcept(a,t)));
   if(lines.length)raw.push({type:'parameter',name:d.name,sha256:d.sha256,modelIds:[id],text:lines.slice(0,3).join('\n'),locator:{page:page.page},evidenceId:d.sha256+'-page-'+page.page,field:'original-parameter-excerpt',verified:false});
  }
  const bounded=raw.slice(0,6);if(bounded.length&&resolveDocuments){const resolutions=await call('parameter-original-resolution',async()=>resolveDocuments(bounded));for(const [i,r]of bounded.entries())if(resolutions[i]?.available){r.download=resolutions[i].url;add('original-parameters',[r]);}}
  }
  // Source plans are hints, not a single business destination. Explicit document
  // requests may finish from the directory; ambiguous/fault inputs query both cases and text.
  const explicitDocs=q.intent==='resources';
  const tasks=[];
  if(!explicitDocs&&!q.deniedFault&&q.intent==='aftersales')tasks.push(call('case-index',async()=>{const data=await searchCases(q.query,null,{...scopedFacts,chips:q.chips,...(q.models.length?{modelIds:q.models}:{})});return (data.results||[]).map(r=>({...r,type:'case',name:r.title||r.phenomenon,text:r.sourceExcerpt||r.phenomenon,download:r.sources?.find(s=>s.original)?.original||'/v2/offline/case?id='+encodeURIComponent(r.id),sourceStatus:r.sources?.some(s=>s.original)?'registered-original':'indexed-case-record-not-original-file',evidenceId:r.id}));}).then(rows=>add('cases',rows)));
  if(explicitDocs&&localCatalog&&resolveDocuments&&(!q.models.length||!lists.some(l=>l.source==='catalog'&&l.rows.some(r=>r.available&&r.download))))tasks.push(call('topic-document-catalog',async()=>{
   const catalog=await localCatalog(),terms=[...q.models.map(m=>m.replace(/^HD-/,'')),...q.software,...(q.decision?.objects||[]).filter(o=>['module','interface'].includes(o.type)).map(o=>o.text),...q.literals.filter(t=>!/搜索|搜不到|找不到|查询|资料|文档|下载/.test(t))];
   if(!terms.length)return [];
   const rows=catalog.filter(r=>/\.(pdf|docx?|pptx?|xlsx?)$/i.test(r.name)&&terms.some(t=>norm(r.name).includes(norm(t)))&&(!q.categories.length||q.categories.includes(/说明书|手册|manual/i.test(r.name)?'manual':/规格书|specification|datasheet/i.test(r.name)?'spec':null))).slice(0,12);
   const resolved=await resolveDocuments(rows);return rows.flatMap((r,i)=>resolved[i]?.available?[{...r,type:'document',category:/说明书|手册|manual/i.test(r.name)?'manual':/规格书|specification|datasheet/i.test(r.name)?'spec':null,download:resolved[i].url,downloadUrl:resolved[i].downloadUrl,available:true,evidenceId:r.sha256||r.resourceId}]:[]);
  }).then(rows=>add('topic-documents',rows)));
  if(q.chips.length)tasks.push(call('registered-chip-table',async()=>chipEvidence(q.chips.join(' ')||q.original)).then(rows=>add('chip-table',rows)));
  if(q.intent==='chip'&&localCatalog&&resolveDocuments)tasks.push(call('chip-related-originals',async()=>{
   const table=lookup.chipLookup(q.chips.join(' ')||q.original),aliases=[...new Set((table?.items||[]).flatMap(r=>[...r.models,...r.numericAliases||[]]))].filter(s=>/^[A-Z0-9]+$/i.test(s));
   const rows=(await localCatalog()).filter(r=>/\.(pdf|docx?)$/i.test(r.name)&&/调试|手册|说明|芯片|规格/.test(r.name)&&aliases.some(a=>new RegExp('(?<![a-z0-9])'+a+'(?![a-z0-9])','i').test(r.name)));
   const originals=await resolveDocuments(rows);return rows.flatMap((r,i)=>originals[i]?.available?[{type:'document',category:'manual',name:r.name,sha256:r.sha256,download:originals[i].url,downloadUrl:originals[i].downloadUrl,available:true,chipIdentityLinked:true,chips:q.chips,evidenceId:r.sha256?'file-'+r.sha256:r.versionId}]:[]);
  }).then(rows=>add('chip-originals',rows)));
  if(q.intent==='operation'&&searchContext&&localCatalog)tasks.push(call('operation-original-context',async()=>{
   const receiverUpgrade=q.operation.upgrade&&(q.models.length?q.models.every(m=>/^HD-R/.test(m)||lookup.findProducts(m).some(p=>/接收卡|receiver/i.test(p.parameters?.productSeries||p.displayName||''))):/接收卡/.test(q.original));
   const catalog=await localCatalog(),software=q.software.length?q.software:q.operation.upgrade&&q.models.some(m=>lookup.findProducts(m).some(p=>/接收卡|receiv/i.test(p.parameters?.productSeries||p.displayName||'')||/^HD-R/.test(m)))?['HDSet']:[];
   const documents=catalog.filter(r=>/\.(?:pdf|docx?)$/i.test(r.name)&&((software.some(s=>norm(r.name).includes(norm(s)))&&/手册|说明|manual|instruction|新手指引/i.test(r.name))||(q.models.length&&q.models.some(m=>extractKnownModels(r.name,lookup).includes(m))&&/手册|说明|规格|specification|manual/i.test(r.name))||(receiverUpgrade&&/接收卡固件升级说明|升级接收卡固件/.test(r.name)))).map(r=>r.name);
   routeLog.operationManualCount=documents.length;
   if(!documents.length)return [];
   const terms=q.operation.terms.filter(Boolean).slice(0,4);if(!terms.length)return [];
   const uniqueDocuments=[...new Set(documents)],candidates=[];for(let offset=0;offset<uniqueDocuments.length;offset+=4)candidates.push(...await searchContext({query:terms.join(' '),concepts:terms.slice(0,2),documents:uniqueDocuments.slice(offset,offset+4),models:[],chips:q.chips,version:q.versions.find(v=>v.kind!=='hardware')?.value}));
   const rows=[],seen=new Set();for(const r of candidates){const context=readContext?await readContext(r):null;if(!context?.text)continue;let excerpt=operationExcerpt(context.text,q.operation);if(q.operation.selectSoftware){const documented=extractKnownModels(r.name+' '+context.text,lookup);if(q.models.length&&!q.models.every(id=>documented.includes(id)))continue;const lines=context.text.split(/\n|(?<=[。；;])/).filter(line=>{const ids=extractKnownModels(line,lookup);return !q.models.length||!ids.length||q.models.some(id=>ids.includes(id));}).filter(line=>/HDSet|HDPlayer|HDSign|HDShow|LCD.?Player|屏掌控/i.test(line)&&/软件|调试|设置|应用|端[:：]|software|application/i.test(line)&&line.length<700&&/调试|配置|屏参|节目|发送|播放|电脑端软件|手机APP|application/i.test(line));excerpt=lines.length?{text:[...new Set(lines)].slice(0,3).join('\n'),sectionFocused:true}:null;}if(!excerpt)continue;const key=r.sha256+'|'+excerpt.text;if(seen.has(key))continue;seen.add(key);rows.push({...r,...context,...excerpt,type:'operation',softwareAssociation:q.operation.selectSoftware&&/电脑端|手机端|手机APP|配套软件|调试软件|应用软件|软件为|软件是|software/i.test(excerpt.text),genericOperation:!q.software.length,software,modelIds:[],evidenceId:r.evidenceId||'operation-'+r.blockId});}
   return rows;
  }).then(rows=>add('operation-originals',rows)));
  if(quick&&(q.categories.includes('software')||q.intent==='software-function'))tasks.push(call('software-catalog',async()=>{const d=await quick.software(q.query);return (d.software?.items||[]).map(r=>({type:q.intent==='software-function'?'software':'document',sourceKind:'registered-software-purpose',category:'software',name:r.name,text:r.purpose,download:r.url||r.downloadUrl}));}).then(rows=>add('catalog',rows)));
  if(explicitDocs&&q.categories.includes('video'))tasks.push(call('video-catalog',async()=>{const d=await localizeMedia({video:{groups:[{videos:app?.resourceLookup?.(q.query)?.items||[]}]}});return (d.video?.groups||[]).flatMap(g=>g.videos||[]).map(r=>({type:'document',category:'video',name:r.name,download:r.publicUrl||r.url}));}).then(rows=>add('catalog',rows)));
  const goodCatalog=lists.some(l=>l.source==='catalog'&&l.rows.some(r=>r.available&&r.download));
  const searchTerms=q.symptoms.length?[...q.symptoms.map(id=>concepts.find(c=>c.id===id).words[0]),...q.evidencePlan.scenario.media.includes('usb-disk')?['U盘']:[],...(q.concepts.includes('wifi')?['Wi-Fi']:[])]:q.attributes.length?q.attributes.map(id=>concepts.find(c=>c.id===id).words[0]):q.categories.map(c=>({manual:'说明书',spec:'规格书',firmware:'固件',software:'软件',video:'视频'}[c]));
  const lexical=[...q.models.map(m=>m.replace(/^HD-/,'')),...q.chips,...q.software,...(!q.models.length?(q.decision?.objects||[]).filter(o=>['module','interface'].includes(o.type)).map(o=>o.text):[]),...(q.numeric?[q.original]:[]),...searchTerms,...(!q.categories.length&&!q.concepts.length?q.literals:[])].join(' ')||q.query;
  if((!explicitDocs||!goodCatalog)&&(q.intent!=='operation'||!searchContext)&&!(q.intent==='parameters'&&claims.length)&&q.intent!=='product')tasks.push(call('fts5-primary',()=>textSearch(lexical)).then(rows=>add('text',rows)));
  if(!explicitDocs&&q.intent!=='product'&&!(q.intent==='parameters'&&claims.length)&&q.original!==lexical)tasks.push(call('fts5-original-question',()=>textSearch(q.decision.focusText||q.original)).then(rows=>add('text-original',rows)));
  await Promise.all(tasks);
  if(localCatalog?.status?.().state==='unavailable')failures.push('resource-catalog');
  for(const list of lists){const count=list.rows.length;list.rows=await filterEvidence(list.rows);if(list.rows.length<count)routeLog.filtered['restricted-source']=(routeLog.filtered['restricted-source']||0)+count-list.rows.length;}
  let ranked=rank(q,lists,lookup,routeLog.filtered,routeLog.candidates);
  // One bounded synonym retry, never dropping exact models/category/version constraints.
  if(!ranked.length&&!explicitDocs&&q.concepts.length){const alternate=[...q.models.map(m=>m.replace(/^HD-/,'')),...q.concepts.filter(id=>!['local','cable'].includes(id)).slice(0,3).map(id=>concepts.find(c=>c.id===id).words[1]||concepts.find(c=>c.id===id).words[0])].join(' ');if(alternate&&alternate!==lexical){const rows=await call('fts5-synonym',()=>textSearch(alternate));add('text-expanded',rows);ranked=rank(q,lists,lookup,routeLog.filtered,routeLog.candidates);}}
  const results=ranked.slice(0,4).map(({candidate,signals})=>({...candidate,rankingSignals:signals}));
  routeLog.candidateCount=lists.reduce((n,l)=>n+l.rows.length,0);routeLog.retainedCount=results.length;
  onProgress('composing');
  let reply=[];
  if(q.numeric&&q.models.length)reply.push('当前登记中“'+q.original+'”只有一个精确数字核心候选，按 '+q.models.join('、')+' 查询；未将相近数字或带其他后缀的型号合并。');
  if(q.intent==='product')reply.push(q.models.join('、')+'：已确认是当前登记的产品型号。'+(q.models.every(m=>/^HD-R/.test(m))?'属于接收卡产品。':'')+'\n你想查哪一项：带载与接口参数、规格书/说明书、固件、升级操作，还是故障排查？可以直接继续问。');
  const firmwareCompatibility=q.compatibility&&/固件|升级|刷|烧录|\.bin/i.test(q.original);
  if(q.compatibility&&q.decision.missing.includes('referenced-file'))reply.push('你说的“这个”是哪个固件文件？请给出文件名或版本；还需核对设备硬件、芯片和当前实读版本，确认前不要刷入。');
  if(firmwareCompatibility)reply.push('当前检索结果不能确认 '+q.models.join('、')+' 的固件通用或跨型号兼容。文件名相似、目录关联均不代表兼容依据，请勿据此互刷。');
  if(q.compatibility&&!firmwareCompatibility)reply.push(/芯片|译码|驿码|替代|代替/.test(q.original)?'你问的是芯片或器件替代。请确认原件与拟替换件的完整丝印、应用电路和相关版本；选型表并列记录不代表可以直接替换。':'你问的是设备或软件能否配合使用。还需确认另一方的完整名称、版本及连接方式；当前资料不能直接确认适用性。');
  let parameter=(q.models.length?results:[]).filter(r=>r.type==='parameter'||r.type==='passage'&&q.attributes.length&&/\d/.test(r.text||'')&&/灰阶|灰度级|尺寸|像素|万点|宽|高|pixels|width|height|control range|接口|网口|HDMI|USB|HUB75/i.test(r.text||''));
  if(q.decision.answerNeed==='capability-confirmation')parameter=relevantEvidence(q.original,parameter,lookup,q.models,{semantic:true});
  if(q.intent==='parameters'){if(parameter.length)reply.push(...parameter.map(r=>`${q.models.join('、')}：${r.text}${r.conditions?.length?'\n条件：'+r.conditions.join('；'):''}\n来源：${r.name}${r.locator?' · '+JSON.stringify(r.locator):''}`));else reply.push('未找到能核验所问参数的结构字段或原文，不以文件名或未核验数值代替答案。');}
  if(q.intent==='parameters'&&!q.models.length)reply.push(q.decision.objects.some(o=>o.type==='module')?'你问的是单块模组尺寸或参数。不同模组不能套用同一尺寸；请给出模组完整型号或已知规格，以便核对。':'已按所问主题查找参数依据；还需要明确查询对象，不能把其他设备的参数当作答案。');
  const software=results.filter(r=>r.type==='software');if(q.intent==='software-function'){if(software.length)reply.push(...software.map(r=>r.name+'：'+r.text+'\n来源：现有软件登记说明。'));else reply.push('已查询软件登记及资料，尚无足够证据确认这项功能；请补充软件版本和具体功能。');if(software.length&&q.decision.answerNeed==='specific-software-capability')reply.push('以上仅是已登记用途，尚不足以确认你问的具体能力；请补充软件版本后核对操作手册。');}
  const operations=results.filter(r=>r.type==='operation');if(operations.length){for(const r of operations.slice(0,1))reply.push((q.operation?.selectSoftware?'软件及其用途原文：':r.genericOperation?'以下是软件手册的通用操作，尚未确认现场固件适用性：':'操作原文：')+'\n'+r.text+'\n来源：'+r.name+' · '+JSON.stringify(r.locator));if(q.operation.upgrade)reply.push('升级前请提供当前接收卡实读版本、硬件/芯片和所用软件版本，以核对固件；不能仅凭R系列型号或目录选择固件。');if(q.operation.sendProgram)reply.push('你使用网线/Wi-Fi发送，还是U盘更新？请补充设备型号，以继续核对适用条件。');}
  for(const r of results.filter(r=>r.type==='chip'))reply.push(r.text+'\n来源：'+r.name+' · 第'+r.locator.page+'页。这里只是选型表原记录，不代表已确认现场兼容；请继续提供接收卡型号、芯片完整后缀及当前版本。');
  if(parameter.length>1&&new Set(parameter.map(r=>r.documentVersion).filter(Boolean)).size>1)reply.push('以上资料版次不同，数值不合并；请核对所用设备和资料版次。');
  const cases=results.filter(r=>r.type==='case');
  if(q.intent==='aftersales')reply.push(q.evidencePlan.scenario.media.includes('usb-disk')?'插入U盘后，设备是否有识别成功的提示？先区分U盘识别与素材播放环节，再核对相应的排查依据。':aftersalesGuidance(q.query,q.software));
  if(cases.length){reply.push('以下案例仅作条件参考，未确认的触发场景不能直接套用。');for(const r of cases.slice(0,2))reply.push(`${r.rankingSignals?.scene?.conditional?'场景未完全确认：':''}${r.name}\n适用条件：${JSON.stringify({models:r.modelIds||[],...r.scope})}\n历史记录：${r.historicalMeasure||r.text}\n来源：${(r.sources||[]).map(s=>s.name+(s.locator?' · '+JSON.stringify(s.locator):'')).join('；')||'已有案例索引'}`);}
  const docs=results.filter(r=>r.type==='document');if(docs.length&&!['operation','product'].includes(q.intent))reply.push('找到对应资料：'+docs.map(r=>r.name+(r.documentVersion?'（'+r.documentVersion+'）':'')).join('；')+'。'+(q.categories.includes('firmware')?'请提供接收卡当前实读版本、芯片完整型号及硬件条件，再核对所需固件系列；这些是候选文件，不是推荐互刷。':'可预览或下载核对原文。'));
  if(!q.compatibility&&results.some(r=>r.type==='passage')&&!q.attributes.length&&q.intent!=='chip'&&!(q.intent==='software-function'&&software.length&&q.decision.answerNeed==='software-overview'))for(const r of [...new Map(results.filter(r=>r.type==='passage').map(r=>[canonical(r.text),r])).values()].slice(0,2))reply.push('相关原文（适用条件待核对）：\n'+r.text+'\n来源：'+r.name+' · '+JSON.stringify(r.locator||{}));
  for(const r of results.filter(r=>r.type==='faq'))reply.push(`${r.faqExact?'已有FAQ标准答案（原问题完全匹配）':'FAQ原记录（适用条件待核对）'}：${r.standardQuestion}\n${r.standardAnswer}\n来源：${r.name}${r.locator?' · '+JSON.stringify(r.locator):''}`);
  let answerType=q.intent==='software-function'?software.length&&q.decision.answerNeed==='software-overview'?'software-function-answer':'insufficient-evidence':q.intent==='product'?'product-guide':q.intent==='parameters'?parameter.length?'parameter-answer':'insufficient-evidence':operations.length?'operation-excerpt':results.some(r=>r.type==='chip')?'chip-table':cases.length?'conditional-cases':results.length?'resource-evidence':'insufficient-evidence';
  if(!results.length&&!['product','software-function'].includes(q.intent)){answerType=failures.length?'service-unavailable':q.unknownModels.length?'entity-not-registered':q.intent==='clarify'&&!q.numeric?'unrecognized-intent':lists.some(l=>l.rows.length)||routeLog.operationManualCount?'insufficient-evidence':'data-not-registered';reply.push(answerType==='service-unavailable'?'资料数据服务暂不可用，暂时无法核对原文，请稍后重试。':answerType==='entity-not-registered'?'尚未登记或确认型号 '+q.unknownModels.join('、')+'，不会按相近型号替代。':answerType==='unrecognized-intent'?'还不能确认你要查询的方向。可以问产品参数、芯片智能设置、资料、操作、故障或工程配单。':answerType==='insufficient-evidence'?'已找到资料候选，但没有足够证据回答这个具体问题；请补充现场条件，不能把文件标题当成答案。':q.intent==='operation'?'没有找到能核验该操作步骤的已解析原文。请补充所用软件及版本，暂不编造步骤。':'当前登记数据中未查到满足这些精确条件的资料，请核对完整型号或芯片名称。');}
  if(q.intent==='parameters'&&!parameter.length&&q.models.length&&!failures.length)reply=['已查询 '+q.models.join('、')+' 的'+(q.attributes.length?q.attributes.map(a=>concepts.find(c=>c.id===a)?.words[0]||a).join('、'):'所问参数')+'，未找到可核验的原文记录。'];
  if(q.intent==='operation'&&!operations.length&&!results.some(r=>r.type==='faq')&&!q.models.length&&!q.software.length)reply=['你要在哪款设备或软件里进行这个操作？提供其中一个名称，我再核对对应步骤。'];
  if(q.intent==='operation'&&!operations.length&&q.evidencePlan.scenario.media.includes('usb-disk')&&q.evidencePlan.scenario.deniedMedia.includes('network'))reply=['已保留 '+q.models.join('、')+'、U盘影片和离线使用的条件。你希望切换视频、暂停，还是定时播放？这些操作需要分别核对原文，目前没有足够证据给出具体按键或菜单步骤。'];
  if(q.intent==='resources'&&!results.length)reply=[failures.length?'资料服务部分不可用，暂时无法确认是否已登记对应原件。':'已查询登记目录和原文，尚未找到可确认的'+(q.models.length?q.models.join('、')+'的':'该主题的')+(q.resourceConstraints?.subject==='sdk-api'?'SDK/API开发资料':q.categories.includes('manual')?'说明书':q.categories.includes('spec')?'规格书':'资料')+'。','可以补充资料名称、软件或主题继续找；不会用其他资料类别或相近型号替代。'];
  if(q.contextUsed)reply.unshift('沿用已确认的 '+[...q.models,...q.software,...q.chips].join('、')+' 继续查询。');
  if(q.versions.length)reply.push('已保留版本约束；资料版次不等于硬件版本或固件兼容确认。');
  if(failures.length)reply.push('部分资料来源暂不可用，本次未检索到不代表资料不存在。');
  return complete({...base,kind:results.length&&results.every(r=>r.type==='case')?'cases':'all',status:results.length||q.intent==='product'?'answer':'not-found',answerType,reply:reply.join('\n\n'),results,sourceFailures:failures,sourceAvailability:{faq:'复用已索引FAQ/FQA表格原文；只有带问题/答案列且原问题完全匹配才直出标准答案，其余是条件待核对的原记录'},candidateCount:lists.reduce((n,l)=>n+l.rows.length,0),retrievalPolicy:'shared-chat-intent; multisource; exact-identities; evidence-first'});
 }
 return {answer};
}
// Query restrictions are not new browse categories or compatibility assertions.
function matchesResourceRequest(q,r){
 const c=q.resourceConstraints||{},name=String(r.name||'');
 if(c.subject==='sdk-api'&&!/\bSDK\b|\bAPI\b|二次开发|通讯协议|通信协议|接口协议/i.test(name))return false;
 if(c.extension&&!new RegExp('\\.'+c.extension+'(?:$|[?#])','i').test(name)&&!new RegExp('\\.'+c.extension+'(?:$|[?#])','i').test(r.download||''))return false;
 if(c.language){
  const declared=String(r.documentLanguage||r.language||'').toLowerCase();
  const language=/^(?:zh|cn|chinese)/.test(declared)?'zh':/^(?:en|english)/.test(declared)?'en':/中文版|中文/.test(name)?'zh':/英文版|english/i.test(name)?'en':null;
  if(language!==c.language)return false;
 }
 return true;
}
function rank(q,lists,lookup,filtered={},audit=[]){
 let current=null;
 const merged=new Map();
 const reject=reason=>{filtered[reason]=(filtered[reason]||0)+1;if(current)audit.push({...current,disposition:'excluded',reason});return true;};
 for(const list of lists)for(const [i,r]of list.rows.entries()){
  current={source:list.source,name:r.name,type:r.type,sha256:r.sha256,locator:r.locator,evidenceId:r.evidenceId};
  if(q.intent==='resources'&&!matchesResourceRequest(q,r)){reject('requested-document-constraint');continue;}
  const title=r.name||'',body=r.text||'',all=title+' '+body,named=[...new Set([...(r.modelIds||[]),...extractKnownModels(all,lookup)])];
  if(r.type==='passage'&&canonical(body).replace(/[^a-z0-9\u4e00-\u9fff]/g,'')===canonical(title).replace(/[^a-z0-9\u4e00-\u9fff]/g,'')){reject('no-body-evidence');continue;}
  const assertedSoftware=(lookup.softwareItems?.(all)||[]).map(s=>s.name);
  if(q.software.length&&assertedSoftware.length&&!q.software.some(name=>assertedSoftware.some(s=>norm(s)===norm(name)))){reject('different-software-source');continue;}
  const titleModels=extractKnownModels(title,lookup);if(q.models.length&&r.type!=='case'&&titleModels.length&&!q.models.some(m=>titleModels.includes(m))){reject('different-title-model');continue;}
  const modelMatch=q.models.filter(m=>named.includes(m));
  if(r.type==='operation'&&q.models.length&&named.length&&!modelMatch.length){reject('operation-other-model');continue;}
  // Cases without an asserted model remain explicitly conditional; a different
  // asserted model is a conflict. Documents/parameters require exact identities.
  if(q.models.length&&r.type!=='operation'&&(named.length&&!modelMatch.length||!['case','chip'].includes(r.type)&&!modelMatch.length)){reject('exact-model-not-established');continue;}
  if(q.unknownModels.length){reject('unknown-explicit-model');continue;}
  if(q.intent==='software-function'&&q.software.length&&!q.software.some(name=>norm(title).includes(norm(name))||(r.software||[]).some(s=>norm(s)===norm(name)))){reject('different-software-source');continue;}
  if(q.intent==='software-function'&&r.type==='software'&&!q.software.some(name=>norm(name)===norm(r.name))){reject('different-software');continue;}
  if(q.intent==='operation'&&r.type!=='operation'&&r.type!=='faq'){reject('not-operation-evidence');continue;}
  if(q.attributes.length&&r.type==='case'){reject('case-not-parameter-proof');continue;}
  if(q.intent==='resources'&&q.categories.length&&!q.compatibility&&!q.symptoms.length&&!['operation','software-function'].includes(q.intent)){if(r.type==='case'){reject('case-not-requested-resource');continue;}const cat=r.category||(/说明书|手册|manual/i.test(title)?'manual':/规格书|specification|datasheet/i.test(title)?'spec':/\.bin\b|固件/i.test(title)?'firmware':null);if(!q.categories.includes(cat)){reject('different-resource-category');continue;}}
  if(q.deniedFault&&r.type==='case'){reject('negated-fault-request');continue;}
  if(q.versions.length&&!q.versions.every(v=>{const known=v.kind==='hardware'?r.scope?.hardwareVersions||[]:v.kind==='firmware'?r.scope?.firmwareVersions||[]:v.kind==='software'?r.scope?.softwareVersions||[]:[...(r.versions||[]),r.documentVersion].filter(Boolean);return known.some(x=>norm(x).replace(/^v/,'')===norm(v.value).replace(/^v/,''));})){reject('unverified-version-constraint');continue;}
  const sourceChips=r.chips||r.scope?.chips||(all.match(/\b(?:ICND?|SM|FM|LS|DP|MBI|TC|RUL|RUC)\d{3,5}[A-Z0-9]*\b/gi)||[]);
  if(q.chips.length&&sourceChips.length&&!q.chips.some(c=>sourceChips.some(k=>norm(k)===norm(c)))){reject('different-chip');continue;}
  if(r.type==='faq'&&q.intent==='operation'&&q.operation?.terms?.length){const question=norm(r.standardQuestion||'');const taskConcepts=q.concepts.filter(id=>['password','power-schedule','brightness','usb','program-cycle'].includes(id));if(taskConcepts.length&&!taskConcepts.every(id=>matchesConcept(id,question))){reject('faq-other-task');continue;}}
  if(q.software.length&&['operation','aftersales'].includes(q.intent)&&r.type==='faq'&&!q.software.some(name=>norm((r.name||'')+' '+(r.standardQuestion||'')).includes(norm(name)))){reject('faq-software-not-established');continue;}
  if(q.intent==='aftersales'&&q.symptoms.length&&r.type==='case'&&!q.symptoms.some(id=>matchesConcept(id,(r.name||'')+' '+(r.phenomenon||'')))){reject('case-symptom-only-in-remedy');continue;}
  const core=q.symptoms.length?[...new Set([...q.symptoms,...q.concepts.filter(id=>['usb','wifi','program-send','program-cycle','brightness'].includes(id))])]:q.attributes.length?q.attributes:q.concepts.filter(id=>!['local','cable'].includes(id));
  const matched=core.filter(id=>matchesConcept(id,all)),titleHits=core.filter(id=>matchesConcept(id,title));
  const literalHits=q.literals.filter(w=>/^[a-z0-9]+$/i.test(w)?new RegExp('(?<![a-z0-9])'+w+'(?![a-z0-9])','i').test(all):norm(all).includes(norm(w)));
  if(q.intent==='technical'&&q.literals.length&&!literalHits.length&&!matched.length&&!modelMatch.length){reject('missing-question-topic');continue;}
  // Specific discovery + wifi is a conjunction, not a generic network match.
  if(core.includes('wifi')&&core.includes('discovery')&&q.discoveryTarget!=='device'){
   const focus=norm(r.type==='case'?r.phenomenon:body);
   const discovery=/(?:wifi|无线|ssid|热点)[^。\n；]{0,12}(?:搜不到|搜索不到|无法搜索|找不到|不广播)|(?:搜不到|搜索不到|无法搜索|找不到|不广播)[^。\n；]{0,12}(?:wifi|无线|ssid|热点)/.test(focus);
   if(!discovery||/(?:搜不到|找不到|无法找到)设备|控制卡(?:无法|搜索不到|搜不到)[^。\n；]{0,6}wifi|连接上wifi|wifi正常|wifi连接正常|已连接wifi|连接wifi正常|(?:wifi|热点)[^。\n；]{0,20}(?:连接上|已连接|连接正常)/.test(focus)){reject('different-discovery-direction');continue;}
  }
  if(core.length&&!matched.length&&!modelMatch.length&&!literalHits.length&&!['operation','software','capability'].includes(r.type)){reject('no-topic-evidence');continue;}
  if(r.type==='case'&&q.models.length&&!named.length&&q.symptoms.length>1&&q.symptoms.some(id=>!matched.includes(id))){reject('case-object-and-symptoms-not-established');continue;}
  const atomicNumber=q.literals.some(w=>/^\d+$/.test(w)&&new RegExp('(?<![a-z0-9])'+w+'(?![a-z0-9])','i').test(all));
  if(!core.length&&!q.models.length&&!['chip','operation','software'].includes(r.type)&&literalHits.length<2&&!literalHits.some(w=>w.length>=4)&&!atomicNumber){reject('insufficient-literal-evidence');continue;}
  if(q.attributes.length&&r.type==='passage'&&!matched.length){reject('parameter-field-not-supported');continue;}
  if(r.type==='document'&&!r.download){reject('no-accessible-original');continue;}
  if(q.compatibility&&r.type==='case'&&!/兼容|通用|互刷/.test(all)){reject('no-compatibility-evidence');continue;}
  if(q.compatibility&&r.type==='passage'&&!/兼容|通用|互刷|firmware|固件/i.test(body)){reject('no-compatibility-evidence');continue;}
  const caseKey=r.type==='case'?JSON.stringify([named.toSorted(),r.scope?.firmwareVersions||[],canonical(r.historicalMeasure||'').replace(/[\s，。；：]/g,''),canonical((r.phenomenon||r.name).split('\n').toSorted((a,b)=>b.length-a.length)[0]).replace(/自定义画布的限制[:：]?|[\s，。；：]/g,'')]):null;
  const key=caseKey||(q.intent==='chip'&&r.type==='passage'?(r.sha256||r.name):r.evidenceId||r.sha256||r.download||JSON.stringify([title,body]));
  const sceneSignals=compareScene((q.evidencePlan||evidencePlan(q)).scenario,r.phenomenon||r.text||'');
  if(['case','operation'].includes(r.type)&&sceneSignals.conflicts.length){reject('scene-contradiction');continue;}
  const signals={scene:sceneSignals,exactModel:modelMatch.length,modelUnknown:r.type==='case'&&!named.length,coverage:core.length?matched.length/core.length:0,titleMatches:titleHits.length,categoryMatch:q.categories.includes(r.category),structured:r.type==='parameter',matchedConcepts:matched,literalMatches:literalHits};
  const videoTask=r.category==='video'?compareScene((q.evidencePlan||evidencePlan(q)).scenario,r.name):null;
  const languagePreference=r.category==='video'?(/英文|english/i.test(q.original)?(/英文|english|\(英\)/i.test(r.name)?4:0):!/英文|english|印尼|西班牙|葡萄牙|\(英\)/i.test(r.name)?4:0):0;
  if(videoTask)signals.videoTask=videoTask;
  const score=(r.softwareAssociation?30:0)+languagePreference+(videoTask?videoTask.score:0)+modelMatch.length*12+(signals.structured?12:0)+signals.coverage*10+titleHits.length*2+(signals.categoryMatch?8:0)+literalHits.length+(r.type==='case'&&q.symptoms.length?5:0)+(r.faqExact?20:0)+(['chip','operation'].includes(r.type)?40:0)+(r.sectionFocused?20:0)+(r.chipIdentityLinked?8:0)+(['case','operation','passage'].includes(r.type)?sceneSignals.score:0);
  audit.push({...current,disposition:'ranked',score,signals});const existing=merged.get(key);if(existing){existing.rrf+=1/(60+i+1);existing.sources.add(list.source);}else merged.set(key,{candidate:r,signals,score,rrf:1/(60+i+1),sources:new Set([list.source])});
 }
 return [...merged.values()].sort((a,b)=>b.score-a.score||b.rrf-a.rrf||a.candidate.name.localeCompare(b.candidate.name));
}
module.exports={createQuickRetrieval,rank};
