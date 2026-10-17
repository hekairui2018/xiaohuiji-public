'use strict';
// Source folders describe browse organization, never firmware compatibility.
function sourceClassification(resource){
 const folders=(resource.folders||[]).map(s=>String(s).replace(/^\d+[、.．\s]+/,'').trim());
 const lcd=folders.some(s=>/^(?:LCD资料|LCD产品资料|产品规格书[（(]LCD[）)]|LCD|LCD商显主板)$/i.test(s));
 const led=folders.some(s=>/^(?:LED资料|LED产品资料|产品规格书[（(]LED[）)]|LED)$/i.test(s));
 const certificate=folders.some(s=>!/品质资料|控标文件和认证证书/.test(s)&&/认证证书|合格证|检验报告|检测报告|运输鉴定|认证资料及证书/.test(s));
 const spec=folders.some(s=>/^(?:产品)?规格书(?:[（(](?:LED|LCD)[）)])?$/.test(s));
 const manual=folders.some(s=>/^(?:系统操作手册|操作说明|使用说明|用户手册|烧录操作说明)$/.test(s));
 const reference=folders.some(s=>/^(?:培训资料|日常培训文档|培训文档|技术参考|二次开发资料|SDK资料)$/.test(s));
 const conflict=resource.sourceDomainConflict||lcd&&led;
 return {domain:conflict?null:lcd?'lcd':led?'led':null,domainConflict:!!conflict,certificate,kind:certificate||reference?'other':spec?'spec':manual?'manual':null,basis:'registered-source-folder'};
}
module.exports={sourceClassification};
