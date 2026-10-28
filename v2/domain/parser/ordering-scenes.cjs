'use strict';
// Scene vocabulary and enum assignments mirror official Vt, not product choices.
// Parse independent clauses to bind source/output/cabinet quantities to entities.
function parseOrderingScenes(text){
 const fields={},requirements={},provenance={};
 const assign=(target,key,value,quote,path)=>{target[key]=value;provenance[path+'/'+key]={kind:'user-stated',text:quote};};
 const clauses=String(text).normalize('NFKC').split(/[，,；;。\n]/).map(x=>x.trim()).filter(Boolean);
 for(const clause of clauses){
  const negative=/(?:不要|不用|不需要|不使用|取消|不做)/;
  if(/拼接(?:处理)?器/.test(clause)&&!negative.test(clause))assign(requirements,'controllerFamily','splicer',clause,'/requirements');
  if(/\bT16\b/i.test(clause)){assign(requirements,'T16',!negative.test(clause),clause,'/requirements');if(!negative.test(clause))assign(requirements,'controllerFamily','splicer',clause,'/requirements');}
  if(/(?:播放盒.*级联|级联.*播放盒|HDMI.*级联|级联.*HDMI)/i.test(clause)&&!negative.test(clause)){
   const n=clause.match(/(\d+)\s*(?:台|个)/)||clause.match(/级联\s*(\d+)/);
   assign(requirements,'cascadeSplicing',{supportive:true,...(n?{count:Number(n[1])}:{})},clause,'/requirements');
   if(!requirements.controllerFamily)assign(requirements,'controllerFamily','playBox',clause,'/requirements');
  }
  if(/(?:信号源|源分辨率|输入源|输入分辨率)/.test(clause)&&!negative.test(clause)){
   const m=clause.match(/\b(2K|4K)(?:\s*[@＠]?\s*(30|60)\s*(?:Hz|帧)?)?/i);
   if(m&&(/2K/i.test(m[1])||m[2]))assign(requirements,'sourceResolution',[{id:/2K/i.test(m[1])?1:m[2]==='30'?2:3}],clause,'/requirements');
  }
  if(/输出/.test(clause)&&!negative.test(clause)){
   const ids=[];if(/网口|千兆/.test(clause))ids.push(1);if(/HDMI/i.test(clause)&&/板|子卡/.test(clause))ids.push(2);if(/DVI/i.test(clause)&&/板|子卡/.test(clause))ids.push(3);
   if(ids.length)assign(requirements,'outInput',ids.map(id=>({id})),clause,'/requirements');
  }
  if(/(?:前端|上游|应用场景|接在|接的)/.test(clause)&&!negative.test(clause)){
   const id=/多媒体服务器/.test(clause)?1:/拼接器|拼接处理器/.test(clause)?2:/分布式/.test(clause)?3:null;
   if(id)assign(requirements,'applicationScenarios',{id},clause,'/requirements');
  }
  const pair='(\\d+)\\s*(?:张|块|个)?\\s*[x×*]\\s*(\\d+)';
  let m=clause.match(new RegExp('(?:每(?:个)?箱(?:体)?(?:内)?(?:的)?(?:有|装|是|为)?(?:模组)?|箱内模组)\\s*'+pair));
  if(m){fields.cabinet||={};assign(fields.cabinet,'moduleColumns',Number(m[1]),clause,'/cabinet');assign(fields.cabinet,'moduleRows',Number(m[2]),clause,'/cabinet');}
  m=clause.match(new RegExp('(?:箱体(?:阵列|排列|布局)|整屏箱体|箱体排成)\\s*(?:是|为)?\\s*'+pair));
  if(m){fields.cabinet||={};assign(fields.cabinet,'columns',Number(m[1]),clause,'/cabinet');assign(fields.cabinet,'rows',Number(m[2]),clause,'/cabinet');}
 }
 if(Object.keys(requirements).length)fields.requirements=requirements;
 fields.provenance=provenance;return fields;
}
function orderingDeviceText(text,fields){
 return String(text).replace(/C16(?:L|H)?\s*(?:共享|内置接口共享)/gi,' ').replace(fields?.requirements?.T16===true?/\b(?:HD-)?T16\b/gi:/$^/g,' ');
}
module.exports={parseOrderingScenes,orderingDeviceText};
