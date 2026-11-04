'use strict';
// Channel conversion only. All models, quantities and drawings come from the core.
const {render}=require('./core.cjs');
const {createHash}=require('node:crypto');
const csv=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
const csvBuffer=rows=>Buffer.from('\ufeff'+rows.map(row=>row.map(csv).join(',')).join('\r\n'),'utf8');
const key=item=>createHash('sha256').update(item.type+'\0'+item.name+'\0'+(item.sha256||item.route||item.svg||item.url||'')).digest('hex').slice(0,24);
const model=m=>typeof m==='string'?m:m?.model||m?.modelId||'';
function comparison(table){
 const models=(table.models||[]).map(model),rows=table.rows||[];
 return {text:'参数对比\n'+rows.map(r=>(r.parameter||r.name||r.key)+'：'+(r.values||[]).map((v,i)=>models[i]+' '+String(v?.value??v)).join('；')).join('\n'),rows:[['参数项',...models],...rows.map(r=>[r.parameter||r.name||r.key,...(r.values||[]).map(v=>v?.value??v)])]};
}
function createPresentation({core,documents,media,internalWebOrigin}={}){
 function internalLink(url,label){try{const origin=new URL(internalWebOrigin),target=new URL(url,origin);if(target.origin!==origin.origin||!['http:','https:'].includes(target.protocol))return null;return '['+label+']('+target.href+')';}catch{return null;}}
 function resourceLink(row){const raw=row.download||row.downloadUrl||row.url;try{if(!raw)return null;if(raw.startsWith('/'))return internalLink(raw,'内部网页查看／下载');const u=new URL(raw);if(!row.accessRestricted&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!/^(?:localhost|127\.|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname))return '[打开／下载]('+u.href+')';}catch{}return null;}
 function plan(data){
  const blocks=[render({...data,results:[]})],items=[],choices=[],handled=[],notices=[];
  const add=item=>{item.id=key(item);if(!items.some(i=>i.id===item.id))items.push(item);};
  const r=data.result,normal=r?.plan,native=r?.nativeOrdering;
  if(normal||native){
   handled.push('ordering');
   const bom=r.bom||r.previewBom;
   if(bom?.length){const rows=[['物料','型号／规格','数量','单位'],...bom.filter(i=>i.quantity>0).map(i=>[i.kind==='module'?'模组':i.kind==='receiver'?'接收卡':'主控',i.kind==='module'&&normal?.module?'P'+normal.module.dotPitch.spacing+' '+normal.module.resolution.join('×')+'点':i.modelId,i.quantity,i.kind==='module'?'块':i.kind==='receiver'?'张':'台'])];blocks.push((r.previewBom?'暂定物料表':'物料表')+'\n'+rows.slice(1).map(row=>row.join('｜')).join('\n'));add({type:'file',name:r.previewBom?'暂定物料表.csv':'物料表.csv',buffer:csvBuffer(rows)});}
   const ports=r.topology?.portSummary;
   if(ports?.length)blocks.push('网口与接收卡\n'+ports.map(p=>'网口'+p.id+'：R'+p.firstReceiverNumber+'—R'+p.lastReceiverNumber+'，'+p.receivingUnits+'个连屏单元，'+p.points+'像素'+(p.integratedUnits?'（含内置'+p.integratedUnits+'个）':'')).join('\n'));
   if(r.hdsetSvg||r.topologySvg)add({type:'image',name:'接收卡连接图.png',svg:r.hdsetSvg||r.topologySvg});
   if(r.configurationSvg)add({type:'image',name:'配置画布图.png',svg:r.configurationSvg});
   for(const [i,d]of (native?.diagrams||[]).entries())add({type:'image',name:d.name||'原生连接图'+(i+1)+'.png',dataImage:d.url});
   if(normal&&bom?.length)add({type:'file',name:r.previewBom?'暂定配单BOM.xlsx':'配单BOM.xlsx',workbook:r});
   const demand=r.nativeDemand||r.provisionalExportDemand||r.normalizedDemand;
   const mapped=native?.configurationGroups?.status==='mapped',mixed=!!normal?.builtInRegions?.length,folded=!!normal?.specialCanvas?.configurationMapVerified,layout=!!normal?.layout;
   if(demand&&(mapped||mixed||folded||layout))add({type:'file',name:'接线配置包.zip',route:'/v2/ordering/package',demand});
   if(demand&&normal&&normal.architecture!=='direct'&&(!normal.specialCanvas||folded)&&(r.exportAllowed!==false||r.provisionalExportDemand||layout||mixed))add({type:'file',name:r.provisionalExportDemand||layout?'暂定连屏布局.ssm':'连屏布局.ssm',route:'/v2/ordering/ssm',demand});
   else if(normal||native)notices.push(normal?.architecture==='direct'?'直控方案不生成接收卡SSM。':r.configurationBlockReason||'当前方案未开放标准SSM导出，保留原有校验限制。');
   if(native&&!bom&&demand&&(mapped||native.success&&[1,2].includes(native.module?.lampBeadsType)))add({type:'file',name:'配单物料表.csv',route:'/v2/ordering/bom',demand});
   if(r.provisionalExportDemand||layout||r.previewBom)notices.push('附件沿用当前暂定条件／布局草稿；文件生成不等于现场条件已确认或设备下发已验证。');
   for(const option of r.options||[]){const goals=(option.goals||[]).map(g=>({ports:'省网口',cards:'省接收卡',neat:'排列整齐',async:'异步','cards-alternative':'接收卡备选'})[g]).filter(Boolean);choices.push({label:'方案'+option.id+'：'+goals.join('／')+'，'+option.controller+'，'+model(option.receiver)+' '+(option.metrics?.cards??'?')+'张／'+(option.metrics?.ports??'?')+'口',message:'配单方案：'+option.id});}
  }
  if(data.parameterComparison?.rows?.length){handled.push('parameterComparison');const table=comparison(data.parameterComparison);blocks.push(table.text);add({type:'file',name:'参数对比.csv',buffer:csvBuffer(table.rows)});}
  for(const card of data.caseCards||[]){handled.push('caseCards');const lines=['案例：'+card.title,card.conditions?'原现场条件：'+card.conditions:null,card.match?.relation?'与本次关系：'+card.match.relation:null,card.match?.differentObjects?.length?'明确差异：'+card.match.differentObjects.map(d=>d.requested+'／'+d.recorded?.join('、')).join('；'):null,card.outcomeEvidence?.length?'原文结果：'+card.outcomeEvidence.map(x=>typeof x==='string'?x:x.text||JSON.stringify(x)).join('；'):null,internalLink(card.preview,'查看完整原文与图片（内部入口）'),card.assets?.length?'该案例含'+card.assets.length+'项原文附件，沿用内部访问权限，不转传到企微云端。':null];blocks.push(lines.filter(Boolean).join('\n'));}
  const rows=[...(data.results||[]),...(data.rawEvidence||[])];
  function visibleResources(value,depth=0){if(depth>6||!value)return;if(Array.isArray(value)){for(const row of value)visibleResources(row,depth+1);return;}if(typeof value!=='object')return;let children=false;for(const k of ['items','versions','variants','files','manuals','downloads','documents','groups','topicGroups','videos'])if(Array.isArray(value[k])){children=true;visibleResources(value[k],depth+1);}if((value.name||value.filename||value.url)&&(!children||value.sha256))rows.push({...value,declaredAttachment:true});}
  for(const group of [data.fileGroups,data.attachments,data.images,data.video,data.software])visibleResources(group);
  const identities=new Set();
  for(const row of rows){if(!row||typeof row!=='object')continue;const identity=[row.name,row.sha256,row.download||row.downloadUrl||row.url].join('\0');if(identities.has(identity))continue;identities.add(identity);if(row.resourceOnly||row.declaredAttachment||row.kind==='file'||['file','image','video','firmware','software'].includes(row.type)||data.intent==='resources'){
    handled.push('resources');const imageData=row.dataUrl||row.url||row.data;
    if(typeof imageData==='string'&&imageData.startsWith('data:image/'))add({type:'image',name:row.name||row.filename||'图片.png',dataImage:imageData});
    else add({type:'resource',name:row.name||row.filename||'资料文件',sha256:row.sha256,row});
   }else if(row.type||row.kind==='video')notices.push((row.name||'返回附件')+'：'+(resourceLink(row)||'请在内部网页查看此类型资料。'));
  }
  for(const attachment of data.attachments||[])if(attachment&&typeof attachment==='object'&&!attachment.name&&!attachment.filename&&!attachment.url&&!attachment.sha256)notices.push('返回了暂无法识别的附件类型 '+(attachment.type||'unknown')+'，请在内部网页查看；该项未发送。');
  for(const [i,image]of (data.images||[]).entries())if(typeof image==='string'){if(image.startsWith('data:image/'))add({type:'image',name:'图片'+(i+1)+'.png',dataImage:image});else notices.push('图片'+(i+1)+'：'+(resourceLink({url:image})||'图片地址未通过可用入口校验，该项未发送。'));}
  for(const option of [...(data.wecomOptions||[]),...(data.followUp?.options||[])]){const message=option.value||option.message||option.text||option.label;if(typeof message==='string')choices.push({label:option.label||message,message});}
  for(const candidate of data.modelSuggestion?.candidates||[])choices.push({label:'按 '+candidate+' 继续查询',message:'上面说的 '+data.modelSuggestion.input+' 改成 '+candidate+'，继续查刚才的资料。'});
  if(choices.length){blocks.push('回复序号选择（15分钟内有效）：\n'+choices.slice(0,20).map((o,i)=>(i+1)+'. '+o.label).join('\n'));handled.push('choices');}
  return {text:blocks.filter(Boolean).join('\n\n'),items,choices:choices.slice(0,20),handled:[...new Set(handled)],notices};
 }
 async function resolve(item){
  if(item.type==='resource'){
   const files=await documents.prepare([item.row]);if(files.length)return {...item,...files[0],type:/\.(png|jpe?g)$/i.test(item.name)?'image':/\.mp4$/i.test(item.name)?'video':'file'};
   return {...item,type:'notice',text:item.name+'：'+(resourceLink(item.row)||'当前文件未通过可发送原件登记、大小或内容校验，请在内部网页核对。')};
  }
  if(item.svg)return {...item,buffer:media.svgImage(item.svg).buffer};
  if(item.dataImage)return {...item,buffer:media.dataImage(item.dataImage)};
  if(item.workbook)return {...item,buffer:await media.workbook(item.workbook)};
  if(item.route)return {...item,buffer:await core.binary(item.route,item.demand)};
  if(item.buffer)return item;
  throw Error('unhandled-delivery-type');
 }
 return {plan,resolve};
}
module.exports={createPresentation,csvBuffer,comparison};
