'use strict';
// Navigation only: no keyword matcher, exclusive routing, or filesystem restriction.
const retrievalDirections=[
 ['资料索取',['resources','files','text']],
 ['产品参数与型号对比',['products','text']],
 ['产品选型与工程配单',['products','text','calculate']],
 ['软件使用与操作配置',['faq','text','resources']],
 ['固件、芯片、版本兼容',['firmware','products','text','files']],
 ['故障诊断与售后案例',['cases','faq','text']],
 ['云平台、网络与远程管理',['faq','text','cases','resources']],
 ['公司信息、人工与售后服务',['text','faq','resources']]
].map(([direction,preferredScopes])=>({direction,preferredScopes}));
module.exports={retrievalDirections};
