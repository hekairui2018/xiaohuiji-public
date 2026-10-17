'use strict';
// Explicit publisher/user supplied entries; never infer a cloud address from a model.
function softwareAccess(items){
 const rows=items.map(x=>({...x,mobile:x.mobile?{...x.mobile}:undefined}));
 const app=rows.find(x=>x.id==='PingZhangKong');
 if(app){app.access={type:'qr',imageUrl:'/v2/software-access/screen-control.png',note:'扫码下载屏掌控，或在华为、小米、OPPO、VIVO、应用宝等应用商店搜索“屏掌控”。',basis:'user-provided-download-instruction'};}
 const cloud=rows.find(x=>x.id==='XiaoHuiYun');
 if(cloud){cloud.mobile={webUrl:'https://www.led-cloud.cn',webLabel:'中国大陆入口',webNote:'大陆手机号注册；港澳台及国际用户使用国际入口。'};cloud.access={type:'links',links:[{label:'中国大陆（内地）',url:'https://www.led-cloud.cn',note:'手机号绑定注册'},{label:'港澳台及国际',url:'https://www.led-cloud.com',note:'邮箱绑定注册'}],note:'独立部署版用户登录地址为：http:// + 电脑IP地址 + :端口号。需联系系统管理员获取具体登录地址。',basis:'user-confirmed-platform-entry'};}
 if(!rows.some(x=>x.id==='XiaoHuiYunStar'))rows.push({id:'XiaoHuiYunStar',name:'小灰云星空',aliases:['小灰云星空','星空'],group:'mobile',groupLabel:'手机 APP · 云平台',line:'云端信息发布',purpose:'小灰云星空云平台，使用浏览器登录。',hasDownloader:false,downloadUrl:null,manuals:[],videos:{primary:null,more:[]},mobile:{webUrl:'https://app.xiaohuiyun.com',webLabel:'小灰云星空网页版'},access:{type:'links',links:[{label:'小灰云星空网页版',url:'https://app.xiaohuiyun.com'}],basis:'registered-original-manual-login-section'}});
 return rows;
}
module.exports={softwareAccess};
