'use strict';
const {browseGroup}=require('./source-classification.cjs');
const {uniqueFiles}=require('./flat-resource-groups.cjs');
const {newestIn}=require('./document-dates.cjs');
const sourceKey=label=>browseGroup(label).key;
const cd=new Set(['C系列-异步发送卡','D系列-小屏控制卡'].map(sourceKey));
const order=['receiver','player',sourceKey('B系列-广告机专用'),'cd-control','processor',sourceKey('T系列-同步发送'),sourceKey('MS系列-服务器'),sourceKey('分布式、中控'),sourceKey('矩阵、音频处理器、分配器、切换器、延长器等信号传输设备'),'mono','accessory','lcd'];
// Browse presentation only. Source folders, model evidence and originals are unchanged.
function specificationGroups(groups){
 const merged=new Map();
 const matrix=browseGroup('矩阵、音频处理器、分配器、切换器、延长器等信号传输设备');
 for(const group of groups)for(const product of group.products){
  // Explicit user-confirmed browse placement; this does not change applicability.
  const target=/^(?:HD-)?VP8000M$/i.test(product.model)?matrix:group;
  const key=cd.has(target.key)?'cd-control':target.key;
  const label=key==='player'?'全彩播放盒（A、H系列）':key==='cd-control'?'C、D系列-全彩控制卡':target.label;
  if(!merged.has(key))merged.set(key,{...group,key,label,products:[]});
  merged.get(key).products.push(product);
 }
 return [...merged.values()].map(group=>{
  const products=new Map();
  for(const product of group.products){
   const key=product.model;
   if(!products.has(key))products.set(key,{...product,items:[]});
   products.get(key).items.push(...product.items);
  }
  const rows=[...products.values()].map(p=>({...p,items:uniqueFiles(p.items)})).map(p=>({...p,count:p.items.length}));
  rows.sort((a,b)=>newestIn(b.items).localeCompare(newestIn(a.items))||a.model.localeCompare(b.model,'zh-Hans-CN',{numeric:true}));
  return {...group,products:rows,count:rows.length,fileCount:rows.reduce((n,p)=>n+p.count,0)};
 }).filter(g=>g.count).sort((a,b)=>rank(a.key)-rank(b.key));
}
function rank(key){const i=order.indexOf(key);return i>=0?i:key==='unassigned-documents'?order.length+1:order.length;}
module.exports={specificationGroups};
