'use strict';
const {chatIntent}=require('../../domain/parser/chat-intent.cjs');
const {extractKnownModels}=require('../../domain/identity/extract-models.cjs');
const {modelId}=require('../../domain/identity/model-id.cjs');
const {createQuickService}=require('./quick-service.cjs');
const {createDialogueService}=require('./dialogue-service.cjs');
// Coverage uses query tokens, not an arbitrary cross-engine BM25 score cutoff.
function relevantEvidence(query,rows,lookup,models=[]){
 const normalized=s=>String(s||'').normalize('NFKC').toLowerCase();
 let topic=normalized(query).replace(/(?:hd[-_ ]?)?[a-z]{1,6}\d[a-z0-9_+.-]*/g,token=>models.includes(modelId(token))?' ':token);
 topic=topic.replace(/请问|请|一下|帮我|如何|怎么|怎样|什么|有几个|有几|几个|数量|参数|规格|多少|是否|能否|可以|支持|需要|产品|资料|查询|设置|说明书|规格书|固件|软件|视频|教程|led|显示屏|屏幕|的|了|吗|呢/gi,' ');
 const tokens=topic.match(/[a-z0-9]+|[\u3400-\u9fff]{2,}/g)||[];
 return rows.filter(r=>{
  const named=extractKnownModels((r.name||'')+' '+(r.text||''),lookup);
  if(models.length&&!models.some(m=>named.includes(m)))return false;
  const text=normalized((r.name||'')+' '+(r.text||''));
  return tokens.length?tokens.every(t=>text.includes(t)):models.length>0&&models.some(m=>named.includes(m));
 });
}
function createQuickAnswer({app,knowledge,search,searchCases,localCatalog,resolveDocuments,localizeMedia=async x=>x}){
 const lookup={findProducts:id=>knowledge?.findProducts?.(id)||app?.quickSearch(id).records||[],isSoftware:text=>!!app?.resourceMedia?.softwareItems(text).length};
 const quick=app&&createQuickService(app,{localCatalog,resolveDocuments}),dialogue=app&&createDialogueService({...app,dialogue:app.customerDialogue||app.dialogue});
 const classify=text=>chatIntent(text,lookup);
 const unique=rows=>{const seen=new Set();return rows.filter(r=>{const k=r.sha256||r.download||r.id||r.name;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,4);};
 const file=d=>({name:d.name,text:d.reviewRequired?'资料关联仍需核对现场条件。':null,download:d.available?d.url:null,downloadUrl:d.downloadUrl,sha256:d.sha256,versionId:d.resourceVersionId,documentVersion:d.documentVersion,evidenceId:d.sha256?'file-'+d.sha256:null,associationStatus:d.associationStatus});
 async function retrieve(route,{facts={},sessionId}={}){
  const calls=[],base={intent:route.intent,query:route.query,kind:'all',results:[],retrievalTrace:calls};
  const tracked=async(name,fn)=>{const at=Date.now();const value=await fn();calls.push({name,elapsedMs:Date.now()-at});return value;};
  if(route.intent==='social')return {...base,reply:route.social==='thanks'?'不客气。':route.social==='capabilities'?'我可以查 LED 产品参数、说明书、固件和软件资料，协助售后排查及工程配单。请告诉我型号和具体问题。':'你好！请告诉我需要查询的 LED 产品或遇到的问题。'};
  if(route.intent==='clarify')return {...base,status:'clarify',reply:'目前不能确认你要查询的公司资料。请补充 LED 产品型号、资料类型或具体故障；复杂问题可使用专家模式。'};
  if(route.unknownModels?.length)return {...base,status:'clarify',reply:'尚未确认型号 '+route.unknownModels.join('、')+'。请核对完整型号，不能按相近型号提供参数或固件。'};
  if(route.hardwareRequested||(['resources','product'].includes(route.intent)&&facts.hardwareVersions?.length))return {...base,status:'clarify',reply:'当前查询包含硬件版本条件，但现有资料未建立该版本的适用关联，不能按相近型号或文件版本代替。请补充设备丝印和已确认的原文件依据。'};
  if(route.intent==='compatibility')return {...base,status:'clarify',reply:'不能仅凭型号相似判断固件通用。'+route.models.join('、')+'需要分别核对硬件版本、芯片、扫描方式及原固件文件；当前没有足够依据确认兼容，请勿互刷。'};
  if(route.intent==='ordering'&&dialogue){const result=await tracked('ordering-dialogue',()=>dialogue({message:route.query,sessionId}));return {...base,reply:result.result?.reason==='no-engineering-input'?'请补充屏幕宽高或分辨率、模组像素和扫描方式、使用场景及同步/异步需求。仅凭点间距和颜色不能可靠选择控制卡。':result.reply,status:result.status,result:result.result};}
  if(route.intent==='aftersales'){
   const data=await tracked('case-search',()=>searchCases(route.query,null,{...facts,...(route.models.length?{modelIds:route.models}:{})}));
   const flow=dialogue?await tracked('aftersales-dialogue',()=>dialogue({message:route.query,sessionId})):null;
   const wifi=/wi-?fi|ssid/i.test(route.query)&&/搜不到|找不到|搜索不到/.test(route.query);
   const advice=wifi?'通用检查方向：显示正常不能证明无线广播正常。先确认设备是否支持并开启 Wi-Fi、实际 SSID、手机附近能否发现，以及是否刚改过网络配置。':'通用检查方向：先确认异常范围与触发时间；在断电并记录原配置后，逐项检查对应区域的供电、排线和连接。避免同时更改多项参数。';
   return {...base,kind:'cases',reply:[advice,flow?.result?.diagnosis?.state&&flow.result.diagnosis.checks?.length?flow.reply:null,data.results.length?'以下是条件待核对的历史案例，不代表已确认当前原因。':'没有找到与当前条件明确关联的公司案例。请补充准确型号、异常区域、近期操作和已做检查。'].filter(Boolean).join('\n\n'),results:data.results.slice(0,3),result:flow?.result};
  }
  if(quick&&['resources','product'].includes(route.intent)){
   if(route.intent==='resources'&&route.category==='software'){const d=await tracked('software-catalog',()=>quick.software(route.query));const rows=d.software?.items||[];return {...base,reply:rows.length?'找到已登记的软件资料。':'没有找到对应软件，请提供准确软件名。',results:rows.slice(0,4).map(s=>({name:s.name,text:s.purpose,download:s.url||s.downloadUrl}))};}
   if(route.intent==='resources'&&route.category==='video'){const found=app.resourceLookup(route.query);const d=await tracked('video-catalog',()=>localizeMedia({video:{groups:[{videos:found?.items||[]}]}}));const rows=d.video?.groups?.flatMap(g=>g.videos||[])||[];return {...base,reply:rows.length?'找到关联视频。':'没有找到明确关联的视频，请补充软件和操作主题。',results:rows.slice(0,4).map(s=>({name:s.name,download:s.publicUrl}))};}
   if(!route.models.length)return {...base,status:'clarify',reply:'请提供准确产品型号，以便查找对应资料。'};
   const products=await tracked('exact-product-catalog',async()=>{const rows=[];for(const id of route.models)rows.push(...(await localizeMedia(await quick.search(id))).results.filter(p=>p.modelId===id));return rows;});
   if(route.intent==='resources'){const rows=products.flatMap(p=>(p.docGroups||[]).filter(g=>g.key===route.category).flatMap(g=>g.items));return {...base,reply:rows.length?'以下是该准确型号已登记的'+({manual:'说明书',spec:'规格书',firmware:'固件'}[route.category])+'。'+(route.category==='firmware'?'文件关联不代表已确认现场兼容；下载前核对硬件、芯片和变体。':''):'该准确型号没有找到可确认的这类资料；不会用其他型号替代。',results:unique(rows.map(file))};}
   const result=await tracked('product-consultation',()=>dialogue({message:route.query,sessionId}));return {...base,reply:result.reply,result:result.result,results:unique(products.flatMap(p=>p.specGroups.flatMap(g=>g.items)).map(file))};
  }
  // Explicit lexical lookup remains available, but raw keyword hits are references, never conclusions.
  const data=await tracked('fts5-bm25',()=>search(route.query,'text',{limit:8}));
  const rows=relevantEvidence(route.query,data.results,lookup,route.models);
  return {...base,reply:rows.length?'找到相关原文参考，尚不能据此确认答案；请核对原文或使用专家模式进一步分析。':'没有找到支持该问题的公司资料。请补充型号或具体操作条件。',results:unique(rows).map(r=>({...r,text:null}))};
 }
 return {classify,answer:retrieve,filter:(query,rows,models)=>relevantEvidence(query,rows,lookup,models)};
}
module.exports={createQuickAnswer};
