'use strict';
const {modelId}=require('../identity/model-id.cjs');
const {extractKnownModels}=require('../identity/extract-models.cjs');
const {createMediaCatalog}=require('./media-catalog.cjs');
const key=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function createResourceService(knowledge,evidence){
 const products=knowledge?.products()||[],assets=knowledge?.assets()||{videos:[],software:[],manuals:[],softwareCatalog:[]},media=createMediaCatalog(assets);
 const allFiles=products.flatMap(p=>(p.firmware||[]).filter(f=>f.status==='uploaded'&&f.publicUrl).map(f=>({...f,modelId:p.modelId,compatibilityConfirmed:false})));
 function chipLookup(text,providedDevices=[]){
  const tokens=(String(text).match(/[A-Z]*\d+[A-Z0-9_-]*(?:\([A-Z0-9]+\))?/gi)||[]).map(key),exact=evidence.chips.data.rows.filter(row=>[...row.models,...(row.numericAliases||[])].some(name=>key(name)===key(text))),rows=exact.length?exact:evidence.chips.data.rows.filter(row=>[...row.models,...(row.numericAliases||[])].some(name=>tokens.includes(key(name))));if(!tokens.length||!rows.length)return null;
  const items=rows.map(row=>({...row,sourceReference:{...evidence.chips.sourceReference,page:row.page,sourceVersion:evidence.chips.data.sourceVersion},verificationStatus:'source-index-literal-not-device-compatibility'}));
  const families=items.map(row=>Object.entries(evidence.display.data.firmwareFamilies).find(([,f])=>f.label===row.firmwareType)?.[0]||null),family=items.length===1?families[0]:null;
  const dedicated=items.some(row=>evidence.display.data.dedicatedMarkers.some(m=>row.firmwareType.includes(m))),decoder=items.some(row=>/译码|解码|借用/.test(row.smartSelection+' '+row.firmwareType));
  const requested=providedDevices.map(d=>modelId(d.modelId));const files=[];
  if(family&&!dedicated&&!decoder)for(const p of products){if(requested.length&&!requested.includes(p.modelId))continue;
   const tails=evidence.suffixes.data.rows.filter(r=>r.models.some(m=>modelId(m)===p.modelId));
   for(const f of p.firmware||[])if(f.status==='uploaded'&&f.publicUrl&&modelId(f.card)===p.modelId&&tails.some(r=>r.suffix===f.hwFromFile)&&(family==='common'?f.commonCode===true:f.series===family))files.push({...f,modelId:p.modelId,compatibilityConfirmed:false});
  }
  const primary=items[0],facts=[{label:'智能设置',text:primary.smartSelection||'源表未记录，需核实'},{label:'资料固件类别',text:items.length===1?(primary.firmwareType||'源表未记录，需核实'):'查询命中多个不同记录，请确认完整芯片型号'}];
  const known=new Set(items.flatMap(i=>i.models)),prefix=primary.models[0]?.match(/^[A-Z]+/i)?.[0],nearby=evidence.chips.data.rows.filter(row=>row.firmwareType&&row.models.some(m=>m.match(/^[A-Z]+/i)?.[0]===prefix)).flatMap(row=>row.models.filter(m=>!known.has(m)).map(chip=>({chip,firmware:row.firmwareType,sourceReference:{...evidence.chips.sourceReference,page:row.page},relation:'navigation-only-not-compatibility'}))).slice(0,12);
  for(const requestedModel of requested){for(const row of evidence.suffixes.data.rows.filter(r=>r.models.some(m=>modelId(m)===requestedModel)))facts.push({label:requestedModel+' 型号尾位（'+row.variant+'）',text:row.suffix,sourceReference:evidence.suffixes.sourceReference});
   const group=evidence.display.data.asyncFamilies.find(g=>g.models.some(m=>modelId(m)===requestedModel)),mapping=family&&group?.mappings[family];if(mapping)facts.push({label:requestedModel+' 异步固件源关系',text:mapping.status!=='confirmed'?'该系列尚未核实':mapping.deliveryVerified===false?'仅有系列版本字段依据，尚未确认交付原文件':mapping.suffix+'（需继续核对实际原文件与硬件条件）',sourceReference:evidence.display.sourceReference});
  }
  return {kind:'chips',items,family,files,sourceReferences:[evidence.chips.sourceReference,evidence.display.sourceReference,evidence.suffixes.sourceReference],view:{title:primary.models.join('/')+' · 芯片资料',primary:{chip:primary.models.join(' / '),facts,firmwareFamily:family,isDecoder:decoder},hits:items.map(row=>({chip:row.models.join('/'),firmwareLabel:row.firmwareType,sourceReference:row.sourceReference})),hitCount:items.length,nearby,firmwareItems:files.map(f=>({name:f.file,clean:f.card+' · '+f.file,url:f.publicUrl,conditions:{hardware:f.hwFromFile,variant:f.variant,series:f.series},sourceReference:f.sourceReference})),firmwareSeriesLabel:family?evidence.display.data.firmwareFamilies[family].label:'',source:'芯片选型 '+evidence.chips.data.sourceVersion}};
 }
 function query(topic,{providedDevices}={}){
  if(!topic)return null;const text=String(topic),devices=providedDevices||extractKnownModels(text,{findProducts:id=>knowledge?.findProducts(id)||[]}).map(modelId=>({modelId}));
  if(devices.some(d=>d.revisionId)&&/固件|芯片|规格书|说明书|视频|\.bin\b/i.test(text))return {kind:'firmware',status:'needs_input',items:[],reason:'hardware-revision-not-established-in-source'};
  const modelIds=devices.map(d=>modelId(d.modelId)),namedFiles=allFiles.filter(f=>text.toLowerCase().includes(f.file.toLowerCase()));
  if(namedFiles.length){const matched=namedFiles.filter(f=>!modelIds.length||modelIds.includes(f.modelId));return {kind:'firmware',status:matched.length?'found':'conflict',items:matched,reason:matched.length?null:'named-firmware-conflicts-with-requested-model'};}
  if(/视频|教程|演示/.test(text)){
   const topicQuery=text.replace(/(?:给我|请|操作|视频|教程|演示|怎么|如何|的)/g,'').trim(),matchedSoftware=media.softwareItems(text),fromSoftware=matchedSoftware.flatMap(s=>[s.videos.primary,...s.videos.more].filter(Boolean));
   let items=fromSoftware.length?fromSoftware:media.videoItems(topicQuery);
   if(fromSoftware.length&&/复位|重置|恢复出厂|优盘|u盘|wifi|wi-fi|拼接|级联/i.test(text)){const relevant=new Set(media.videoItems(topicQuery).map(v=>v.ossKey));items=items.filter(v=>relevant.has(v.ossKey));}
   if(devices.length)items=items.filter(v=>{const named=extractKnownModels(v.name,{findProducts:id=>knowledge?.findProducts(id)||[]});return devices.some(d=>named.includes(modelId(d.modelId))||/A[×x]L系列/i.test(v.name)&&/^HD-A\d+L$/.test(modelId(d.modelId)||''));});
   return {kind:'videos',status:items.length?'found':'needs_input',items,reason:items.length?null:'no-source-linked-video-for-this-topic-or-model'};
  }
  const chip=devices.length&&!/芯片|固件|智能设置/.test(text)?null:chipLookup(text,devices);if(chip)return chip;
  if(/固件|\.bin\b/i.test(text)){
   if(devices.some(d=>d.revisionId))return {kind:'firmware',status:'needs_input',items:[],reason:'hardware-revision-not-established-in-source'};
   const items=allFiles.filter(f=>modelIds.includes(f.modelId));if(modelIds.length)return {kind:'firmware',status:items.length?'found':'needs_input',items,reason:items.length?null:'no-original-file-established-for-this-model'};
  }
  if(/规格书|说明书|手册/.test(text)&&devices.length){const kind=/规格书/.test(text)?'spec':'manual',items=devices.flatMap(d=>(knowledge?.findProducts(d.modelId)||[]).flatMap(p=>(p.documents||[]).filter(doc=>doc.kind===kind).map(doc=>({...doc,modelId:p.modelId}))));return {kind:'documents',status:items.length?'found':'needs_input',items,reason:items.length?null:'no-source-linked-document-for-this-model'};}
  const software=media.softwareItems(text);if(software.length)return {kind:'software',items:software};
  if(/芯片|固件|规格书|说明书/.test(text))return {kind:/芯片/.test(text)?'chips':/固件/.test(text)?'firmware':'documents',status:'needs_input',items:[],reason:'need-exact-model-and-source-details'};
  return null;
 }
 return {query:(...args)=>structuredClone(query(...args)),chipLookup:(...args)=>structuredClone(chipLookup(...args)),media:{videoItems:q=>structuredClone(media.videoItems(q)),softwareItems:q=>structuredClone(media.softwareItems(q)),videoCategory:q=>structuredClone(media.videoCategory(q))}};
}
module.exports={createResourceService};
