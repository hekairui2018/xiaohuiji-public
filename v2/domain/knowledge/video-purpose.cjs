'use strict';
// Browse purpose only. No claim that the video content has been watched or OCRed.
function videoPurpose(video,copies=[]){
 const roles=new Set();
 for(const r of copies){const folders=(r.folders||[]).join('/');
  if(/宣传|产品演示|展厅|解决方案/.test(folders))roles.add('promotion');
  else if(/培训|入职|产品宣讲/.test(folders))roles.add('training');
  else if(/操作视频|烧录视频|烧录操作说明|小文档与视频.*视频/.test(folders))roles.add('operation');
 }
 if(roles.size===1)return {purpose:[...roles][0],purposeBasis:'registered-source-folder'};
 if(roles.size>1)return {purpose:'unknown',purposeBasis:'source-folder-purpose-conflict'};
 if(/宣传|展厅|介绍|产品演示|解决方案/.test(video.name||''))return {purpose:'unknown',purposeBasis:'non-operation-title-needs-review'};
 if(/操作|设置|升级|烧录|连接|复位|配屏|发送|密码|导入|导出|安装|播放|拼接|接线|配网|reset|setup|configur|upgrade/i.test(video.name||''))return {purpose:'operation',purposeBasis:'filename-operation-candidate'};
 return {purpose:video.status==='uploaded'?'operation':'unknown',purposeBasis:video.status==='uploaded'?'existing-registered-video':'purpose-unconfirmed'};
}
function operationVideos(videos,resources=[]){
 const byName=new Map();for(const r of resources){if(!byName.has(r.name))byName.set(r.name,[]);byName.get(r.name).push(r);}
 const selected=[],withheld=[];
 for(const v of videos){let copies=byName.get(v.name)||[];if(v.sha256&&copies.some(r=>r.sha256===v.sha256))copies=copies.filter(r=>r.sha256===v.sha256);
  const info=videoPurpose(v,copies),row={...v,...info};(info.purpose==='operation'?selected:withheld).push(row);
 }return {selected,withheld};
}
module.exports={videoPurpose,operationVideos};
