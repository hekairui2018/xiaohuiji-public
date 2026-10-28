'use strict';
const actionGroups=[['read','读取','回读','读回','查看'],['save','保存','另存为','导出'],['import','导入','加载'],['create','添加','新建','建立','创建'],['send','发送','下发'],['publish','发布','提交'],['set','设置','修改','调整'],['calibrate','校准','校正','校时']];
const verbs=actionGroups.flatMap(g=>g.slice(1)).sort((a,b)=>b.length-a.length);
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const norm=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
function operationTarget(plan={}){
 const text=norm(plan.focus||plan.original||plan.query||'');
 const hits=[...text.matchAll(new RegExp(verbs.map(escape).join('|'),'g'))],steps=[];let object='';
 for(const [i,hit]of hits.entries()){
  const group=actionGroups.find(g=>g.includes(hit[0]));
  const tail=text.slice(hit.index+hit[0].length,hits[i+1]?.index).replace(/[并且及和再然后，,。；;？?]+$/g,'');
  const literal=tail.replace(/^(?:当前|现有|对应|指定|一个|新的|新|设备的?|的)/,'').replace(/(?:并|后|再|然后)$/,'');
  if(literal&&literal.length<=24)object=literal;
  if(object)steps.push({action:group[0],aliases:group.slice(1),object});
 }
 return {steps};
}
function operationCoverage(text,target){
 const body=norm(text),clauses=body.split(/[。；;\n]/),steps=target.steps.map(step=>{
  const owner=/^(接收卡|发送卡|控制卡)(?:的)?(.+)$/.exec(step.object);
  const object=owner&&body.includes(owner[1])?owner[2]:step.object;
  const expression=new RegExp('(?:'+step.aliases.map(escape).join('|')+')[^。；;\\n]{0,24}'+escape(object),'g');
  const reverse=new RegExp(escape(object)+'[^。；;\\n]{0,16}(?:'+step.aliases.map(escape).join('|')+')','g');
  let supported=false,instructionLocated=false;
  for(const c of clauses){
   const namedOwners=c.match(/接收卡|发送卡|控制卡/g)||[];
   if(owner&&namedOwners.length&&!namedOwners.includes(owner[1]))continue;
   for(const hit of [...c.matchAll(expression),...c.matchAll(reverse)]){
    supported=true;
    if(/点击|单击|双击|右键|选择|勾选|按钮|菜单|图标|界面|对话框|插入|确定|确认/.test(c.slice(Math.max(0,hit.index-25),hit.index+hit[0].length+25)))instructionLocated=true;
   }
  }
  return {...step,supported,instructionLocated};
 });
 return {steps,primarySupported:steps.length?steps[0].supported:null,complete:steps.length>0&&steps.every(s=>s.instructionLocated)};
}
module.exports={operationTarget,operationCoverage};
