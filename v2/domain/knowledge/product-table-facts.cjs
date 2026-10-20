'use strict';
const {modelId}=require('../identity/model-id.cjs');
const {selectDocumentVersions}=require('./document-versions.cjs');
const column=cell=>/^([A-Z]+)\d+$/.exec(cell)?.[1];
function tableRows(blocks,source){
 const headers=new Map(),rows=[];
 for(const b of blocks){const l=b.locator||{},cells=l.cells||[];
  if(!l.sheet||!Number.isInteger(l.row))continue;
  if(cells.some(c=>c.value==='型号')&&cells.some(c=>c.value==='支持点数')&&cells.some(c=>c.value==='最宽')&&cells.some(c=>c.value==='最高')){
   headers.set(l.sheet,new Map(cells.map(c=>[column(c.cell),String(c.value).trim()])));continue;
  }
  const header=headers.get(l.sheet);if(!header)continue;
  const fields=Object.fromEntries(cells.map(c=>[header.get(column(c.cell)),String(c.value).trim()]).filter(([k])=>k));
  if(!/^(?:HD[-_ ]?)?[A-Z]+\d+[A-Z0-9]*(?:[-+][A-Z0-9]+)*$/i.test(fields['型号']||''))continue;
  rows.push({modelId:modelId(fields['型号']),fields,source:{name:source.name,sha256:source.sha256,url:'/v2/offline/preview?id='+source.locationId,sheet:l.sheet,row:l.row,blockId:b.id}});
 }
 return rows;
}
function projectTableFacts(rows){
 if(!rows.length)return null;
 const fields={};const conflicts=[];
 for(const name of new Set(rows.flatMap(r=>Object.keys(r.fields)))){const values=[...new Set(rows.map(r=>r.fields[name]).filter(Boolean))];if(values.length===1)fields[name]=values[0];else conflicts.push(name);}
 const f={};const supported=s=>/^支持(?:[（(]|$)/.test(s||'');
 const points=/^(\d+)\s*[×*x]\s*(\d+)$/.exec(fields['支持点数']||'');
 if(points)f.load=`${points[1]}×${points[2]}点（${Number(points[1])*Number(points[2])}像素）`;
 const width=/^\d+$/.test(fields['最宽']||'')?fields['最宽']:null,height=/^\d+$/.test(fields['最高']||'')?fields['最高']:null;
 if(width&&height){f.resolution=`最宽 ${width}；最高 ${height}（独立上限）`;f.resolutionLabel='宽高上限';
  for(const key of ['宽打折触发宽度','高打折触发高度'])if(/^\d+$/.test(fields[key]||''))f.resolution+=`；${key}：${fields[key]}`;
 }
 f.inputs=['HDMI IN','DP'].filter(k=>supported(fields[k])).map(k=>k+'：'+fields[k]).join('；');
 f.outputs=[/^\d+路$/.test(fields['网口级联']||'')?'级联网口：'+fields['网口级联']:'',supported(fields['HDMI 输出'])?'HDMI输出：'+fields['HDMI 输出']:''].filter(Boolean).join('；');
 f.interfaces=['有线网口','USB','板载Wi-Fi 2.4G','板载Wi-Fi 5G'].filter(k=>fields[k]&&!/^不支持$/.test(fields[k])).map(k=>k+'：'+fields[k]).join('；');
 f.highlights=['存储','运行内存','视频','转码要求','U盘直播视频和图片'].filter(k=>fields[k]&&!/^不支持$/.test(fields[k])).map(k=>k+'：'+fields[k]).join('；');
 return {features:f,fields,sources:rows.map(r=>r.source),conflicts};
}
function createProductTableFacts({localCatalog,request}){
 let catalog=null,pending=null,retryAt=0;
 return async products=>{
  const resources=await localCatalog();
  if(catalog!==resources||retryAt&&Date.now()>=retryAt){catalog=resources;retryAt=0;pending=(async()=>{
   const candidates=[...new Map(selectDocumentVersions(resources.filter(r=>r.availabilityState==='present'&&/^[a-f0-9]{64}$/i.test(r.sha256||'')&&/\.xlsx$/i.test(r.name)&&/(?:产品|设备).*(?:特性|速查|对标|对比)/.test(r.name))).selected.map(r=>[r.sha256,r])).values()];
   const tables=[];
   for(const source of candidates.slice(0,6)){
    try{const blocks=[];let offset=0;
     for(let page=0;page<4;page++){const body=await request('/preview-document?id='+source.locationId+'&offset='+offset);if(body.sha256!==source.sha256)break;blocks.push(...body.blocks||[]);if(body.nextOffset==null)break;offset=body.nextOffset;}
     tables.push(...tableRows(blocks,source));
    }catch{retryAt=Date.now()+30000;/* A missing table never makes product/document lookup fail. */}
   }
   return tables;
  })();}
  const rows=await pending;
  return products.map(p=>projectTableFacts(rows.filter(r=>r.modelId===p.modelId)));
 };
}
function applyTableFacts(features,facts,product){
 if(!facts)return features;
 // Latest official/spec-version facts win. Tables only supplement missing card fields.
 const blocked=/document-version-(?:conflict|not-supported)/.test(product.parameterStatus||'');
 const used=[];
 for(const [key,value]of Object.entries(facts.features))if(value&&!features[key]&&!(blocked&&['load','resolution','resolutionLabel'].includes(key))){features[key]=value;used.push(key);}
 if(used.length){features.sources=facts.sources;features.evidence={...features.evidence,tableFields:used};}
 if(facts.conflicts.length)features.notice=[features.notice,'产品表中存在不同记录：'+facts.conflicts.join('、')+'；未用冲突值补齐。'].filter(Boolean).join(' ');
 return features;
}
module.exports={tableRows,projectTableFacts,createProductTableFacts,applyTableFacts};
