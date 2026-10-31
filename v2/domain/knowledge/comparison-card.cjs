'use strict';
const {modelId}=require('../identity/model-id.cjs');
const column=cell=>/^([A-Z]+)\d+$/.exec(cell)?.[1];
const columnNumber=col=>[...col].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const supportedSheets=new Set(['发送卡','接收卡','全彩异步','视频处理器','服务器']);
function parseComparison(blocks,source){
 const sheets=new Map(),models=new Map();
 for(const block of blocks){const l=block.locator||{};if(!supportedSheets.has(l.sheet)||!Number.isInteger(l.row)||!Array.isArray(l.cells))continue;if(!sheets.has(l.sheet))sheets.set(l.sheet,[]);sheets.get(l.sheet).push(block);}
 for(const [sheet,items] of sheets){
  items.sort((a,b)=>a.locator.row-b.locator.row);
  const header=items.find(b=>b.locator.cells.some(c=>String(c.value).trim()==='灰度型号'));if(!header)continue;
  const columns=header.locator.cells.map(c=>({col:column(c.cell),value:String(c.value).trim()})).filter(c=>c.col).sort((a,b)=>columnNumber(a.col)-columnNumber(b.col));
  const sections=[];let section=null;
  for(const c of columns){if(c.value==='灰度型号'){section={labelCol:c.col,models:[]};sections.push(section);continue;}if(!section)continue;const id=modelId(c.value);if(id)section.models.push({col:c.col,id});}
  for(const b of items){const l=b.locator;if(l.row<=header.locator.row)continue;
   // Only the introductory Huidu comparison grid. Later sections compare competitors.
   if(l.cells.some(c=>/^(?:产品型号|卡莱特型号|诺瓦型号|凯视达型号|摩西尔型号)$/.test(String(c.value).trim())))break;
   const cells=new Map(l.cells.map(c=>[column(c.cell),{value:String(c.value??'').trim(),cell:c.cell}]));
   for(const section of sections){const label=cells.get(section.labelCol)?.value;if(!label||/^(?:产品图片|灰度型号)$/.test(label))continue;
    for(const m of section.models){const entry=cells.get(m.col);if(!entry||!entry.value)continue;
     if(!models.has(m.id))models.set(m.id,[]);models.get(m.id).push({label,value:entry.value,sheet,row:l.row,cell:entry.cell,labelCell:cells.get(section.labelCol).cell});
    }
   }
  }
 }
 return new Map([...models].map(([id,fields])=>{
  const grouped=new Map();for(const field of fields){if(!grouped.has(field.label))grouped.set(field.label,[]);grouped.get(field.label).push(field);}
  const usable=[],conflicts=[];for(const [label,values] of grouped){const unique=[...new Set(values.map(v=>v.value))];if(unique.length===1)usable.push(values[0]);else conflicts.push(label);}
  return [id,{fields:usable,conflicts,source:{name:source.name,sha256:source.sha256,url:'/v2/offline/preview?id='+source.locationId}}];
 }));
}
function createComparisonCards({localCatalog,request}){
 let catalog=null,pending=null;
 return async products=>{
  const resources=await localCatalog();if(catalog!==resources||!pending){catalog=resources;pending=(async()=>{
   const candidates=resources.filter(r=>r.availabilityState==='present'&&r.name==='产品对比表V1.0.xlsx'&&/^[a-f0-9]{64}$/i.test(r.sha256||''));
   const hashes=new Set(candidates.map(r=>r.sha256));if(hashes.size!==1)throw Error('comparison-source-unavailable-or-conflicting');const source=candidates[0],blocks=[];let offset=0;
   for(let page=0;page<40;page++){const body=await request('/preview-document?id='+source.locationId+'&offset='+offset);if(body.sha256!==source.sha256)throw Error('comparison-source-changed');blocks.push(...body.blocks||[]);if(body.nextOffset==null)return parseComparison(blocks,source);offset=body.nextOffset;}
   throw Error('comparison-table-incomplete');
  })().catch(()=>{pending=null;const failed=new Map();failed.unavailable=true;return failed;});}
  const map=await pending;return products.map(p=>map.unavailable?{unavailable:true}:map.get(p.modelId)||null);
 };
}
module.exports={parseComparison,createComparisonCards};
