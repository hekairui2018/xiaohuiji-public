'use strict';
const topics=[['reset','复位 · 恢复出厂',/复位|恢复出厂|出厂设置|断电重启|重置|reset/i],['usb','U盘操作',/u\s?盘|优盘|usb/i],['wifi','WiFi · 联网 · 密码',/wi[-\s]?fi|密码|station|局域网|固定\s?ip|开放式|桥接|无线路由|联网|连网|热点/i],['connect','连接配屏 · 拼接 · 多画面',/连接设置|多屏同步|多开|接线|级联|开窗|两画面|多画面|拼接|异型|错位|旋转安装|投屏|自适应|同步参数|分区播放/i],['smart','智能设置',/智能设置/],['program','节目编辑 · 发送',/节目|表格|时钟|天气|动画字|动态数据|多节目|开机画面|计数|回读|视频转码|loading|隐藏功能|设备锁/i]];
const norm=s=>String(s||'').toLowerCase().replace(/[\s_-]/g,'');
const synonyms=[['复位','恢复出厂','重置','reset'],['u盘','优盘','usb'],['wifi','wi-fi','无线','联网','密码'],['拼接','级联','多画面','多开']];
// Existing presentation groups, not intent routing or hardware compatibility rules.
const softwareGroups=[{key:'led',label:'LED 主控软件（电脑端）',ids:['HDSet','HDPlayer','HDShow','HD2020','HD2018','HDSign']},{key:'mobile',label:'手机 APP · 云平台',ids:['PingZhangKong','XiaoHuiYun']},{key:'lcd',label:'LCD 商显软件',ids:['LCDPlayer']}];
function createMediaCatalog(assets){
 const videos=(assets.videos||[]).filter(v=>v.status==='uploaded'&&v.publicUrl),software=assets.softwareCatalog||[];
 function videoItems(query=''){
  const q=norm(query),expanded=synonyms.filter(g=>g.some(t=>q.includes(norm(t)))).flat().map(norm);
  return videos.filter(v=>!q||norm(v.name).includes(q)||(expanded.length&&expanded.some(t=>norm(v.name).includes(t))));
 }
 function softwareItems(query=''){
  const q=norm(query);return software.filter(s=>!q||[s.name,...s.aliases].some(a=>q.includes(norm(a)))).map(s=>{
   const download=assets.software.find(d=>d.file===s.file&&d.status==='uploaded'&&d.publicUrl)||null,manuals=assets.manuals.filter(m=>m.softwareId===s.id&&m.status==='uploaded');
   const dirs={PingZhangKong:'app',XiaoHuiYun:'cloud'},id=norm(s.id);
   const related=videos.filter(v=>norm(v.ossKey?.split('/')[1])===(dirs[s.id]||id)||norm(v.name).includes(norm(s.name)));
   const group=softwareGroups.find(g=>g.ids.includes(s.id))||{key:'other',label:'其他软件'};
   return {...s,group:group.key,groupLabel:group.label,download,hasDownloader:Boolean(download),downloadUrl:download?.publicUrl||null,manuals:manuals.map(m=>({...m,name:m.label,url:m.publicUrl})),videos:{primary:related[0]?{...related[0],url:related[0].publicUrl}:null,more:related.slice(1).map(v=>({...v,url:v.publicUrl}))}};
  });
 }
 function videoCategory(query=''){
  const selected=videoItems(query),groups=new Map();for(const v of selected){const found=topics.find(([, ,re])=>re.test(v.name)),key=found?.[0]||v.ossKey?.split('/')[1]||'other',label=found?.[1]||key;
   if(!groups.has(key))groups.set(key,{key,label,count:0,videos:[]});const g=groups.get(key);g.count++;g.videos.push({...v,url:v.publicUrl,sizeText:Math.round(v.sizeBytes/1048576)+' MB'});
  }return {total:selected.length,groups:[{key:'operations',label:'操作视频',count:selected.length,videos:selected.map(v=>({...v,url:v.publicUrl,sizeText:Math.round(v.sizeBytes/1048576)+' MB'}))}],topicGroups:[...groups.values()]};
 }
 return {videoItems,softwareItems,videoCategory};
}
module.exports={createMediaCatalog};
function attachLocalSoftware(body,resources){
 for(const item of body.software?.items||[]){
  const expected=item.download?.file||item.file;if(!expected)continue;
  const candidates=resources.filter(r=>r.availabilityState!=='missing'&&r.resourceType==='software'&&norm(r.name)===norm(expected)&&r.sha256),hashes=new Set(candidates.map(r=>r.sha256));
  if(hashes.size===1){const r=candidates[0];item.downloadUrl='/v2/offline/file?id='+r.locationId+'&download=1';item.hasDownloader=true;item.sourceMode='local';item.resourceId=r.resourceId;item.resourceVersionId=r.versionId;item.originalName=r.name;item.sha256=r.sha256;item.versionStatus='manifest-version-not-installer-payload-confirmation';item.download={...item.download,file:r.name,publicUrl:item.downloadUrl,status:'local-indexed'};}
  else if(candidates.length)item.localUnavailableReason='same-name-content-conflict';
 }
 return body;
}
module.exports.attachLocalSoftware=attachLocalSoftware;
module.exports.videoQuerySynonyms=synonyms.map(group=>Object.freeze([...group]));
// Share the existing topic taxonomy with retrieval; a title ending in
// '操作演示' can still be a specific counting/reset/network tutorial.
module.exports.videoOperationTopic=name=>topics.find(([, ,pattern])=>pattern.test(String(name||'')))?.[0]||null;
