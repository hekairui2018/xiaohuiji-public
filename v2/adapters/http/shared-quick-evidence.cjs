'use strict';
const crypto=require('node:crypto');
// Preserve the exact quick-mode source scope; metadata is never presented as a body passage.
function sharedQuickEvidence(result){
 return (result?.results||[]).slice(0,4).filter(r=>r.name&&(r.resourceOnly||typeof r.text==='string'&&r.text.trim())).map(r=>({
  evidenceId:r.evidenceId||'shared-'+crypto.createHash('sha256').update(JSON.stringify([r.sha256,r.name,r.text,r.download])).digest('hex').slice(0,24),
  name:r.name,text:r.resourceOnly?'文件登记：'+r.name+'；'+(r.download||r.downloadUrl?'已提供可交付的下载卡片；回答引用本记录即可展示下载入口，无需再次搜索链接。':'本记录尚未提供下载入口。')+'此记录只证明找到文件，不代表正文参数、兼容性或操作结论。':r.originalText||r.text,
  modelIds:r.models||r.modelIds||[],locator:r.locator,download:r.download||r.downloadUrl||null,
  sourceKind:r.resourceOnly?'registered-resource-metadata':'shared-quick-original',readPerformed:true,readAvailable:false,contextComplete:false,
  verificationStatus:r.resourceOnly?'registered-file-only':'retrieved-source-passage',
 }));
}
module.exports={sharedQuickEvidence};
