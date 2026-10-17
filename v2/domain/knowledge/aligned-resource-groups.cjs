'use strict';
const {browseGroup}=require('./source-classification.cjs');
const {specificationGroups}=require('./specification-groups.cjs');
const key=label=>browseGroup(label).key;
const definitions=[browseGroup('K系列-接收卡'),{key:'player',label:'全彩播放盒（A、H系列）'},browseGroup('B系列-广告机专用'),{key:'cd-control',label:'C、D系列-全彩控制卡'},browseGroup('VP系列-处理器'),browseGroup('T系列-同步发送'),browseGroup('MS系列-服务器'),browseGroup('分布式、中控'),browseGroup('矩阵、音频处理器、分配器、切换器、延长器等信号传输设备'),browseGroup('单双色产品'),browseGroup('配件'),{key:'lcd',label:'LCD'},{key:'other',label:'其他'}];
const normalize=value=>String(value||'').replace(/^HD[-_ ]?/i,'').replace(/\s+/g,'').toUpperCase();
function referenceCategories(products){
 const source=[];
 for(const p of products)for(const d of p.documents||[])if(d.kind==='spec'&&d.sourceGroup)source.push({...d.sourceGroup,products:[{model:p.displayName||p.model||p.modelId,items:[]}]});
 const candidates=new Map();
 for(const g of specificationGroups(source))for(const p of g.products){const id=normalize(p.model);if(!candidates.has(id))candidates.set(id,new Set());candidates.get(id).add(g.key);}
 return new Map([...candidates].filter(([,keys])=>keys.size===1).map(([id,keys])=>[id,[...keys][0]]));
}
function fallback(model,group){
 const m=normalize(model);
 if(/^(?:RB|RP|R)\d|^K(?:08|12)$/.test(m))return 'receiver';
 if(/^VP8000M$/.test(m))return key('矩阵、音频处理器、分配器、切换器、延长器等信号传输设备');
 if(/^(?:VP|KV)\d/.test(m))return 'processor';
 if(/^B\d/.test(m))return key('B系列-广告机专用');
 if(/^A\d|^H(?:4K|6|8|16|20)$/.test(m))return 'player';
 if(/^T(?:08|16|90)/.test(m))return key('T系列-同步发送');
 if(/^MS\d/.test(m))return key('MS系列-服务器');
 if(/^(?:DCS|CT)\d/.test(m))return key('分布式、中控');
 if(/^WF\d/.test(m))return 'mono';
 if(/^[CD]\d/.test(m)&&group.label==='全彩')return 'cd-control';
 if(/AI数字人/.test(group.label))return 'lcd';
 return definitions.some(d=>d.key===group.key)?group.key:'other';
}
function alignedResourceGroups(groups,products){
 const references=referenceCategories(products),buckets=new Map();
 for(const g of groups)for(const p of g.products||[]){
  const category=references.get(normalize(p.model))||fallback(p.model,g),target=definitions.find(d=>d.key===category)||definitions.at(-1);
  if(!buckets.has(target.key))buckets.set(target.key,{...target,products:[]});
  buckets.get(target.key).products.push(p);
 }
 const merged=specificationGroups([...buckets.values()]);
 return merged.sort((a,b)=>definitions.findIndex(d=>d.key===a.key)-definitions.findIndex(d=>d.key===b.key));
}
module.exports={alignedResourceGroups};
