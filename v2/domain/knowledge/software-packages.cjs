'use strict';
const {sourceClassification}=require('./source-classification.cjs');
const {resourceView}=require('./resource-view.cjs');
function softwarePackages(resources,query=''){
 const q=String(query).trim().toLowerCase(),seen=new Set(),packages=[],historical=[];
 const oldFolder=r=>(r.folders||[]).some(s=>/旧版|历史版本|历史安装包/.test(s));
 for(const r of [...resources].sort((a,b)=>Number(a.availabilityState==='missing')-Number(b.availabilityState==='missing')||Number(oldFolder(a))-Number(oldFolder(b)))){
  if(r.resourceType!=='software'||!/\.(exe|msi|apk)$/i.test(r.name)||q&&!r.name.toLowerCase().includes(q))continue;
  const folders=r.folders||[];
  if(!folders.some(s=>/安装包|软件下载器|软件工具|^软件下载$|^软件$|^LCDplayer$|^ToolBox$/i.test(s)))continue;
  const identity=r.sha256||r.versionId||r.locationId;if(seen.has(identity))continue;seen.add(identity);
  const source=sourceClassification(r),old=oldFolder(r),available=!!r.sha256&&r.availabilityState!=='missing';
  const item=resourceView({name:r.name,kind:'software',resourceId:r.resourceId,resourceVersionId:r.versionId,sha256:r.sha256||null,
   url:available?'/v2/offline/file?id='+r.locationId+'&download=1':null,downloadUrl:available?'/v2/offline/file?id='+r.locationId+'&download=1':null,
   available,unavailableReason:available?null:r.availabilityState==='missing'?'registered-original-unavailable-or-changed':'registered-content-hash-missing',sourceMode:'local',resourceOnly:true,
   group:source.domain==='lcd'?'lcd':'other',groupLabel:source.domain==='lcd'?'LCD 商显软件':'其他本地软件工具',
   classificationBasis:'registered-software-source-folder',associationStatus:'scope-unconfirmed',reviewRequired:true,
   scopeEvidence:[],filenameVersionHint:r.name.match(/(?:^|[_ .-])V?(\d+(?:\.\d+){1,3})(?!\d)/i)?.[1]||null,
   historicalBasis:old?'source-folder-explicit-old-version':null});
  if(old)item.versionStatus='historical-source-folder';
  (old?historical:packages).push(item);
 }
 return {packages,historicalPackages:historical,uniquePackageCount:packages.length,historicalPackageCount:historical.length,note:'本地安装包浏览候选；文件名版号不是实际安装版本，目录用途不代表设备兼容性确认。'};
}
module.exports={softwarePackages};
