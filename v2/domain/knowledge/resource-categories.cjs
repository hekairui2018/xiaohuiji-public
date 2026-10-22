'use strict';
const {classifyDocModel}=require('../../../backend/doc-category.cjs');
const {sourceClassification,browseGroup}=require('./source-classification.cjs');
const {specificationGroups}=require('./specification-groups.cjs');
const {alignedResourceGroups}=require('./aligned-resource-groups.cjs');
const {videoTopic,topicOrder}=require('./video-topics.cjs');
// Reuse document grouping and ordering without changing document configuration.
function aligned(group,model=''){
 const input={...group,products:[{model,items:[{fileId:'video-category-marker'}]}]};
 const result=alignedResourceGroups(specificationGroups([input]),[])[0];
 return result?{key:result.key,label:result.label}:{key:'other',label:'其他'};
}
const softwareGroup={key:'software-cloud',label:'软件、APP与云平台'};
const software=/HD\s*(?:Set|Player|Show|Sign|2018|2020)|LCD\s*Player|云平台|小灰云|屏掌控|Cloud|(?:^|[^A-Za-z])APP(?:[^A-Za-z]|$)/i;
const computer=/华硕|H510M[-_ ]?K|BIOS|开启核显|显卡驱动|Windows安装|电脑驱动|ToDesk|向日葵/i;
function directoryGroup(group,folders=[]){
 if(!group)return null;
 if(group.key==='software-cloud')return softwareGroup;
 // An EShare folder is not evidence that its A6L tutorial is an accessory.
 if((folders||[]).includes('EShare投屏'))return null;
 const mapped=aligned(group);
 return mapped.key!=='other'?mapped:null;
}
function classifyResource({name='',folders=[],model='',metadata='',sourceGroup=null}={}){
 const related=new Set(),basis=[],folderText=folders.join('/');
 const result=(group,reason)=>({categoryKey:group.key,categoryLabel:group.label,relatedCategoryKeys:[...related].filter(k=>k!==group.key),categoryBasis:[...basis,reason]});
 const other={key:'other',label:'其他'};
 if(computer.test(name))return result(other,'computer-environment-not-product-identity');
 const source=sourceGroup||sourceClassification({name,folders}).browseGroup;
 const directory=directoryGroup(source,folders);
 if(directory)return result(directory,'registered-product-source-folder');
 if(/LCD|液晶|商显|Huidu\s*OS|MagicPlayer/i.test(name)||/LCD|液晶|商显/i.test(folderText)){
  if(software.test(name))related.add('lcd');
  return result({key:'lcd',label:'LCD'},'explicit-lcd-domain');
 }
 if(software.test(name))return result(softwareGroup,'explicit-software-or-platform-title');
 if(/单双色|单色/.test(name))return result(aligned(browseGroup('单双色产品')),'explicit-product-category-title');
 const tokens=model?[model]:(name.match(/(?:HD[-_ ]?)?(?:VPX|VP|KV|VS|RB|RP|R|C|A|B|H|T|WF|W|D|MS|VM|DCS|CT|K)\d+[A-Z0-9]*(?:-[A-Z0-9]+)*/ig)||[]);
 const models=tokens.map(token=>{const key=classifyDocModel(token,metadata);return aligned({key:key==='sensor'?'accessory':key,label:key},token);}).filter(g=>g.key!=='other');
 const categories=new Map(models.map(g=>[g.key,g]));
 if(categories.size===1)return result([...categories.values()][0],'explicit-model-token');
 if(categories.size>1){categories.forEach((g,k)=>related.add(k));return result(other,'multiple-product-categories');}
 const category=/接收卡/.test(name)?'receiver':/处理器|拼接器/.test(name)?'processor':/发送卡|发送盒/.test(name)?browseGroup('T系列-同步发送').key:/配件|传感器/.test(name)?'accessory':null;
 if(category)return result(aligned({key:category,label:category}),'explicit-product-category-title');
 // These are existing product directory names, not generic LED/language hints.
 const folderGroup=(folders||[]).some(f=>/^(?:中控相关资料|中控资料|分布式、中控)$/.test(f))?browseGroup('分布式、中控'):(folders||[]).some(f=>/^(?:单色视频|单双色产品|单双色资料)$/.test(f))?browseGroup('单双色产品'):null;
 if(folderGroup)return result(aligned(folderGroup),'registered-specific-product-directory');
 return result(other,'insufficient-product-evidence');
}
function groupVideos(videos,resources=[]){
 const byName=new Map();for(const r of resources){if(!byName.has(r.name))byName.set(r.name,[]);byName.get(r.name).push(r);}
 const groups=new Map(),seen=new Map();
 for(const v of videos){
  let copies=byName.get(v.name)||[];
  if(v.sha256&&copies.some(r=>r.sha256===v.sha256))copies=copies.filter(r=>r.sha256===v.sha256);
  else {let id;try{id=new URL(v.url,'http://localhost').searchParams.get('id');}catch{}if(id&&copies.some(r=>String(r.locationId)===id))copies=copies.filter(r=>String(r.locationId)===id);else if(v.resourceId&&copies.some(r=>r.resourceId===v.resourceId))copies=copies.filter(r=>r.resourceId===v.resourceId);}
  const folders=copies[0]?.folders||[],sources=copies.map(r=>directoryGroup(sourceClassification(r).browseGroup,r.folders)).filter(Boolean),keys=new Set(sources.map(g=>g.key));
  const info=keys.size>1?{categoryKey:'other',categoryLabel:'其他',relatedCategoryKeys:[...keys],categoryBasis:['source-folder-category-conflict']}:classifyResource({name:v.name,folders,sourceGroup:sources[0]});
  const identity=v.sha256?'sha256:'+v.sha256:v.url?.startsWith('/')?'url:'+v.url:'name:'+v.name;
  if(seen.has(identity)){const previous=seen.get(identity);previous.alternativeNames=[...new Set([...(previous.alternativeNames||[]),v.name])];previous.alternativeUrls=[...new Set([previous.url,...previous.alternativeUrls||[],v.url].filter(Boolean))];continue;}
  const language=/中英|双语/.test(v.name)?'bilingual':/英文|英语|English|[-_（(]英(?:[)）.]|$)|(?:^|[\s_.(-])ENG?(?:[\s_.)-]|$)/i.test(v.name)?'en':/中文|国语|简中|（中）|\(中\)| - 中/.test(v.name)?'zh':v.language||'unknown';
  const unclassifiedReason=/签章|签字|盖章/.test(folders.join('/')+' / '+v.name)?'签章相关':/历史|旧版|老视频|停产/.test(folders.join('/'))||copies[0]?.versionSelection==='historical'?'历史视频':'待分类';
  const item={...v,...info,operationName:v.name.replace(/\.(mp4|webm|mov)$/i,''),operationTopic:videoTopic(v.name),language,languageLabel:{bilingual:'中英双语',en:'英文',zh:'中文',unknown:'语言未确认'}[language],...(info.categoryKey==='other'?{unclassifiedReason}:{} )};seen.set(identity,item);
  if(!groups.has(info.categoryKey))groups.set(info.categoryKey,{key:info.categoryKey,label:info.categoryLabel,videos:[]});groups.get(info.categoryKey).videos.push(item);
 }
 // Keep aligned product order; video browsing ends with LCD, then Other.
 const markers=[...groups.values()].filter(g=>!['lcd','other','software-cloud'].includes(g.key)).map(g=>({...g,products:[{model:'',items:[{fileId:'category:'+g.key}]}]}));
 const order=alignedResourceGroups(markers,[]).map(g=>g.key);if(groups.has('software-cloud'))order.push('software-cloud');if(groups.has('lcd'))order.push('lcd');if(groups.has('other'))order.push('other');
 return order.map(key=>{const g=groups.get(key);g.videos.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans-CN',{numeric:true}));const sections=new Map();for(const v of g.videos){const label=key==='other'?v.unclassifiedReason:v.operationTopic;if(!sections.has(label))sections.set(label,[]);sections.get(label).push(v);}return {...g,count:g.videos.length,sections:[...sections].map(([label,videos])=>({label,videos})).sort((a,b)=>{const order=key==='other'?['历史视频','签章相关','待分类']:topicOrder;return order.indexOf(a.label)-order.indexOf(b.label);})};});
}
module.exports={classifyResource,groupVideos};
