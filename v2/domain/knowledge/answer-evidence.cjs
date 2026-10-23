'use strict';
// Rank already-authorized passages for answering, not merely for mentioning
// the product. Numbers and conditions remain literal source text.
const attributes={load:/带载|控制范围|load|control range/i,grayscale:/灰阶|灰度等级|灰度级|gray\s*(?:scale|level)/i,size:/尺寸|外形|dimension|size/i,ports:/接口|网口|HUB|HDMI|USB|port|interface/i,width:/宽度|高度|最大宽|最宽|width|height/i};
function rankAnswerEvidence(rows,{intent,attributes:requested=[],concepts=[],question=''}={}){
 const compact=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
 const rank=row=>{
  const text=String(row.text||''),lines=text.split(/\n|[。；;]/).map(s=>s.trim());let score=0;
  if(intent==='parameters'){
   for(const id of requested){const pattern=attributes[id];if(!pattern)continue;
    const hits=lines.filter(line=>pattern.test(line));score+=hits.length*5;
    score+=hits.filter(line=>/\d/.test(line)&&/[:：]|带载范围|最大带载|推荐带载|等级|接口|\t|\|/.test(line)).length*12;
   }
   if(/参数表|技术参数|规格参数|specification|technical parameters/i.test(text))score+=8;
   if(/注[:：]|实际.{0,12}(?:有关|取决|限制)|推荐带载|常规芯片|PWM|前提|条件/.test(text))score+=8;
   if(/^\s*(?:一[、.]\s*)?概述/.test(text))score-=8;
  }
  for(const term of concepts)if(compact(text).includes(compact(term)))score+=3;
  if(intent==='operation'){score+=Math.min(5,(text.match(/点击|选择|插入|导出|更新|完成|拔出/g)||[]).length)*3;}
  return score;
 };
 const sorted=rows.map((row,index)=>({row,index,score:rank(row)})).sort((a,b)=>b.score-a.score||a.index-b.index);
 const result=[],seen=new Set(),editionCounts=new Map();
 const compareVersions=/版本.{0,10}(?:不同|分别|差异)|不同版本|各版本/.test(question);
 for(const {row}of sorted){
  const content=compact(row.text);if(content&&seen.has(content))continue;
  const edition=String(row.name||'').replace(/[_\s-]|已签章|已签名|签章|signed/gi,'');
  // Duplicate signed copies should not crowd out a second edition or task.
  if(intent==='parameters'&&compareVersions&&(editionCounts.get(edition)||0)>=1)continue;
  if(content)seen.add(content);editionCounts.set(edition,(editionCounts.get(edition)||0)+1);result.push(row);
 }
 return result;
}
module.exports={rankAnswerEvidence};
