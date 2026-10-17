'use strict';
// Display ordering only; this never establishes that one edition replaces another.
function documentDate(resource){
 const found=[];
 const lines=(resource.documentIntro||'').split(/\r?\n/);let revisionRows=0;
 for(let index=0;index<lines.length;index++){
  const line=lines[index];
  if(/更新历史|修订记录|版本记录|发布时间|revision\s*history/i.test(line))revisionRows=20;
  const labelled=/发布日期|发布时间|发行日期|出版日期|修订日期|更新日期|版本日期|编制日期|修订记录|版本记录|release\s*date|revision\s*date|publication\s*date|date\s*of\s*(?:issue|revision)/i.test(line);
  const row=revisionRows-->0&&/^\s*V?\d+(?:\.\d+)+\s+20\d{2}/i.test(line);
  const cover=index<24&&/^\s*(?:V\d+(?:\.\d+)+\s+)?20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\s*$/i.test(line);
  if(!labelled&&!row&&!cover)continue;
  for(const m of line.matchAll(/\b(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?/g)){
   const date=[m[1],m[2].padStart(2,'0'),m[3].padStart(2,'0')].join('-'),parsed=new Date(date+'T00:00:00Z');
   if(!Number.isNaN(+parsed)&&parsed.toISOString().slice(0,10)===date)found.push({date,evidence:line.trim().slice(0,320)});
  }
 }
 found.sort((a,b)=>b.date.localeCompare(a.date));
 return {documentDate:found[0]?.date||null,dateBasis:found.length?'cached-original-labelled-date':'original-date-not-established',dateEvidence:found[0]?.evidence||null};
}
const newestFirst=(a,b)=>String(b.documentDate||'').localeCompare(String(a.documentDate||''));
const newestIn=items=>items.reduce((value,item)=>item.documentDate&&item.documentDate>value?item.documentDate:value,'');
module.exports={documentDate,newestFirst,newestIn};
