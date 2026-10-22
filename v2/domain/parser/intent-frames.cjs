'use strict';
// Phrase spans and their local relations, not an intent classifier or a second
// conversation state machine. Entity identities remain owned by the registry.
const vocabulary={
 // Fault noun aliases reviewed against indexed 鬼影拖影 cases, not intent labels
 // copied from the case container. They require an observed-event relation.
 phenomenon:['暗影','阴影','残影','重影','图像残留','历史文字','拖影','扫描线'],
 observation:['出现','存在','残留','发生','有'],
 // Failure complements describe an observed event/state, not a requested file.
 failure:['没亮灯','搜不到','找不到','没有输出','白屏','反色','信号丢失','错误码','不生效','不起效','没反应','失败','异常','不正常','无效','有问题','显示问题','黑块','偏暗','无信号','没声音','不显示','没有反应','无反应','无响应','不在线','不上线','不全屏','不完整','显示不全','点不到','点不了','添加不了','加载不出来','升不上去','无法识别','识别不了','发现不了','探测不到','无法使用','已失效','不匹配','不一致','不准确','不清晰','模糊','撕裂','黑边','毛毛虫','跳灰','过曝','失真','错位','镜像','偏红','暗红','缺红','亮点','黑线','显示之前播放的文字','太低','达到上限','被锁定','工程损坏','卡顿','不同步','停顿','闪点'],
 activity:['使用方法','使用教程','调试软件','用什么软件','用哪个软件','用那个软件','操作步骤','操作步奏','设置','注册','挂载','转移','搭建','关闭','清空','接线','安装','调试','更换','注意事项','外接','指定','判断'],
 edition:['通用类型','通用版本','通用版','专业版','精简版'],
 social:['谢了','谢谢啦','多谢了','谢谢你','感谢你'],
 handling:['排查','检查','自查','核查','检修'],
 request:['发我','给一份','请问','我想知道','想了解','想问','只问','只查','只要','我要','给我','帮我','麻烦','请','先查','先给','先看','先问','查','只看'],
 correction:['而是','其实是','改问','改成','现在问','这次问','本次反馈：'],
 negate:['不是','并非','不需要','不用','不要','无需','别'],
 document:['视频讲解','操作说明书','SDK','API文档','操作手册','操作视频','使用教程','调试说明书','使用说明','操作说明','安装程序','升级程序','说明书','说名书','说明数','规格书','手册','安装包','文档','教程','资料'],
 symptom:['搜不到','找不到','搜索不到','无信号','没信号','黑屏','花屏','打不开','闪退','失败','异常','不正常','不亮'],
 device:['设备','控制卡','接收卡','发送卡','热点','WiFi'],
 question:['有没有','有无','多少','多大','多宽','多高','几个','几路','几级','能否','能不能','可不可以','可以','支持','什么','如何','怎么','咋','哪些','有啥','是什么','吗','么'],
 engineering:['配单','配卡','配屏','选型','BOM'],
 attribute:['电池型号','电池','代载','参数','灰阶','灰度','带载','尺寸','分辨率','网口','接口','功能'],
 conjunction:['同时','还要','并且','另外','以及'],
};
// A feature head changes the noun phrase role: 阴影补偿 is a capability,
// not evidence that the customer is observing a shadow.
for(const noun of [...vocabulary.phenomenon,...vocabulary.failure])for(const head of ['消除','补偿','抑制','检测','消隐'])vocabulary.attribute.push(noun+head);
const trie=new Map();
for(const [type,words] of Object.entries(vocabulary))for(const word of words){let node=trie;for(const c of word.toLowerCase()){if(!node.has(c))node.set(c,new Map());node=node.get(c);}const tags=node.get('')||[];node.set('',[...tags,type]);}
function spans(text){
 const normalized=text.normalize('NFKC').toLowerCase(),out=[];
 // Full-width ASCII normalization preserves these customer span positions.
 for(let i=0;i<normalized.length;i++){let node=trie;for(let j=i;j<normalized.length&&node.has(normalized[j]);j++){node=node.get(normalized[j]);if(node.has(''))for(const type of node.get(''))out.push({type,text:text.slice(i,j+1),start:i,end:j+1});}}
 // Longest phrase wins over embedded shorter words: 排查 is not 查资料.
 out.sort((a,b)=>a.start-b.start||b.end-a.end);
 let far=-1,lastStart=-1;return out.filter(t=>{if(t.end<far||t.end===far&&t.start!==lastStart)return false;far=t.end;lastStart=t.start;return true;});
}
function frames(text){
 const result=[];let start=0;
 // Split punctuation and explicit discourse corrections, never model/version
 // punctuation or geometry dimensions. Keep original offsets for diagnostics.
 const boundary=/[，,。；;！？!?\n]+|(?:但是|不过|而是|其实是|改问|现在问|这次问|本次反馈：)/g;
 const add=end=>{const raw=text.slice(start,end),lead=raw.length-raw.trimStart().length,value=raw.trim();if(value){const offset=start+lead,tokens=spans(value).map(t=>({...t,start:t.start+offset,end:t.end+offset}));const head=value.replace(/^(?:我|我们)?\s*/,'');const denied=/^(?:不是|并非|不需要|不用|不要|无需|别)/.test(head)&&!/^不是.{0,8}(?:吗|么)/.test(head);const requested=tokens.some(t=>t.type==='request'&&!['请问','请','麻烦'].includes(t.text))||tokens.some(t=>t.type==='request')&&tokens.some(t=>['document','engineering','attribute','activity','symptom','failure'].includes(t.type));const reportedRequest=requested&&!/查看.{0,30}(?:已|显示|正常|解除)|(?:已经|已完成|检查过|查看过)/.test(value);const questioned=tokens.some(t=>t.type==='question');const ellipticAttribute=/(?:参数|灰阶|灰度|带载|尺寸|分辨率|网口|接口|功能)[?？\s]*$/.test(value)&&tokens.some(t=>t.type==='attribute')&&!tokens.some(t=>t.type==='symptom')&&!value.replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*/gi,'').replace(/这个|那个|它|的/g,'').replace(new RegExp(vocabulary.attribute.join('|'),'g'),'').trim();const corrected=/^(?:而是|其实是|改问|现在问|这次问|本次反馈：)/.test(text.slice(Math.max(0,offset-6),offset));result.push({text:value,start:offset,end:offset+value.length,tokens,role:denied?'negated':reportedRequest||questioned&&tokens.some(t=>['attribute','document','engineering'].includes(t.type))||ellipticAttribute?'request':'background',requested,questioned,corrected});}};
 let m;while((m=boundary.exec(text))){add(m.index);start=m.index+m[0].length;}add(text.length);
 return result;
}
function analyzeFrames(text){
 const clauses=frames(String(text));
 // UI messages can contain imperatives. They are reported speech, not a new
 // customer request to abandon troubleshooting and describe a software feature.
 for(const c of clauses)if(c.role==='request'&&/提示|弹窗|报错/.test(String(text).slice(0,c.start))&&/^请(?:前往|到|先)/.test(c.text)&&!/帮我|我想|我要|我只/.test(c.text))c.role='reported-ui-command';
 // Language/format restrictions qualify the document request; they do not
 // replace its object when written as a following '只要...' clause.
 for(const c of clauses)if(c.role==='request'&&/^(?:只要|只看|仅要|要求).{0,20}(?:中文|英文|PDF|DOCX|格式|版本)/i.test(c.text)&&!c.tokens.some(t=>['document','device','engineering'].includes(t.type)))c.role='constraint';
 for(const [i,c]of clauses.entries())if(i>0&&c.role==='request'&&/^(?:发我|给我|给一份)/.test(c.text)&&!c.tokens.some(t=>['document','device','attribute','engineering','activity'].includes(t.type))&&!/软件|APP|型号/.test(c.text))c.role='anaphoric-request';
 const active=clauses.filter(c=>c.role!=='negated');
 // Explicit requests take precedence over background reports. Multiple active
 // requests remain together so the existing multi-goal policy can ask priority.
 const requests=active.filter(c=>c.role==='request');
 const corrected=active.filter(c=>c.corrected);
 const selected=corrected.length?[corrected.at(-1)]:requests.length?requests:active;
 const changed=!String(text).includes('本次反馈：')&&selected.length>0&&(selected.length!==clauses.length||clauses.some(c=>c.role==='negated'));
 const focusText=changed?selected.map(c=>c.text).join('；'):String(text);
 const relations=clauses.flatMap(c=>{
  const targets=c.tokens.filter(t=>['document','device','attribute','engineering','phenomenon'].includes(t.type));
  return c.tokens.filter(t=>['symptom','request','question','observation'].includes(t.type)).map(t=>{
   const eligible=t.type==='observation'?targets.filter(x=>x.type==='phenomenon'):targets;
   const nearest=eligible.toSorted((a,b)=>Math.min(Math.abs(a.start-t.end),Math.abs(t.start-a.end))-Math.min(Math.abs(b.start-t.end),Math.abs(t.start-b.end)))[0];
   const negated=t.type==='observation'&&/(?:不|没|没有)$/.test(text.slice(c.start,t.start));
   return {predicate:t,target:nearest||null,clauseStart:c.start,role:negated?'negated':c.role};
  });
 });
 // Project selected spans onto the actual text supplied to the clause matcher.
 // Diagnostics retain the full original relations separately.
 const focusedRelations=[],focusedSpans=[];let offset=0;
 for(const c of changed?selected:clauses){
  const delta=changed?offset-c.start:0,move=t=>({...t,start:t.start+delta,end:t.end+delta});
  focusedSpans.push(...c.tokens.map(move));
  focusedRelations.push(...relations.filter(r=>r.clauseStart===c.start).map(r=>({...r,clauseStart:r.clauseStart+delta,predicate:move(r.predicate),target:r.target?move(r.target):null})));
  offset+=c.text.length+1;
 }
 let reported=focusedSpans.find(t=>t.type==='failure'&&!clauses.some(c=>c.role==='negated'&&t.start>=c.start&&t.end<=c.end));
 const complement=/(?:无法|不能|未能|没有|未|不(?:能|会|(?!(?:使用))))[\s]*(?:正常|自动|循环|太|够)?[\s]*(?:发送|搜索|搜|添加|加载|修改|更改|识别|响应|使用|显示|翻页|铺满|重启|连接|上线|操作|启动|播放|成为|进入|正常|打开|开启|接入|绑定|消除|生效|起效|寻机|更新)|(?:发送|搜索|添加|加载|修改|更改|识别|响应|使用|显示|翻页|铺满|重启|连接|上线|操作|启动|播放)(?:不了|不到)|没有(?:我|所|正在)?(?:播放|发送|编辑|设置)(?:的)?(?:内容|节目|视频|画面)|(?:突然变成|自动断开)|(?:error|locked)(?![a-z])/i.exec(focusText);
 const partial=/(?:只显示|只能显示).{0,6}(?:部分|一部分|左上角|一半)/.exec(focusText);
 const contrast=/但是|但|却/.test(focusText)&&/预览|正常|原来|之前/.test(focusText)&&/变成|不一样|不一致/.test(focusText);
 const quantities=/(\d+)台[^，。；]{0,20}只能[^，。；]{0,6}?(\d+)台/.exec(focusText);
 const alternating=/一会(?:儿)?[^，。；]{0,8}一会(?:儿)?/.exec(focusText);
 const reportedStatus=/(?:提示|显示|报错)[^，。；]{0,8}(?:已到期|过期|欠费|未授权|未激活|已锁定|权限不足)/.exec(focusText);
 const signal=complement||reportedStatus||partial||alternating||(contrast?[focusText]:null)||(quantities&&Number(quantities[1])>Number(quantities[2])?[quantities[0]]:null);
 if(!reported&&signal)reported={type:'failure-complement',text:signal[0],start:Math.max(0,focusText.indexOf(signal[0])),end:Math.max(0,focusText.indexOf(signal[0]))+signal[0].length};
 const activity=focusedSpans.find(t=>t.type==='activity');
 const operationSignal=activity&&!/什么是|是什么意思|是什么|有没有|有无|有什么|支持|能否|多少|几级/.test(focusText)&&!/之后|完成|已经|调试完|设置完|设置了|播放时|重启后/.test(focusText)?activity:null;
 // Resolve the requested action against its object. A UI location is not a
 // capability inquiry; exporting existing device content is not finding a
 // tutorial in the resource catalogue. Keep the matched words for diagnostics.
 const proceduralPatterns=[
  ['task-action',/(?:控制|切换|暂停|恢复|开始|停止)[^，。；]{0,8}(?:视频|影片|节目|播放)/],
  ['configuration-transition',/(?:新|旧|原)[^，。；]{0,8}流程[^，。；]{0,8}(?:改|切换|恢复)[^，。；]{0,8}流程/],
  ['task-method',/(?:什么|哪种|哪个|甚麼|什麼).{0,6}方法.{0,12}(?:控制|播放|发送|读取|调试|连接)|(?:升级|安装|设置|更换)(?:完|完成|后|了)[^，。；]{0,8}(?:需要|要不要|是否要)[^，。；]{0,6}(?:重启|复位)/],
  ['procedure-request',/(?:有|有没有|有无|给我|查看|找)[^，。；]{0,10}(?:操作步骤|操作步奏|使用方法)/],
  ['recovery-request',/(?:忘记|忘了|找回|重置)[^，。；]{0,12}(?:密码|口令)/],
  ['operating-precautions',/(?:方式|接线|串线|连接|调试|使用|操作|升级)[^，。；]{0,16}(?:注意事项|(?:有|需|要|什么|哪些|需要|要注意|应注意){0,8}注意)/],
  ['ui-navigation',/(?:功能|按钮|菜单|设置|选项|入口)[^，。；]{0,8}(?:在哪里|在哪儿|在哪|哪里打开|哪里设置)/],
  ['device-content-export',/(?:从[^，。；]{0,12}(?:盒子|设备|控制卡|播放器)(?:里|中|内)?[^，。；]{0,14}(?:导出|下载|拷出|复制出来)|(?:视频|节目|文件)[^，。；]{0,12}从[^，。；]{0,10}(?:盒子|设备|控制卡|播放器)[^，。；]{0,8}(?:导出|下载|拷出|复制出来))/],
  ['connection-choice',/(?:通过|用|接|插)[^，。；]{0,6}(?:哪一|哪个|哪根|哪条)[^，。；]{0,10}(?:网线|网口|接口)[^，。；]{0,12}(?:连接|接到|插到)/],
 ];
 const procedural=proceduralPatterns.map(([role,re])=>({role,match:re.exec(focusText)})).find(r=>r.match&&(r.role!=='task-action'||!/支持|能否|可以|有没有|是否/.test(focusText))&&(!focusedSpans.some(t=>t.type==='document')||r.role==='device-content-export'));
 const requestOperation=procedural?{type:'operation-request',role:procedural.role,text:procedural.match[0],start:procedural.match.index,end:procedural.match.index+procedural.match[0].length}:null;
 // A bare tutorial/manual names a resource even when its title contains a
 // verb. An explicit how-to question can still request the operation itself.
 const resourceNoun=focusedSpans.some(t=>t.type==='document')&&!/(?:怎么|如何|怎样|咋|教我)/.test(focusText);
 return {clauses,relations,focusedRelations,focusedSpans,focusText,changed,reportSignal:reported||null,operationSignal:requestOperation||(resourceNoun?null:operationSignal),requestOperation};
}
module.exports={analyzeFrames,phenomenonWords:Object.freeze([...vocabulary.phenomenon])};
