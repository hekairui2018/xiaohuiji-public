'use strict';
const {modelId}=require('../identity/model-id.cjs');
const deviceType=/(?:传感器|收发器|转换器|接收卡|发送卡|控制卡|播放盒|播放器|处理器|拼接器|服务器|主板|控制板|多功能卡|分配器|切换器|延长器|矩阵|中控|数字人|主控|控制系统|控制器|一体机|网口卡|USB\s*卡|Wi-Fi\s*卡|盒子|检测仪|集线器|同步发送|发送盒|软件|节点)$/;
const usable=text=>text&&text.length<=40&&/[\u4e00-\u9fff]/.test(text)&&deviceType.test(text)&&!/[。；;：:!?]|支持|兼容|配合|连接|适用|公司|解决方案/.test(text);
function deviceName(resource,id){
 const core=String(id||'').replace(/^HD-/i,'');if(!core)return null;
 const escaped=core.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const named=new RegExp('^(?:HD[-_ ]?)?'+escaped+'(?![A-Za-z0-9])[-_ ]*(.{1,40}?)(?:产品)?(?:规格书|技术规格)','i').exec(resource.name||'');
 if(named&&usable(named[1].trim()))return {name:named[1].trim(),basis:'original-filename-device-description'};
 const meta=resource.documentMetadata||{};
 const coverLines=String(resource.documentIntro||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,16);
 const exactCover=(meta.coverModels||[]).some(m=>modelId(m)===modelId(id))||coverLines.some(line=>new RegExp('^(?:HD[-_ ]?)?(?:Show\\s+)?'+escaped+'(?:[（(][A-Za-z0-9]+[）)]|×1)?$','i').test(line));
 const exactFile=new RegExp('^(?:HD[-_ ]?)?(?:Show\\s+)?'+escaped+'(?:\\([A-Za-z0-9]+\\))?\\s*(?:规格书|specifications?)','i').test(resource.name||'');
 const familyFile=exactFile&&/x/i.test(core.replace(/^[A-Za-z]+/,''))&&/^[A-Za-z]+/.exec(core)?.[0]&&meta.coverModels?.length&&meta.coverModels.every(m=>String(m).toUpperCase().startsWith(/^[A-Za-z]+/.exec(core)[0].toUpperCase()));
 if(!exactCover&&!familyFile&&(!exactFile||(meta.coverModels||[]).length))return null;
 const coverModelAt=coverLines.findIndex(line=>modelId(line)===modelId(id)||(meta.coverModels||[]).some(m=>modelId(line)===modelId(m)));
 const titleLines=coverModelAt>0?coverLines.slice(0,coverModelAt):coverLines;
 const names=[...new Set(titleLines.map(s=>s.replace(/^产品类别[：:]\s*/,'').replace(new RegExp('\\s*HD[-_ ]?'+escaped+'$','i'),'')).filter(s=>/^[\u4e00-\u9fffA-Za-z0-9 ()（）+、/&-]+$/.test(s)&&usable(s)))];
 if(!names.length&&exactFile&&coverLines.some(line=>/^LCD\s+USB[_ -]?HUB$/i.test(line)))return {name:'LCD USB集线器',basis:'cached-original-cover-device-term-translation'};
 return names.length===1?{name:names[0],basis:'cached-original-cover-device-description'}:null;
}
function selectedDeviceName(documents){
 const names=[...new Set(documents.filter(d=>d.kind==='spec'&&d.associationStatus!=='model-conflict').map(d=>d.deviceName).filter(Boolean))];
 return names.length===1?names[0]:null;
}
module.exports={deviceName,selectedDeviceName};
