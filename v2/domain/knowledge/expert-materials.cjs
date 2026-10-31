'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const {comparisonValue,comparisonValueInstructions}=require('./comparison-value.cjs');
const norm=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s+/g,'');
// Formatting differences are not conflicting specifications. Preserve unit case
// (mW and MW differ) and all original values/cells for review.
const valueKey=s=>String(s??'').normalize('NFKC').replace(/(\d)(?:\s*@\s*|\s+)(\d+(?:\.\d+)?Hz)/g,'$1@$2').replace(/\s+/g,'').replace(/(\d)[xX×*](?=\d)/g,'$1×');
function createExpertMaterials(file){
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 function compare(models){
  const columns=models.map(model=>({model:typeof model==='string'?model:model.model,brand:typeof model==='string'?null:model.brand,fields:new Map()}));
  for(const column of columns)for(const row of data.records){
   if(row.kind!=='comparison'||norm(row.model)!==norm(column.model)||column.brand&&row.brand!==column.brand)continue;
   const key=row.parameter.normalize('NFKC').trim();
   if(!column.fields.has(key))column.fields.set(key,[]);column.fields.get(key).push(row);
  }
  const keys=[...new Set(columns.flatMap(c=>[...c.fields.keys()]))];
  return keys.map(parameter=>{const values=columns.map(c=>{const refs=c.fields.get(parameter)||[],unique=[...new Map(refs.map(r=>[valueKey(r.value),r.value])).values()],brands=new Set(refs.map(r=>r.brand).filter(b=>b&&b!=='未明确')),ambiguous=brands.size>1;const value=ambiguous?'型号跨品牌，需明确品牌':unique.length===1?unique[0]:unique.length?'来源存在不同记录':'资料未记录',conflict=unique.length>1||ambiguous;return {model:c.model,brand:c.brand,value,conflict,meaning:comparisonValue(value,{recorded:refs.length>0,conflict}),sources:refs};});return {parameter,values,different:new Set(values.map(v=>valueKey(v.value))).size>1};});
 }
 const tenderNames=data.records.filter(r=>r.kind==='tender').flatMap(r=>(r.heading||[]).flatMap(h=>h.match(/(?:HD[-_]?)?[A-Z][A-Z0-9+_-]*\d[A-Z0-9+_-]*(?:\s+(?:Pro|Plus))?|HDPlayer|HDSet|HDShow|HDSign|HD2020|HD2018/gi)||[]));
 const identities=[...new Map([...data.records.filter(r=>r.kind==='comparison').map(r=>r.model),...tenderNames].map(m=>[norm(m),m])).values()].sort((a,b)=>b.length-a.length);
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 function evidence(query,{models=[],targetedOnly=false}={}){
  const compact=String(query).normalize('NFKC').toUpperCase().replace(/\s+/g,'');
  const mentions=[];
  for(const m of identities)for(const match of compact.matchAll(new RegExp('(?<![A-Z0-9])(?:HD[-_]?)?'+escape(norm(m))+'(?![A-Z0-9+_-])','g'))){
   const prefix=compact.slice(Math.max(0,match.index-10),match.index),brand=['灰度','诺瓦','卡莱特','凯视达','摩西尔'].find(b=>prefix.endsWith(b));
   mentions.push({model:m,brand,index:match.index});
  }
  mentions.sort((a,b)=>a.index-b.index);
  const specs=[...new Map(mentions.map(m=>[(m.brand||'')+'|'+norm(m.model),{model:m.model,brand:m.brand}])).values()].slice(0,4);
  if(!specs.length)for(const id of models){const model=identities.find(m=>norm(m)===norm(id));if(model)specs.push({model});}
  const selected=specs.map(s=>s.model);
  const tender=/控标|投标|招标/.test(query);
  if(tender){
   const rows=data.records.filter(r=>r.kind==='tender'&&selected.some(m=>{
    const identity=new RegExp('(?<![A-Z0-9])(?:HD[-_]?)?'+escape(norm(m))+'(?![A-Z0-9+_-])');
    if(!identity.test(norm((r.heading||[]).join(' '))))return false;
    // A trailing multi-product inspection table is not owned by the last
    // narrative heading. Its row must explicitly identify this product.
    return r.tableRow===undefined||identity.test(norm(r.text));
   }));
   const batches=[];for(const r of rows){let batch=batches.at(-1);if(!batch||batch.source!==r.source||batch.heading.join('/')!==r.heading.join('/')||batch.text.length+r.text.length>4500){batch={source:r.source,heading:r.heading,text:'章节：'+r.heading.join(' / '),ids:[],start:r.bodyIndex+1,end:r.bodyIndex+1};batches.push(batch);}batch.text+='\n'+r.text;batch.ids.push(r.id);batch.end=r.bodyIndex+1;}
   return batches.slice(0,6).map(b=>({evidenceId:'tender-'+crypto.createHash('sha256').update(b.ids.join('|')).digest('hex').slice(0,24),name:b.source,text:b.text,modelIds:selected.map(m=>'HD-'+norm(m)),locator:{section:b.heading.join(' / '),paragraph:b.start,sectionEnd:b.end},sourceKind:'structured-tender-original',verificationStatus:'extracted-original-not-product-certification',readPerformed:true,readAvailable:false,contextComplete:batches.length<=6}));
  }
  if(!selected.length){
   if(targetedOnly)return [];
   // Reverse lookup from a written numeric interface requirement. Return
   // matching source cells, not inferred product capabilities or a BOM.
   const quantity=/(?<!\d)(\d+)\s*(?:个|路)?\s*(千兆网口|以太网口|网口|HDMI|DVI|SDI|USB|DP)(?![a-z])/i.exec(query);
   if(!quantity)return [];
   const unit=/网口/.test(quantity[2])?'网口':quantity[2].toUpperCase();
   const pattern=new RegExp('(?<![\\d.])'+quantity[1]+'\\s*(?:个|路)?\\s*(?:'+(unit==='网口'?'(?:千兆|以太网)?网口':unit)+')(?![a-z])','i');
   const rows=data.records.filter(r=>r.kind==='comparison'&&pattern.test(String(r.value))&&(!/灰度/.test(query)||r.brand==='灰度'));
   if(!rows.length)return [];
   const text=rows.map(r=>({model:r.model,brand:r.brand,parameter:r.parameter,value:r.value,source:r.source,sheet:r.sheet,cell:r.cell}));
   return [{evidenceId:'product-discovery-'+crypto.createHash('sha256').update(JSON.stringify(text)).digest('hex').slice(0,24),name:'产品原表：按参数反查',text:JSON.stringify({matches:text,instruction:'这些是原表中明确包含所查数量和接口的单元格，可据此寻找对应型号文件。不是全网穷尽结果，不把同名竞品当本公司产品。'}),modelIds:[...new Set(rows.filter(r=>r.brand==='灰度').map(r=>'HD-'+norm(r.model)))],sourceKind:'structured-product-discovery',readPerformed:true,readAvailable:false,contextComplete:true}];
  }
  let rows=compare(specs);
  const labelKey=s=>String(s).normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
  const queryKey=labelKey(query),matches=[];
  for(const row of rows){const label=labelKey(row.parameter);if(label.length<2)continue;let at=-1;while((at=queryKey.indexOf(label,at+1))>=0)matches.push({row,start:at,end:at+label.length});}
  const exact=[...new Set(matches.filter(m=>!matches.some(other=>other.row!==m.row&&other.start<=m.start&&other.end>=m.end&&other.end-other.start>m.end-m.start)).map(m=>m.row))];
  const attributes=require('./quick-query.cjs').concepts.filter(c=>c.type==='attribute'&&!['function','size'].includes(c.id)&&require('./quick-query.cjs').matchesConcept(c.id,query));
  const relevant=exact.length?exact:rows.filter(row=>attributes.some(c=>require('./quick-query.cjs').matchesConcept(c.id,row.parameter)));
  const axesRequested=/宽度|高度|宽高|长宽|(?:最|最大)宽|\bwidth\b|\bheight\b|\bhorizontal\b|\bvertical\b/i.test(query);
  const axesRecorded=rows.some(row=>/宽度|高度|宽高|长宽|\bwidth\b|\bheight\b|\bhorizontal\b|\bvertical\b/i.test(row.parameter));
  // A capacity pair is not a pair of independently established axis limits.
  // Let the original-document search fill fields that this table does not own.
  if(targetedOnly&&axesRequested&&!axesRecorded)return [];
  const comparison=/对比|比较|差异|区别|不同|差在哪/.test(query),overview=/参数概览|主要参数|全部参数|有哪些参数|产品介绍|是什么设备|^\s*(?:HD[- ]?)?[A-Z]+\d[A-Z0-9_+-]*\s*(?:的)?参数[？?。\s]*$/i.test(query);
  if(targetedOnly&&!comparison&&!overview&&!relevant.length)return [];
  if(selected.length===1&&relevant.length)rows=relevant;
  if(selected.length>1)rows=rows.sort((a,b)=>Number(b.different)-Number(a.different));
  if(!rows.length)return [];
  const body={models:specs,rows:rows.map(r=>({parameter:r.parameter,different:r.different,values:r.values.map(v=>({model:v.model,value:v.value,conflict:v.conflict,meaning:v.meaning,source:v.sources.slice(0,1).map(s=>({name:s.source,sheet:s.sheet,cell:s.cell}))}))})),instruction:(selected.length>1?'按参数项生成两列型号对照，先说明主要差异。缺失、冲突必须如实标明；不把单位W自动改为瓦，保留原值或核对上下文。':'按所问参数回答；概览时列主要参数。缺失或冲突如实标明。')+comparisonValueInstructions};
  return [{evidenceId:'comparison-'+crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0,24),name:'产品及竞品对比表：原单元格对齐',text:JSON.stringify(body),modelIds:selected.map(m=>'HD-'+norm(m)),sourceKind:'structured-comparison-original',verificationStatus:'source-cell-values-not-compatibility',readPerformed:true,readAvailable:false,contextComplete:true}];
 }
 return {compare,evidence,counts:{records:data.records.length,sources:data.sources.length},data};
}
module.exports={createExpertMaterials};
