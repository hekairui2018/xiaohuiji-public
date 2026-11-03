'use strict';
const {comparisonValue}=require('../domain/knowledge/comparison-value.cjs');
const normalize=n=>String(n).replace(/,/g,'').replace(/^(\d+)\.0+$/,'$1');
const grouped=/(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d.,])/g;
const canon=t=>String(t||'').replace(grouped,normalize);
const identities=t=>String(t||'').replace(/\b(?:HD[- ]?)?[A-Za-z][A-Za-z_-]*\d[A-Za-z0-9_.+-]*\b/g,'').replace(/(?:案例|第)\s*\d+\s*(?:条|例|项|步|轮)?/g,'');
const numbers=t=>new Set((canon(identities(t)).match(/\d+(?:\.\d+)*/g)||[]).map(normalize));
const symbolic=v=>/[√✓✔✗✘]|(?:^|[\s:：])(?:[xX×]|[A-Z](?:\s*[+*/×÷]\s*\w+)+)(?:$|[\s，。])/u.test(String(v||''))||['unknown','uninterpreted-symbol','conflict'].includes(comparisonValue(v).state);
const modelKey=m=>String(m).toUpperCase().replace(/^HD[- ]?/,'');
function quickDelivery(result,{models=[]}={}){
 if(result?.status!=='answer')return {allowed:false,reason:'工具尚未给出完整答案'};
 const rows=result.results||[],requested=[...new Set([...(result.queryPlan?.models||[]),...models].map(modelKey))];
 const scope=rows.length&&rows.every(r=>r.queryMatch?.exact!==false&&!r.unknown&&!r.conflict)&&(!requested.length||requested.every(m=>rows.some(r=>(r.models||r.modelIds||[]).map(modelKey).includes(m))));
 if(result.answerBasis==='deterministic-social')return {allowed:true,reason:'固定社交回复'};
 if(['file-registry-columns','drive-file-metadata'].includes(result.answerBasis))return {allowed:!!scope&&!result.approximate&&!result.queryPlan?.unknownModels?.length&&rows.every(r=>r.resourceOnly===true&&typeof(r.download||r.downloadUrl)==='string'&&/^\/(?!\/)/.test(r.download||r.downloadUrl)),reason:'文件须准确匹配并有可交付的本地下载入口'};
 if(result.answerBasis==='parameter-source-cell')return {allowed:!!scope&&requested.length>0&&rows.every(r=>r.value!==undefined&&!symbolic(r.value)&&!r.conditions&&r.locator&&r.parameter),reason:'参数须型号匹配、原值明确、来源可定位且无未核对条件'};
 return {allowed:false,reason:'该工具返回的是候选原文、映射或待解释内容，需要模型核对，不能按answer状态直接交付'};
}
function validateClaimNumbers(claims,evidence,{message='',history=[]}={}){
 const customer=[message,...history.filter(m=>m.role==='user').map(m=>m.content)].join('\n'),customerNumbers=numbers(customer);
 for(const claim of claims){if(typeof claim.text!=='string')continue;const refs=(claim.evidenceIds||[]).map(id=>evidence.get(id)).filter(Boolean),source=refs.map(r=>r.text||'').join('\n'),allowed=numbers(source),text=identities(claim.text);
  if(/\d+(?:,\d+)+\s*(?:像素|点|mm|cm|米|毫米|厘米|个|路|张|万)/i.test(text)){for(const m of text.matchAll(/\d+(?:,\d+)+(?:\.\d+)?(?=\s*(?:像素|点|mm|cm|米|毫米|厘米|个|路|张|万))/gi))if(!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(m[0]))throw Error('expert-unsupported-number');}
  for(const clause of text.split(/[。；;\n]/)){const ns=numbers(clause);for(const n of ns){if(allowed.has(n))continue;
    const isCustomerCondition=/(?:客户(?:说|给|提供|要求)|你(?:说|给|提供)|本次(?:输入|要求)|假设|如果|若)/.test(clause)&&!/(?:支持|最大|额定|能够带|可以带|可带载|规格为)/.test(clause);
    if(isCustomerCondition&&customerNumbers.has(n))continue;
    const comparison=/(?:与本次|与客户|而非|不同|差异|本次为|客户为)/.test(clause)&&!/(?:支持|最大|额定|能够带|可以带|可带载|规格为)/.test(clause);
    if(comparison&&customerNumbers.has(n))continue;
    // Only explicit, dimension-preserving unit conversions; never combine arbitrary source numbers.
    const units={m:1000,'米':1000,cm:10,'厘米':10,mm:1,'毫米':1};let converted=false;
    for(const target of canon(clause).matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|米)(?![A-Za-z])/gi)){if(normalize(target[1])!==n)continue;for(const from of canon(source).matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|米)(?![A-Za-z])/gi)){if(Math.abs(Number(from[1])*units[from[2].toLowerCase()]-Number(target[1])*units[target[2].toLowerCase()])<1e-7)converted=true;}}
    if(converted)continue;
    throw Error('expert-unsupported-number');
  }}
 }
}
module.exports={quickDelivery,validateClaimNumbers};
