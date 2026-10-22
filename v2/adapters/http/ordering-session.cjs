'use strict';
function mergeOrderingDemand(previous,delta){
 const demand=structuredClone(previous||{schemaVersion:'2.0',operation:'ordering'});
 if(delta.module?.pitchMm!==undefined&&demand.module?.pitchMm!==undefined&&delta.module.pitchMm!==demand.module.pitchMm){
  demand.module={};for(const p of Object.keys(demand.provenance||{}))if(p.startsWith('/module/'))delete demand.provenance[p];
 }
 const geometry=delta.screen||{},modes=[['moduleColumns','moduleRows'],['pixelWidth','pixelHeight'],['physicalWidthMm','physicalHeightMm']];
 const changed=modes.find(keys=>keys.some(k=>geometry[k]!==undefined));
 if(changed&&demand.screen)for(const keys of modes)if(keys!==changed)for(const k of keys){delete demand.screen[k];if(demand.provenance)delete demand.provenance['/screen/'+k];}
 for(const f of ['module','screen','cabinet','environment','controlMode','architecture','providedDevices','requirements','topic'])if(delta[f]!==undefined)demand[f]=['module','screen','cabinet','requirements'].includes(f)?{...demand[f],...delta[f]}:structuredClone(delta[f]);
 for(const p of ['/module/color','/module/driverFamily'])if(delta.provenance?.[p]?.kind==='user-negated'&&demand.module)delete demand.module[p.split('/')[2]];
 for(const f of ['environment','controlMode','architecture'])if(delta.provenance?.['/'+f]?.kind==='user-negated')delete demand[f];
 demand.provenance={...demand.provenance,...delta.provenance};return demand;
}
function createOrderingSessions(app,{ttlMs=300000,maxSessions=200,now=Date.now}={}){
 const cache=new Map(),key=id=>typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(id)?id:null;
 const expiry=setInterval(()=>{for(const [id,row]of cache)if(now()-row.at>ttlMs)cache.delete(id);},30000);expiry.unref?.();
 return {
  continue(id,text){const k=key(id),old=cache.get(k);if(!old||now()-old.at>ttlMs){cache.delete(k);return null;}
   if(/参数|规格书|固件|说明书|软件|视频|是什么|怎么用/.test(text))return null;
   if(/重新配单|另一块屏|另外.{0,5}配/.test(text)){cache.delete(k);return null;}
   const parsed=app.understandInput(text,'ordering').demand;if(!parsed||parsed.operation!=='ordering')return null;
   const fields=['module','screen','cabinet','environment','controlMode','architecture','providedDevices','requirements'];if(!fields.some(f=>parsed[f]!==undefined)&&!Object.values(parsed.provenance||{}).some(p=>p.kind==='user-negated'))return null;
   return mergeOrderingDemand(old.demand,parsed);
  },
  save(id,result){const k=key(id);if(!k)return;if(result.operation!=='ordering'||result.status!=='needs_input'){cache.delete(k);return;}
   for(const [id,row]of cache)if(now()-row.at>ttlMs)cache.delete(id);if(cache.size>=maxSessions&&!cache.has(k))cache.delete(cache.keys().next().value);
   cache.set(k,{at:now(),demand:structuredClone(result.normalizedDemand)});
  }
 };
}
// Progressive conversation is a presentation of the existing calculator, never a second solver.
async function progressiveOrdering(app,text,previous){
 const delta=app.understandInput(text,'ordering').demand;
 if(!delta||delta.operation!=='ordering')throw Error('ordering-route-mismatch');
 if(/不限定设备(?:型号)?|取消指定设备|不限制设备型号/.test(text)){delta.providedDevices=[];delta.provenance['/providedDevices']={kind:'user-cleared',text};}
 if(delta.providedDevices&&previous?.confirmed.providedDevices&&app.orderingReferences){
  const id=require('../../domain/identity/model-id.cjs').modelId,refs=app.orderingReferences({...delta,providedDevices:[...previous.confirmed.providedDevices,...delta.providedDevices]});
  const controllers=new Set(refs.devices.map(r=>id(r.model))),receivers=new Set(refs.receivers.map(r=>id(r.model)));
  const role=d=>controllers.has(d.modelId)?'controller':receivers.has(d.modelId)?'receiver':null;
  const changed=new Set(delta.providedDevices.map(role));
  delta.providedDevices=[...previous.confirmed.providedDevices.filter(d=>role(d)&&!changed.has(role(d))),...delta.providedDevices];
 }
 let acceptedProposal=previous?.acceptedProposal||null;
 if(previous?.gridProposal&&/允许调整尺寸|可以调整尺寸|按整拼尺寸|按这个尺寸/.test(text)&&!/不允许|不可以|不要|不能/.test(text)){
  const p=previous.gridProposal;delta.screen={physicalWidthMm:p.widthMm,physicalHeightMm:p.heightMm,moduleColumns:p.columns,moduleRows:p.rows};
  for(const k of Object.keys(delta.screen))delta.provenance['/screen/'+k]={kind:'user-approved-proposal',text,source:p.source};
  acceptedProposal={...p,originalTarget:previous.confirmed.screen,userQuote:text};
 }
 const demand=mergeOrderingDemand(previous?.confirmed,delta);
 const refs=app.orderingReferences?.(demand),negated=Object.values(demand.provenance||{}).some(p=>p.kind==='user-negated');
 const modules=(refs?.modules||[]).filter(row=>demand.provenance?.['/module/color']?.kind!=='user-negated'||!(row.color.R&&row.color.G&&row.color.B));
 const known=[],s=demand.screen||{},m=demand.module||{};
 if(m.pitchMm)known.push('P'+m.pitchMm);
 if(s.physicalWidthMm&&s.physicalHeightMm)known.push('宽'+s.physicalWidthMm/1000+'米、高'+s.physicalHeightMm/1000+'米');
 if(s.pixelWidth&&s.pixelHeight)known.push('整屏'+s.pixelWidth+'×'+s.pixelHeight+'像素');
 if(s.moduleColumns&&s.moduleRows)known.push('模组横'+s.moduleColumns+'张、竖'+s.moduleRows+'张，共'+s.moduleColumns*s.moduleRows+'张');
 if(demand.environment)known.push(demand.environment==='indoor'?'室内':'户外');
 if(demand.controlMode)known.push(demand.controlMode==='sync'?'同步':'异步');
 if(demand.providedDevices?.length)known.push('指定'+demand.providedDevices.map(d=>d.modelId).join('、'));
 const pending=[];
 if(![[s.physicalWidthMm,s.physicalHeightMm],[s.pixelWidth,s.pixelHeight],[s.moduleColumns,s.moduleRows]].some(pair=>pair.every(Boolean)))pending.push({path:'/screen',question:Object.keys(s).length?'已给的尺寸记下了，另一边的尺寸或张数是多少？':'屏幕宽、高各多少米？知道整屏分辨率或模组横竖张数也可以。'});
 if(!m.pitchMm)pending.push({path:'/module/pitchMm',question:'这块屏是 P 几？'});
 if(!demand.controlMode)pending.push({path:'/controlMode',question:'要实时显示电脑画面（同步），还是发送节目后脱机播放（异步）？'});
 if(!demand.environment)pending.push({path:'/environment',question:'这块屏用于室内还是户外？'});
 const derivedDemand=structuredClone(demand),derived=[];
 // Only exact geometry from explicitly supplied module dimensions may enter a formal calculation.
 function deriveGrid(input,module){
  const screen=input.screen||{},out={...screen},basis=[];
  for(const [axis,grid,pixel,physical]of [[0,'moduleColumns','pixelWidth','physicalWidthMm'],[1,'moduleRows','pixelHeight','physicalHeightMm']]){
   if(out[grid])continue;
   const value=screen[pixel]!==undefined?screen[pixel]/module.resolution[axis]:screen[physical]!==undefined?screen[physical]/module.size[axis]:null;
   if(Number.isSafeInteger(value)&&value>0){out[grid]=value;basis.push({field:'/screen/'+grid,value,basis:screen[pixel]!==undefined?'explicit-pixels/module-pixels':'explicit-mm/module-mm'});}
  }
  return {screen:out,basis};
 }
 if(m.pixelWidth&&m.pixelHeight){
  const grid=deriveGrid(demand,{resolution:[m.pixelWidth,m.pixelHeight],size:[m.physicalWidthMm,m.physicalHeightMm]});
  if(grid.basis.length){derivedDemand.screen=grid.screen;derived.push(...grid.basis);}
 }
 const strict=await app.dialogue(derivedDemand);
 let stage=strict.status==='ready'?'formal':strict.status==='conflict'?'conflict':'needs-input';
 const simulations=[];
 const evidence=modules.slice(0,3).map(row=>({moduleId:row.id,pitchMm:row.dotPitch.spacing,pixels:row.resolution,scan:row.scanningMethod,interface:row.interface,source:row.source}));
 // A requested product is a constraint, not proof that it can drive this screen.
 const id=require('../../domain/identity/model-id.cjs').modelId;
 const missingDevice=(demand.providedDevices||[]).some(d=>![...refs?.devices||[],...refs?.receivers||[]].some(r=>id(r.model)===d.modelId));
 const multi=/主屏.*副屏|副屏.*主屏|[两二三四五六七八九十2-9]\s*(?:块|面)(?:独立)?屏|多块屏|异形屏/.test(text)||previous?.scope==='multiple-or-irregular';
 if(stage!=='formal'&&stage!=='conflict'&&!missingDevice&&!multi&&!negated&&m.pitchMm&&demand.controlMode&&Object.keys(s).length){
  for(const row of modules.slice(0,3)){
   const hypothesis=structuredClone(demand),assumptions=[];
   const sourceModule={pitchMm:row.dotPitch.spacing,pixelWidth:row.resolution[0],pixelHeight:row.resolution[1],physicalWidthMm:row.size[0],physicalHeightMm:row.size[1],scan:{numerator:1,denominator:Number(row.scanningMethod.replace(/S$/,''))},interface:row.interface,color:{r:row.color.R,g:row.color.G,b:row.color.B}};
   for(const [key,value]of Object.entries(sourceModule))if(hypothesis.module[key]===undefined){hypothesis.module[key]=value;assumptions.push('/module/'+key);}
   if(!hypothesis.environment){hypothesis.environment=row.indoor?'indoor':'outdoor';assumptions.push('/environment');}
   if(!hypothesis.architecture){hypothesis.architecture='receiver';assumptions.push('/architecture');}
   if(!hypothesis.requirements?.controllerFamily){
    const specified=refs.devices[0],family=specified?.category==='同步异步播放盒'?'playBox':specified?.category==='异步控制卡'?'asyncCard':hypothesis.controlMode==='async'?'playBox':'processor';
    hypothesis.requirements={...hypothesis.requirements,controllerFamily:family};assumptions.push('/requirements/controllerFamily');
   }
   const geometry=deriveGrid(hypothesis,row);hypothesis.screen=geometry.screen;
   if(!geometry.screen.moduleColumns||!geometry.screen.moduleRows)continue;
   const result=await app.dialogue(hypothesis);
   if(result.status==='ready')simulations.push({moduleId:row.id,assumptions,source:row.source,inputs:hypothesis,derived:geometry.basis,controller:result.plan.controller.model,receiver:result.bom.find(b=>b.kind==='receiver'),validation:result.validation,datasetVersion:result.datasetVersion});
  }
 }
 if(stage!=='formal'&&stage!=='conflict'&&Object.keys(s).length&&(evidence.length||simulations.length))stage='provisional';
 let gridProposal=null;
 const sample=modules[0];
 if(sample&&s.physicalWidthMm&&s.physicalHeightMm&&!simulations.length){
  const cols=s.physicalWidthMm/sample.size[0],rows=s.physicalHeightMm/sample.size[1];
  if(!Number.isInteger(cols)||!Number.isInteger(rows)){
   const c=Math.ceil(cols),r=Math.ceil(rows);gridProposal={moduleId:sample.id,columns:c,rows:r,widthMm:c*sample.size[0],heightMm:r*sample.size[1],source:sample.source,requiresConfirmation:true};
  }
 }
 if(!pending.length&&stage!=='formal'){
  if(missingDevice)pending.push({path:'/providedDevices',question:'指定设备的选型适用条件尚未建立；可以先不限定设备型号评估吗？'});
  else if(gridProposal)pending.push({path:'/screen',question:'若采用该候选模组，整拼需调整为'+gridProposal.widthMm/1000+'米×'+gridProposal.heightMm/1000+'米（'+gridProposal.columns+'×'+gridProposal.rows+'张）。允许调整尺寸，还是按现场实际张数核对？'});
  else if(!m.pixelWidth||!m.pixelHeight)pending.push({path:'/module',question:'能提供单块模组的完整型号或规格文字吗？用来确认候选，其他已知条件不用重填。'});
  else{const first=strict.missing_parameters?.[0];pending.push({path:first?.path||'/module',question:first?.reason||'请提供模组完整规格，核对当前条件与选型库不一致的地方。'});}
 }
 const orderingState={confirmed:demand,derived,pending,candidates:evidence,simulations,gridProposal,acceptedProposal,stage,scope:multi?'multiple-or-irregular':'single-screen',datasetVersion:refs?.datasetVersion||strict.datasetVersion};
 const header=known.length?'已记下：'+known.join('；')+'。':'可以，我先帮你确定配单方向。';
 let reply;
 if(multi){stage='needs-input';orderingState.stage=stage;orderingState.candidates=[];orderingState.simulations=[];pending.splice(0,pending.length,{path:'/screen',question:'这是多屏或异形工程；请用“另一块屏”开始，说明其中一块独立矩形屏的宽高，可以吗？'});reply=header+'\n多屏不能合并成单屏配单。\n'+pending[0].question;}
 else if(stage==='formal')reply=require('./dialogue-service.cjs').formatReply(strict);
 else if(stage==='conflict')reply=header+'\n当前明确条件存在冲突，不能用默认值替换。\n'+(pending[0]?.question||'请核对模组和屏幕规格是否一致。');
 else{
  const lines=[header];
  if(evidence.length&&m.pitchMm&&Object.keys(s).length&&!simulations.length)lines.push('选型库有'+modules.length+'种符合已知条件的模组候选，现场规格尚待确认。');
  if(simulations.length){const first=simulations[0],row=modules.find(m=>m.id===first.moduleId);lines.push('暂定方向（不是正式BOM）：若采用库中'+row.resolution.join('×')+'点、'+row.scanningMethod+'、'+row.interface+'的'+(row.indoor?'室内':'户外')+'模组，按'+(first.inputs.requirements.controllerFamily==='playBox'?'播放盒':'主控')+'＋接收卡架构预核算，可选'+first.controller+(first.receiver?'，'+first.receiver.modelId+'约'+first.receiver.quantity+'张':'')+'。模组未确认项及架构均为假设，现场不同必须重算。');}
  else if(m.pitchMm&&s.physicalWidthMm&&s.physicalHeightMm)lines.push('按标称P'+m.pitchMm+'换算约'+Math.round(s.physicalWidthMm/m.pitchMm)+'×'+Math.round(s.physicalHeightMm/m.pitchMm)+'点，只作尺寸方向；模组整拼与实际分辨率尚未确认，暂不定设备数量。');
  else if(s.pixelWidth&&s.pixelHeight){
   lines.push('整屏共'+(s.pixelWidth*s.pixelHeight).toLocaleString('en-US')+'像素。');
   const previews=refs?.controllerPreviews||[];
   if(previews.length){
    lines.push('按官网JS静态规则先筛主控：'+previews.map(p=>(p.family==='processor'?'实时显示方向':'播放盒方向')+'可先看'+p.models.map(m=>m.modelId.replace(/^HD-/, '')).join('、')).join('；')+'。这是主控初筛，接收卡数量及布线还未核定。');
    orderingState.controllerPreviews=previews;
   }
  }
  if(simulations.length)lines.push('依据：现有选型库对应模组记录及条件计算；候选原记录已保留。');
  if(simulations.length&&/按暂定|按当前方案/.test(text))lines.push('已保留这份暂定方向；确认现场模组完整规格后，再转正式配单。');
  else if(pending[0])lines.push(pending[0].question);reply=lines.join('\n');
 }
 return {reply,status:stage==='formal'?'answer':'clarify',result:stage==='formal'?strict:{status:stage==='conflict'?'conflict':'needs_input',operation:'ordering',normalizedDemand:demand,progressive:{stage,known,pending:pending.slice(0,1),candidateCount:orderingState.candidates.length,simulatedCount:orderingState.simulations.length},reason:strict.reason},orderingState,businessStatus:{intent:'identified',evidence:stage==='formal'?'validated-calculation':orderingState.candidates.length?'source-candidates':'none',answer:stage}};
}
module.exports={createOrderingSessions,mergeOrderingDemand,progressiveOrdering};
