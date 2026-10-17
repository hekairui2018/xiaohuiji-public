'use strict';
const {modelId}=require('../identity/model-id.cjs');
const deviceType=/(?:传感器|收发器|转换器|接收卡|发送卡|控制卡|播放盒|播放器|处理器|拼接器|服务器|主板|控制板|多功能卡|分配器|切换器|延长器|矩阵|中控)$/;
const usable=text=>text&&text.length<=40&&/[\u4e00-\u9fff]/.test(text)&&deviceType.test(text)&&!/[。；;：:!?]|支持|兼容|配合|连接|适用|公司|解决方案/.test(text);
function deviceName(resource,id){
 const core=String(id||'').replace(/^HD-/i,'');if(!core)return null;
 const escaped=core.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const named=new RegExp('^(?:HD[-_ ]?)?'+escaped+'(?![A-Za-z0-9])[-_ ]*(.{1,40}?)(?:产品)?(?:规格书|技术规格)','i').exec(resource.name||'');
 if(named&&usable(named[1].trim()))return {name:named[1].trim(),basis:'original-filename-device-description'};
 const meta=resource.documentMetadata||{};
 if(!(meta.coverModels||[]).some(m=>modelId(m)===modelId(id)))return null;
 const names=[...new Set(String(resource.documentIntro||'').split(/\r?\n/).slice(0,16).map(s=>s.trim()).filter(s=>/^[\u4e00-\u9fffA-Za-z0-9 ()（）+、/-]+$/.test(s)&&usable(s)))];
 return names.length===1?{name:names[0],basis:'cached-original-cover-device-description'}:null;
}
function selectedDeviceName(documents){
 const names=[...new Set(documents.filter(d=>d.kind==='spec'&&d.associationStatus!=='model-conflict').map(d=>d.deviceName).filter(Boolean))];
 return names.length===1?names[0]:null;
}
module.exports={deviceName,selectedDeviceName};
