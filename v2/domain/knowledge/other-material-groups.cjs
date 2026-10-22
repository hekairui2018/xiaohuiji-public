'use strict';
const {resourceCopies,accessInfo}=require('./resource-access.cjs');
const {isSignedDocument}=require('./document-versions.cjs');
const {identifyDocument}=require('./document-catalog.cjs');
const definitions=[['history','历史旧版资料'],['signed','签章及盖章文件'],['internal','内部受限资料'],['external','其他厂家及竞品资料'],['technical','培训及技术参考'],['project','工程项目及案例'],['certificate','认证及检测资料'],['general','其他普通资料'],['pending','待确认']];
const identity=item=>item.fileId||item.sha256&&'sha256:'+item.sha256||item.resourceVersionId||item.versionId||item.url||item.downloadUrl;
function materialInfo(item,copies=[]){
 const folders=copies.flatMap(r=>r.folders||[]),source=folders.join('/'),name=item.name||'',metas=copies.map(r=>r.documentMetadata||{}),flags=new Set(),basis=[];
 const add=(key,why)=>{flags.add(key);basis.push(why);};
 const access=accessInfo(item,copies);
 if(access.accessRestricted)add('internal',access.accessBasis);
 // Source archival status is not a declaration of invalidity. A year/"旧" in
 // an arbitrary filename is not sufficient to mark a file obsolete.
 if(item.versionSelection==='historical'||copies.some(r=>r.versionSelection==='historical'||r.lifecycleStatus==='superseded')||folders.some(f=>/^(?:历史报告|历史资料|旧版资料|已停产资料|已作废资料)$/.test(f)))add('history','explicit-source-archive-or-compared-document-family');
 if(isSignedDocument(item)||copies.some(r=>isSignedDocument({name:[...(r.folders||[]),r.name].join('/')})))add('signed','registered-signed-edition-or-signing-source');
 if(folders.some(f=>/竞品对比|其他厂家|友商资料|其他品牌/.test(f))||/模组配置文件\/海康威视/.test(source)||copies.some(r=>r.manufacturerRole==='other-manufacturer'))add('external','explicit-other-manufacturer-or-competitive-comparison-source');
 const specificSource=folders.filter(f=>!/控标文件和认证证书|品质资料（/.test(f)).join('/');
 if(metas.some(m=>m.certificate)||/认证|证书|合格证|检验报告|检测报告|运输鉴定|第三方CNAS报告|电池报告/.test(specificSource)||/证书|合格证|CNAS报告|检测报告|检验报告|ROHS|REACH|test report|certificate/i.test(name))add('certificate','registered-certificate-testing-source-or-original-metadata');
 if(/培训|技术参考|技术总结|技术分享|经验总结|芯片调试手册|二次开发|SDK|研发资料|产品宣讲PPT|产品技术培训PPT|公司产品对接协议|全彩常见问题分享/.test(source)||metas.some(m=>m.knowledgeUse==='technical-reference'))add('technical','registered-training-development-or-technical-reference-source');
 if(/项目对接|定制项目|工程项目|应用案例|施工总结|调试总结|售前资料\/.*(?:解决方案|方案库|案例集)/.test(source))add('project','registered-engineering-project-or-solution-source');
 const conflict=!!item.classificationConflict||item.associationStatus==='model-conflict'||copies.some(r=>r.documentMetadata?.classificationStatus==='conflict');
 if(conflict)add('pending','original-role-or-model-conflict-needs-review');
 if(!flags.size){
  const headerLabels=metas.flatMap(m=>(m.evidence||[]).filter(e=>e.locator?.row<=3).flatMap(e=>e.locator.cells||[])).map(c=>typeof c==='string'?c:c.value||'');
  const headerReference=headerLabels.filter(v=>/型号|版本|功能|参数|接收卡|芯片|协议|产品|模组|接口/.test(v)).length>=2;
  const structuredProtocol=headerLabels.some(v=>/键值/.test(v))&&headerLabels.some(v=>/调试软件/.test(v));
  const firmwareMatrix=metas.some(m=>(m.evidence||[]).some(e=>/固件/.test(e.locator?.sheet||'')))&&headerLabels.some(v=>/FPGA|V\d{2}\.xx|ICN系列/.test(v));
  if((headerReference&&/知识库|固件|中控资料|LCD资料/.test(source))||(structuredProtocol&&/灯光控制器/.test(source))||(firmwareMatrix&&/知识库|固件/.test(source)))add('technical','parsed-table-header-and-registered-technical-source');
  else if(/接收卡固件\/特殊模组固件/.test(source)&&/\.pptx$/i.test(name)&&copies.some(r=>r.parseStatus?.state==='parsed'))add('technical','parsed-technical-presentation-in-special-module-firmware-source');
  else if(copies.length&&(/产品彩页|产品宣传单页|销售一指禅|版本更新信息|产品参数|软件|小文档与视频|小灰云|APP|控标文件|公司简介PPT|产品介绍PPT|售前行销三件套|产品对比&速查表|产品型号电池一览表/.test(source)||copies.some(r=>identifyDocument(r)?.kind==='manual'&&/操作说明|使用说明|用户手册/.test((r.folders||[]).join('/')))||metas.some(m=>m.classificationStatus==='manual-review')))add('general','registered-reference-purpose-source');
  else add('pending',copies.length?'insufficient-document-purpose-evidence':'original-source-not-established');
 }
 const key=access.accessRestricted?'internal':conflict?'pending':['history','signed','external','certificate','project','technical','general','pending'].find(k=>flags.has(k));
 const kinds=new Set(copies.map(r=>identifyDocument(r)?.kind).filter(k=>k&&k!=='pending'));
 const baseKind=kinds.size===1?[...kinds][0]:null;
 return {...access,materialProperty:key,materialPropertyLabel:definitions.find(([k])=>k===key)[1],materialProperties:[...flags],materialPropertyBasis:basis,
  baseDocumentKind:baseKind,historyStatus:flags.has('history')?'archived-not-automatically-invalid':'not-established',
  manufacturerRole:flags.has('external')?'other-manufacturer-or-comparison':/模块.*认证|正基WiFi/.test(source)?'supplier-component-not-product-competitor':'not-established'};
}
function groupOtherMaterials(groups,resources=[]){
 const unique=new Map();let associations=0;
 for(const group of groups)for(const product of group.products||[])for(const item of product.items){
  associations++;const key=identity(item)||'unconfirmed:'+associations;
  if(unique.has(key)){const old=unique.get(key);old.associatedModels=[...new Set([...old.associatedModels,...item.associatedModels||[]])];old.sourceAssociations.push({group:group.label,product:product.model});continue;}
  const copies=resourceCopies(item,resources),info=materialInfo(item,copies);
  unique.set(key,{...item,...info,associatedModels:[...item.associatedModels||[]],sourceAssociations:[{group:group.label,product:product.model}],
   sourceDirectories:[...new Set(copies.map(r=>(r.folders||[]).join(' / ')))],
   materialSourceCount:copies.length});
 }
 const result=[];for(const [key,label]of definitions){const rows=[...unique.values()].filter(r=>r.materialProperty===key);if(!rows.length)continue;
  const sections=new Map();for(const row of rows){const sources=row.sourceAssociations.filter(s=>!/分类待确认|待确认资料/.test(s.group)),section=sources[0]?.group||row.sourceDirectories[0]?.split(' / ').slice(-2).join(' / ')||'来源待核对';if(!sections.has(section))sections.set(section,[]);sections.get(section).push(row);}
  const products=[...sections].map(([model,items])=>({model,label:model,count:items.length,items}));result.push({key:'material-'+key,label,materialProperty:key,products,count:products.length,fileCount:rows.length});
 }
 return {groups:result,total:unique.size,uniqueFileCount:unique.size,sourceAssociationCount:associations,removedDuplicateAssociations:associations-unique.size,
  materialGrouping:'document-nature;product-and-source-as-secondary;one-original-once',materialCounts:result.map(g=>({key:g.materialProperty,label:g.label,count:g.fileCount}))};
}
module.exports={groupOtherMaterials,materialInfo,definitions,identity};
