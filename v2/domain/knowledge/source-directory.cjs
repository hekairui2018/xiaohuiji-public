'use strict';
const nameCollator=new Intl.Collator('zh-Hans-CN',{numeric:true});
const compareNames=(a,b)=>nameCollator.compare(a,b);
const {sourceHistory}=require('./source-history.cjs');
const {selectDocumentVersions}=require('./document-versions.cjs');
const {accessInfo}=require('./resource-access.cjs');
function directoryItems(resources){
 resources=resources.filter(r=>String(r.sourceDrive||'').toUpperCase()==='G:');
 const copies=new Map();for(const r of resources){const key=r.sha256?'sha:'+r.sha256:r.versionId?'version:'+r.versionId:'location:'+r.locationId;if(!copies.has(key))copies.set(key,[]);copies.get(key).push(r);}
 const compared=selectDocumentVersions(resources.filter(r=>/\.(pdf|docx?|pptx?|xlsx?|csv|txt|md)$/i.test(r.name)),{includeHistory:true,includeSigned:true}).selected;
 const versions=new Map(compared.map(r=>[r.locationId,r]));
 return resources.map(r=>{const v=versions.get(r.locationId),history=sourceHistory(v||r,[r]),access=accessInfo(r,copies.get(r.sha256?'sha:'+r.sha256:r.versionId?'version:'+r.versionId:'location:'+r.locationId));return {...r,...access,...history,resourceVersionId:r.versionId,fileId:r.sha256?'sha256:'+r.sha256:r.versionId,documentVersion:v?.documentVersion||null,versionSelection:v?.versionSelection||null,historyStatus:history.archived?'archived-not-automatically-invalid':v?.versionSelection==='historical'?'historical-in-compared-family':'not-established',sourceDirectory:[r.sourceDrive,...r.folders||[]].filter(Boolean).join(' / '),available:r.availabilityState==='present',url:/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv)$/i.test(r.name)?'/v2/offline/preview?id='+r.locationId:'/v2/offline/file?id='+r.locationId,downloadUrl:'/v2/offline/file?id='+r.locationId+'&download=1'};});
}
function groupSourceDirectories(items){
 const unique=new Map(),sourceLocationCount=items.length;
 for(const item of items){const key=item.fileId||'location:'+item.locationId,source={sourceDirectory:item.sourceDirectory,locationId:item.locationId,name:item.name,documentVersion:item.documentVersion};if(!unique.has(key))unique.set(key,{...item,sourceLocations:[source],sourceDirectories:[item.sourceDirectory],alternateNames:[item.name]});else{const row=unique.get(key);row.sourceLocations.push(source);row.sourceDirectories=[...new Set([...row.sourceDirectories,item.sourceDirectory])];row.alternateNames=[...new Set([...row.alternateNames,item.name])];}}
 items=[...unique.values()];
 const roots=new Map();
 for(const item of items){let children=roots;const folders=[item.sourceDrive||'来源待确认',...(item.folders||[])];let node;
  for(const folder of folders){if(!children.has(folder))children.set(folder,{label:folder,children:new Map(),items:[],count:0});node=children.get(folder);node.count++;children=node.children;}
  node.items.push(item);
 }
 const serialize=nodes=>[...nodes.values()].sort((a,b)=>compareNames(a.label,b.label)).map(n=>({...n,children:serialize(n.children),items:n.items.toSorted((a,b)=>compareNames(a.name,b.name))}));
 return {directoryTree:serialize(roots),groups:[],total:items.length,uniqueFileCount:new Set(items.map(i=>i.fileId||'location:'+i.locationId)).size,directoryGrouping:'registered-source-directories',sourceLocationCount,removedDuplicateLocations:sourceLocationCount-items.length};
}
const commonDirectoryOrder=['软件','产品资料','固件','模组配置文件','2026年新调试  LED模组配置文件','故障排查文档','芯片调试手册','小灰云、APP','小文档与视频','异步全彩资料','LCD资料','中控相关资料','二次开发资料','培训资料','经验总结与对比资料','售前资料'];
function createDirectoryIndex(items){
 const {createHash}=require('node:crypto'),grouped=groupSourceDirectories(items),root=grouped.directoryTree.find(n=>n.label==='G:')||{items:[],children:[],count:0};
 const nodes=new Map(),files=[];
 function add(node,parts,breadcrumbs){const id=parts.length?createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,24):'root';const trail=[...breadcrumbs,{id,label:parts.at(-1)||'内部资料'}];
  const record={id,label:parts.at(-1)||'内部资料',count:node.count,breadcrumb:trail,entries:[]};nodes.set(id,record);
  const children=parts.length?node.children:[...node.children].sort((a,b)=>{const rank=n=>commonDirectoryOrder.includes(n)?commonDirectoryOrder.indexOf(n):commonDirectoryOrder.length;return rank(a.label)-rank(b.label)||compareNames(a.label,b.label);});
  for(const child of children){const childId=add(child,[...parts,child.label],trail);record.entries.push({type:'directory',id:childId,label:child.label,count:child.count});}
  for(const item of node.items){const entry={type:'file',...item,directoryId:id};record.entries.push(entry);files.push(entry);}
  return id;
 }
 add(root,[],[]);
 return {nodes,files,total:grouped.total,uniqueFileCount:grouped.uniqueFileCount,sourceLocationCount:grouped.sourceLocationCount,removedDuplicateLocations:grouped.removedDuplicateLocations};
}
function directoryPage(index,{directory='root',offset=0,query='',evidence=[],sort='name'}={}){
 if(!/^(?:root|[a-f0-9]{24})$/.test(directory)||!Number.isSafeInteger(offset)||offset<0||typeof query!=='string'||query.length>240||!['name','type'].includes(sort))throw Error('invalid-directory-request');
 const node=index.nodes.get(directory);if(!node)throw Error('directory-not-found');
 let entries=node.entries;
 if(query.trim()){
  const term=query.normalize('NFKC').toLocaleLowerCase(),matches=value=>String(value).normalize('NFKC').toLocaleLowerCase().includes(term);
  const directories=[...index.nodes.values()].filter(n=>n.id!=='root'&&matches(n.label)).map(n=>({type:'directory',id:n.id,label:n.label,count:n.count}));
  const files=index.files.filter(r=>[r.name,...r.alternateNames||[]].some(matches));
  entries=[...directories,...files];
 }
 if(sort==='name'&&query.trim())entries=[...entries].sort((a,b)=>a.type!==b.type?(a.type==='directory'?-1:1):compareNames(a.label||a.name,b.label||b.name));
 if(sort==='type'){const ext=r=>r.name?.split('.').at(-1).toLowerCase()||'';entries=[...entries].sort((a,b)=>a.type!==b.type?(a.type==='directory'?-1:1):a.type==='directory'?0:ext(a).localeCompare(ext(b))||compareNames(a.name,b.name));}
 const page=entries.slice(offset,offset+50);
 return {total:index.total,uniqueFileCount:index.uniqueFileCount,sourceLocationCount:index.sourceLocationCount,removedDuplicateLocations:index.removedDuplicateLocations,directoryGrouping:'lazy-source-directories',directoryPage:{id:node.id,label:node.label,breadcrumb:node.breadcrumb,query,sort,entries:page,pagination:{offset,limit:50,total:entries.length,returned:page.length,nextOffset:offset+page.length<entries.length?offset+page.length:null}}};
}
module.exports={directoryItems,groupSourceDirectories,createDirectoryIndex,directoryPage};
