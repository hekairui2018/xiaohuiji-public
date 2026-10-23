'use strict';
// One semantic change set, consumed by task routing and the business adapter.
// No previous assistant prose is parsed and no business result becomes a fact.
const {parseOrderingFields,geometryObservation,geometryDelta}=require('./ordering-fields.cjs');
const leaves=(value,prefix='')=>Object.entries(value||{}).flatMap(([key,item])=>key==='provenance'?[]:item&&typeof item==='object'&&!Array.isArray(item)?leaves(item,prefix+'/'+key):[{path:prefix+'/'+key,value:item}]);
function messageUpdate(text,task,{correction=false}={}){
 const delta=parseOrderingFields(text),geometry=geometryObservation(text);
 const spoken=require('./customer-meaning.cjs').spokenGeometry(text);
 const relative=[...spoken.matchAll(/(宽|高)\s*(?:再)?\s*(增加|减少|加|减|多|少)\s*(\d+(?:\.\d+)?)\s*(块|张|列|行|像素|点|毫米|厘米|米)/g)];
 let relativeError=null;
 for(const change of relative){
  const width=change[1]==='宽',unit=change[4],grid=/块|张|列|行/.test(unit),pixels=/像素|点/.test(unit);
  const key=grid?(width?'moduleColumns':'moduleRows'):(pixels?'pixel':'physical')+(width?'Width':'Height')+(pixels?'':'Mm');
  const previous=task?.ordering?.confirmed?.screen?.[key];
  const amount=Number(change[3])*(grid||pixels?1:unit==='米'?1000:unit==='厘米'?10:1)*(/减|少/.test(change[2])?-1:1);
  if(!Number.isFinite(previous)||previous+amount<=0){relativeError='这次是相对调整，但当前没有可用于计算的同单位原值，或调整后的值无效。请给出新的宽或高及单位。';continue;}
  delta.screen??={};delta.screen[key]=previous+amount;delta.provenance??={};delta.provenance['/screen/'+key]={kind:'user-relative-update',text,previous,change:amount};
 }
 const structuredSpecification=!!(relative.length||delta.module?.scan||delta.module?.interface||delta.screen?.moduleColumns||delta.screen?.moduleRows);
 // Remove only geometric facts owned by this observation; the legacy direct
 // ordering endpoint keeps its schema and parser, while dialogue waits on units.
 if(geometry.values&&!structuredSpecification){for(const entity of ['screen','module'])for(const key of ['pixelWidth','pixelHeight','physicalWidthMm','physicalHeightMm']){
  if(delta[entity])delete delta[entity][key];delete delta.provenance?.['/'+entity+'/'+key];
 }for(const entity of ['screen','module'])if(delta[entity]&&!Object.keys(delta[entity]).length)delete delta[entity];}
 const commands={
  correct:correction||relative.length>0||/不对|说错|更正|改成|改为|换成|换为|调整为/.test(text),
  negate:/^(?:不是|不要|不用|不使用|取消)/.test(text)&&!/[，,].*(?:改成|而是|是)/.test(text)&&!delta.controlMode,
  revert:/按之前那个|还是原来的|恢复原来的|撤销(?:刚才|上次)?(?:修改|更改)?|改回原来/.test(text),
  resume:/(?:继续|恢复|接着|回到)/.test(text)&&/(?:配|屏|方案|刚才|之前|上次)/.test(text),
  acknowledge:/^(?:是|这是|指的是|刚才说的是|我说的是|单位(?:是|为)|补充|补充的是)/.test(text),
  complete:/^(?:配单|方案|任务)?(?:确认完成|已完成|完成了|就用这个方案)[。！!\s]*$/.test(text),
  approve:!!task?.ordering?.gridProposal&&/允许调整尺寸|可以调整尺寸|按整拼尺寸|按这个尺寸/.test(text)&&!/不允许|不可以|不要|不能/.test(text)
 };
 let pending=task?.pendingUpdate?structuredClone(task.pendingUpdate):null,clarification=null,resolvedGeometry=null;
 if(!structuredSpecification&&(geometry.values||geometry.unit&&(task?.geometryFocus||task?.ordering?.confirmed.screen))){
  const confirmed=task?.ordering?.confirmed;
  const screen=confirmed?.screen||{};
  const legacyFocus=screen.pixelWidth||screen.pixelHeight?{entity:'screen',unit:'pixels',values:{width:screen.pixelWidth,height:screen.pixelHeight},quote:'先前客户确认的整屏像素'}:screen.physicalWidthMm||screen.physicalHeightMm?{entity:'screen',unit:'mm',values:{width:screen.physicalWidthMm,height:screen.physicalHeightMm},quote:'先前客户确认的整屏尺寸'}:null;
  const prior=pending?.geometry||task?.geometryFocus||legacyFocus;
  const values=geometry.values||prior?.values;
  const entity=geometry.entity||prior?.entity||(task?.type==='ordering'||Object.keys(delta.screen||{}).length||geometry.unit?'screen':null);
  const unit=geometry.unit||(entity==='module'?'pixels':null)||(!geometry.values||commands.correct||commands.negate||task?.pendingUpdate?.correction||geometry.values&&Object.keys(geometry.values).length===1&&prior?.entity===entity?prior?.unit:null);
  const observation={...geometry,values,entity,unit,quote:geometry.values?text:(prior?.quote||'')+'；'+text};
  if(geometry.conflict){clarification='同一句中的单位或尺寸属性冲突，请确认是像素还是毫米。';pending={geometry:observation};}
  else if(values&&entity&&unit&&['module','screen'].includes(entity)){
   const typed=geometryDelta(observation,entity,unit);
   for(const key of ['module','screen'])if(typed[key])delta[key]={...delta[key],...typed[key]};
   delta.provenance={...delta.provenance,...typed.provenance};pending=null;resolvedGeometry=observation;
  }else if(entity!=='signal'&&entity!=='cabinet'){
   pending={geometry:observation};clarification=values?'已收到'+Object.values(values).join('×')+'。这是'+(entity==='module'?'模组':'整屏')+'像素分辨率，还是实际尺寸？实际尺寸请说明毫米或米。':'请补充要确认的宽高数值。';
  }
 }else if(geometry.unit&&pending?.geometry){
  const observation={...pending.geometry,unit:geometry.unit,entity:geometry.entity||pending.geometry.entity||'screen',quote:pending.geometry.quote+'；'+text};
  const typed=geometryDelta(observation,observation.entity,observation.unit);Object.assign(delta,typed);pending=null;resolvedGeometry=observation;
 }
 const deny=[];
 const discrete={environment:{indoor:['室内','户内'],outdoor:['室外','户外']},controlMode:{sync:['同步'],async:['异步']},architecture:{direct:['直控'],receiver:['接收卡']}};
 const exclusions=[];
 for(const [path,provenance]of Object.entries(delta.provenance||{}))if(provenance.kind==='user-negated'){
  const field=path.slice(1),values=Object.entries(discrete[field]||{}).filter(([,aliases])=>aliases.some(a=>text.includes(a))).map(([value])=>value);
  const previous=task?.ordering?.confirmed?.[field];
  if(!values.length||previous===undefined||values.includes(previous))deny.push(path);
  else delete delta.provenance[path];
  for(const value of values)exclusions.push({op:'exclude',path,value,source:{kind:'user-negated',text}});
 }
 const operations=leaves(delta).map(f=>({op:'set',...f,source:delta.provenance?.[f.path]||{kind:'user-stated',text}}));
 operations.push(...deny.map(path=>({op:'clear',path,source:{kind:'user-negated',text}})));
 operations.push(...exclusions);
 if(commands.negate){
  // Negated facts are removals, never positive replacements or their opposite.
  const denied=leaves(delta);
  for(const field of denied){
   const previous=field.path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],task?.ordering?.confirmed);
   for(let i=operations.length-1;i>=0;i--)if(operations[i].op==='set'&&operations[i].path===field.path)operations.splice(i,1);
   operations.push({op:JSON.stringify(previous)===JSON.stringify(field.value)?'clear':'exclude',...field,source:{kind:'user-negated',text}});
   const parts=field.path.split('/').filter(Boolean),last=parts.pop();let parent=delta;for(const part of parts)parent=parent?.[part];if(parent)delete parent[last];delete delta.provenance?.[field.path];
  }
  if(denied.length){pending=null;clarification=null;}
 }
 if(commands.correct&&!operations.length&&!geometry.values&&!geometry.unit){clarification='要更正哪项条件？请指出尺寸、分辨率、点间距、同步/异步或具体型号；已有条件先保留。';pending={...(pending||{}),correction:true};}
 if(relativeError){clarification=relativeError;pending={...(pending||{}),correction:true};}
 return {delta,geometry,resolvedGeometry,pending,clarification,commands,operations,hasChanges:operations.length>0};
}
module.exports={messageUpdate,leaves};
