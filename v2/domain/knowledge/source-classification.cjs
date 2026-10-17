'use strict';
const {createHash}=require('node:crypto');
// This maps existing source folders to browse categories; it never assigns models.
const clean=s=>String(s).replace(/^\d+[、.．\s]+/,'').replace(/\s+/g,' ').trim();
function browseGroup(label){
 const value=clean(label).replace(/\s/g,'');
 if(/^(?:A系列-播放盒|H系列-多媒体播放盒)$/.test(value))return {key:'player',label:'播放盒（A、H系列）'};
 if(/^(?:K系列-接收卡|R系列-接收卡)$/.test(value))return {key:'receiver',label:'接收卡（K、R系列）'};
 if(/^(?:VP系列-处理器|VP系列-视频处理器规格书|VP系列)$/.test(value))return {key:'processor',label:'VP系列-处理器'};
 if(/^(?:配件|附件)$/.test(value))return {key:'accessory',label:'配件'};
 if(/^(?:单色|单双色产品|单双色)$/.test(value))return {key:'mono',label:'单双色产品'};
 if(/^(?:云平台|小灰云、APP|APP|屏掌控)$/.test(value))return {key:'software-cloud',label:'云平台、APP'};
 return {key:'source-'+createHash('sha256').update(value).digest('hex').slice(0,12),label:clean(label)};
}
function sourceClassification(resource){
 const folders=(resource.folders||[]).map(clean),name=resource.name||'',document=/\.(?:pdf|docx?|pptx?|xlsx?|wps|txt|md)$/i.test(name);
 const lcd=folders.some(s=>/^(?:LCD资料|LCD产品资料|产品规格书[（(]LCD[）)]|LCD|LCD商显主板)$/i.test(s));
 const led=folders.some(s=>/^(?:LED资料|LED产品资料|产品规格书[（(]LED[）)]|LED)$/i.test(s));
 let kind=null,certificate=false,exclusive=false,group=null,roleFolder=null;
 for(let i=0;i<folders.length;i++){
  const s=folders[i];let role=null,strict=false,cert=false;
  if(/^(?:.*产品)?规格书(?:[（(](?:LED|LCD)[）)])?$|^(?:.*模块|.*产品|.*设备)规格书$/.test(s)){role='spec';strict=true;}
  else if(/^(?:系统操作手册|操作说明|使用说明|用户手册|烧录操作说明|操作文档|中文文档|英文文档)$/.test(s)||s==='文档'&&folders.slice(0,i).some(x=>/^(?:操作说明|操作视频和文档)$/.test(x))){role='manual';strict=true;}
  else if(!/品质资料|控标文件和认证证书/.test(s)&&/认证证书|合格证|检验报告|检测报告|运输鉴定|认证资料及证书/.test(s)){role='other';strict=true;cert=true;}
  else if(/^(?:培训资料|日常培训文档|培训文档|产品技术培训PPT|产品宣讲PPT|产品彩页|产品宣传单页|竞品对比表|销售一指禅|技术参考|二次开发资料|SDK资料|芯片调试手册|故障排查文档|经验总结与对比资料)$/.test(s)||s==='文档'&&folders.includes('小文档与视频'))role='other';
  if(role){kind=role;exclusive=strict;certificate=cert;roleFolder=s;}
  if(/^(?:产品规格书[（(]LED[）)]|操作说明)$/.test(s)&&folders[i+1])group=browseGroup(folders[i+1]);
  if(s==='文档'&&folders.slice(0,i).some(x=>x==='操作说明')&&folders[i+1])group=browseGroup(folders[i+1]);
  if(s==='操作视频'&&folders[i+1])group=browseGroup(folders[i+1]);
 }
 const component=folders.some(s=>/^(?:4G|5G|LTE|通讯|通信)模块规格书$/i.test(s))?'communication-module':folders.some(s=>/^(?:产品型号电池一览表|迈洛克电池报告)$/.test(s))?'battery':null;
 const directoryTable=/\.(?:xlsx?|csv)$/i.test(name)&&(resource.documentMetadata?.evidence||[]).some(e=>(e.locator?.cells||[]).filter(c=>/^(?:资料名称|资料分类|资料内容)$/.test(c.value||'')).length>=2)&&resource.documentMetadata?.classificationStatus!=='manual-review';
 if(directoryTable){kind='other';exclusive=false;}
 const conflict=!!(resource.sourceDomainConflict||lcd&&led);
 if(lcd&&!conflict)group={key:'lcd',label:'LCD'};
 if(component||folders.includes('EShare投屏'))group=browseGroup('配件');
 const solution=folders.find(s=>/^\d*[-、. ]*全域AI数字交互解决方案$/.test(s));
 if(!group&&solution)group=browseGroup(solution.replace(/^\d+[-、. ]*/,''));
 const binary=/\.(?:exe|msi|apk)$/i.test(name)?'software':/\.bin$/i.test(name)&&resource.resourceType==='firmware'?'firmware':/\.(?:mp4|webm|mov)$/i.test(name)?'video':null;
 const formatConflict=!!binary&&exclusive&&['spec','manual'].includes(kind);
 if(binary&&!formatConflict){kind=binary;certificate=false;exclusive=false;}
 if(!document&&!binary)kind=null;
 if(!group&&folders.some(s=>/^(?:软件|软件下载器|小灰云、APP)$/.test(s)))group={key:'software-cloud',label:'软件、云平台、APP'};
 return {component,directoryTable,domain:conflict?null:lcd?'lcd':led?'led':null,domainConflict:conflict,certificate,kind:formatConflict?'pending':kind,detectedKind:binary,exclusive,formatConflict,roleFolder,browseGroup:group,basis:directoryTable?'cached-document-directory-table':'registered-source-folder'};
}
module.exports={sourceClassification,browseGroup};
