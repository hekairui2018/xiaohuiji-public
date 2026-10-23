'use strict';
// Requirements belong to the customer's question. A term occurring somewhere
// in a document is not proof that the passage answers the requested relation.
const tasks=[
 {id:'credentials',ask:/密码|口令|password/i,terms:['密码'],actions:/密码|口令|password/i},
 {id:'reset',ask:/恢复出厂|重置|复位/,terms:['恢复出厂','重置'],actions:/恢复出厂|重置|复位/},
 {id:'export',ask:/导出|备份/,terms:['导出','保存文件'],words:['导出','参数备份','配置备份','保存到文件','保存参数','保存配置','另存为'],actions:/导出|参数备份|配置备份|保存.{0,8}(?:参数|配置|文件)|另存为/},
 {id:'read',ask:/读取|回读|查询.{0,6}参数|参数.{0,8}查询/,terms:['读取','回读'],words:['读取','回读','读回','查看','查询','接收卡参数'],actions:/读取|回读|读回|查看|查询|接收卡参数/},
 {id:'construction',ask:/模组构造|构造模组|箱体构造|构造箱体/,terms:['构造'],words:['模组构造','构造模组','箱体构造','构造箱体'],actions:/模组构造|构造模组|箱体构造|构造箱体/},
 {id:'windows',ask:/双画面|多画面|开窗|窗口/,terms:['双画面','窗口设置'],words:['双画面','多画面','两画面','双窗口','窗口设置','画面设置','开窗'],actions:/双画面|多画面|两画面|窗口|画面分割|开窗/},
 {id:'brightness',ask:/调节.{0,4}亮度|亮度.{0,4}调节/,terms:['亮度'],actions:/亮度/},
 {id:'login',ask:/登录|登陆/,terms:['登录'],words:['登录','登陆','网址'],actions:/登录|登陆|网址/},
 {id:'subaccount',ask:/子(?:账[号户]|帐[号户]|用户)|(?:新增|创建|新建|添加).{0,6}(?:用户|账户|账号)/,terms:['子用户','新建账户'],groups:[['子账号','子帐号','子账户','子用户','账户'],['新建','创建','添加']],words:['子账号','子帐号','子账户','新增用户','创建用户','用户管理','子用户','新建账户','账户管理'],actions:/子账号|子帐号|子账户|新增用户|创建用户|用户管理|子用户|新建账户|账户管理/},
 {id:'locking',ask:/上锁|加锁|锁屏|解锁|授权|权限/,terms:['锁','授权'],actions:/上锁|加锁|锁屏|解锁|授权|权限|锁定/}
];
const platforms=[{id:'ios',pattern:/iOS|苹果/i},{id:'android',pattern:/Android|安卓/i},{id:'kylin',pattern:/麒麟|kylin/i},{id:'linux',pattern:/Linux|Ubuntu/i},{id:'windows',pattern:/Windows|win(?:7|10|11)/i},{id:'harmony',pattern:/鸿蒙|Harmony/i}];
function requirements(q){
 const text=q.answerQuestion||q.interpretation?.query||q.original||'', selected=tasks.filter(t=>t.ask.test(text));
 const softwareSelection=q.operation?.selectSoftware||/软件|APP/i.test(text)&&(/手机|电脑|调试|配套|用(?:什么|哪个|哪款)|叫什么|的软件|软件名/.test(text)||/软件\s*$/.test(text))&&!/说明书|手册|视频|教程|下载|安装包|怎么使用|如何使用/.test(text);
 const objectClass=/接收卡/.test(text)?'receiver':/单色|单双色/.test(text)?'monochrome':/异步盒|播放盒|多媒体盒/.test(text)?'player':null;
 const interfaces=[...new Set(text.match(/HDMI|HUB75E?|RJ45|Type-C|RS485|RS232|DVI|SDI|USB/gi)||[])];
 return {tasks:selected.map(t=>t.id),groups:selected.flatMap(t=>t.groups||[t.words||t.terms]),terms:[...new Set(selected.flatMap(t=>t.terms))],interfaces,objectClass,softwareSelection,phone:/手机|APP/i.test(text),platforms:platforms.filter(p=>p.pattern.test(text)).map(p=>p.id),batteryModel:/电池.{0,8}(?:型号|哪种|什么)/.test(text),fault:q.intent==='aftersales'};
}
function clarificationPlan(q){
 const text=q.answerQuestion||q.interpretation?.query||q.original||'';
 const hasIdentity=q.models?.length||q.software?.length,unknown=q.unknownModels?.length;
 if(q.concepts?.includes('password')&&!unknown&&(!hasIdentity||/wi[\s-]?fi|无线|热点/i.test(text)&&!q.models?.length)){
  const wifi=/wi[\s-]?fi|无线|热点/i.test(text);
  return {reason:'credential-object-needed',question:wifi?'这是哪款设备的Wi-Fi密码？请提供设备型号。':'你忘记的是哪款设备的Wi-Fi密码，还是哪个软件/平台的账号密码？',scope:'密码属于的设备或软件还不明确。只追问真正缺少的对象；客户已说Wi-Fi就不再问是否Wi-Fi。不提供其他设备默认密码，不举型号或软件版本示例。'};
 }
 if(q.evidencePlan?.purpose==='service-access'&&!hasIdentity)return {reason:'service-object-needed',question:'哪个软件、平台或设备显示了到期或授权提示？请说明提示出现的页面。',scope:'到期或授权提示的来源尚不明确。只确认提示来自哪个软件或设备页面，不套用其他设备的工程锁、服务或保修解释。'};
 if(q.unknownModels?.length&&!hasIdentity)return {reason:'entity-not-registered',question:'已保留你提供的 '+q.unknownModels.join('、')+'，当前尚未确认型号及其对应的资料身份。请核对设备完整型号和后缀，或说明这是哪个设备上的编号。',scope:'型号身份尚未确认。不能搜索其他产品后反问客户是否是该产品，不把编号当作已确认型号，不凭记忆给参数或固件。'};
 if(q.intent==='parameters'&&!hasIdentity&&!q.chips?.length&&!unknown)return {reason:'parameter-object-needed',question:q.decision?.objects?.some(o=>o.type==='module')?'请提供单块模组已知的点间距、尺寸或分辨率，我会先检查能否推算。':'你要查询哪款设备的这项参数？请提供完整型号，已有查询内容会保留。',scope:'当前仅缺查询对象。保留客户所问参数，只问设备完整型号，不提供其他产品参数或反问已知内容。'};
 if((q.intent==='product'||q.intent==='technical')&&q.models?.length&&String(text).replace(/[\s_-]/g,'').toUpperCase().replace(/^HD/,'')===q.models[0].replace(/[\s_-]/g,'').toUpperCase().replace(/^HD/,''))return {reason:'product-purpose-needed',question:'已保留 '+q.models[0]+'。你想查参数、找资料、看操作步骤，还是排查故障？',scope:'客户只提供了型号，没有提供问题。只询问查询方向，不枚举无关参数。'};
 if(q.intent==='clarify'&&!hasIdentity&&/未准备就绪|未就绪|未连接|离线/.test(text))return {reason:'status-object-needed',question:'这个状态出现在哪款软件或设备的哪个页面？出现前正在进行什么操作？',scope:'客户已提供状态文字，但没有提供显示状态的软件或设备。只补问位置和操作，不解释为某个产品的确定故障。'};
 return null;
}
function meetsRequirements(row,q){
 const required=requirements(q);
 if(q.intent==='resources'){
  const wanted=q.resourceConstraints?.language||(/英文/.test(q.original||'')?'en':null);
  const name=String(row.name||'');
  if(wanted==='en'&&!/English|英文|Specification|Datasheet|User[ _-]?(?:Manual|Guide)|[_. -]EN[_. -]/i.test(name))return {accepted:false,reason:'requested-language-not-established'};
  const cats=q.categories||(/规格书/.test(q.original||'')?['spec']:/说明书|手册|操作说明/.test(q.original||'')?['manual']:[]);
  const cat=row.category||(/规格书|specification|datasheet/i.test(name)?'spec':/说明书|手册|操作说明|使用说明|manual/i.test(name)?'manual':/固件|\.bin$/i.test(name)?'firmware':/\.(?:mp4|webm)$/i.test(name)?'video':null);
  if(cats.length&&cat&&!cats.includes(cat))return {accepted:false,reason:'requested-resource-kind-not-established'};
 }
 if(q.intent==='resources'&&!q.models?.length&&!q.software?.length&&(row.kind==='file'||row.type==='document')){
  if(required.objectClass==='monochrome'&&!/单色|单双色|monochrome|single.dual/i.test(row.name||''))return {accepted:false,reason:'resource-device-class-not-established'};
  if(required.phone&&!/手机|APP|屏掌控|小灰云/i.test(row.name||''))return {accepted:false,reason:'resource-phone-purpose-not-established'};
 }
 if(!row.text||row.kind==='file'||row.type==='document')return {accepted:true};
 const text=String(row.text),r=requirements(q),compact=text.replace(/\s+/g,'');
 if(q.intent==='parameters'&&r.tasks.length&&!r.interfaces.length&&!r.tasks.every(id=>tasks.find(t=>t.id===id).actions.test(text)))return {accepted:false,reason:'requested-capability-absent'};
 const otherRequestedField=(q.attributes||[]).some(id=>id==='load'?/带载|控制范围|load|control.?range/i.test(text):id==='grayscale'?/灰阶|灰度等级|gray.?scale/i.test(text):id==='size'?/尺寸|dimensions?/i.test(text):false);
 if(q.intent==='parameters'&&r.interfaces.length&&!otherRequestedField&&!r.interfaces.some(id=>compact.toLowerCase().includes(id.toLowerCase()))&&!(/网口|RJ45/i.test(q.original||'')&&/网口|RJ45/i.test(text))&&!r.tasks.some(id=>tasks.find(t=>t.id===id).actions.test(text)))return {accepted:false,reason:'requested-interface-or-capability-absent'};
 if(r.platforms.length){
  const mentioned=platforms.filter(p=>p.pattern.test(text+' '+row.name)).map(p=>p.id);
  if(mentioned.length&&!r.platforms.some(p=>mentioned.includes(p)))return {accepted:false,reason:'different-operating-platform'};
  if(!r.fault&&/系统|支持|适配|版本|有吗|安装|下载/.test(q.original||'')&&!r.platforms.some(p=>mentioned.includes(p)))return {accepted:false,reason:'requested-platform-not-established'};
 }
 const loadQuestion=q.attributes?.includes('load')||/(?:控制|带载|带|拖|驱动).{0,8}(?:多少|几).{0,3}(?:点|像素|模组|板)/.test(q.original||'');
 if(loadQuestion&&!/单(?:个)?(?:网口|接口)|每(?:个)?(?:网口|接口)|空车牌|辅助接口|HUB|HDMI|输出口/i.test(q.original||'')&&/(?:空车牌|单(?:个)?网口|每(?:个)?网口|每口|接口[:：]).{0,100}(?:带载|控制范围)|(?:带载|控制范围).{0,25}(?:每口|per port)/is.test(text))return {accepted:false,reason:'component-load-is-not-device-load'};
 if(r.objectClass&&!q.models?.length){
  const object={receiver:/接收卡|receiv(?:er|ing)\s*card/i,monochrome:/单色|单双色|single.dual|monochrome/i,player:/播放盒|异步盒|多媒体.{0,6}(?:播放器|播放盒)|player\s*box/i}[r.objectClass];
  if(!object.test(text+' '+row.name+' '+(row.applicabilityText||'')))return {accepted:false,reason:'requested-device-class-absent'};
 }
 if(q.intent==='operation'&&r.tasks.length&&!r.tasks.every(id=>tasks.find(t=>t.id===id).actions.test(text)))return {accepted:false,reason:'requested-operation-absent'};
 if(r.tasks.includes('read')&&/离线|未连接|断开连接/.test(q.original||'')&&!/离线|未连接|本地.{0,8}(?:文件|参数)|(?:文件|参数).{0,8}本地/.test(text))return {accepted:false,reason:'offline-read-condition-not-established'};
 if(r.softwareSelection&&!/HDPlayer|HDSet|HDShow|HDSign|HD2020|HD2018|LCD\s*Player|屏掌控|小灰云/i.test(text))return {accepted:false,reason:'software-identity-absent'};
 if(r.batteryModel&&!/(?:CR|BR|ML|LIR|ER|LR)\s*\d{3,5}|\d+(?:\.\d+)?\s*(?:V|伏).{0,12}(?:电池|battery)|电池.{0,12}\d+(?:\.\d+)?\s*(?:V|伏)/i.test(text))return {accepted:false,reason:'battery-model-value-absent'};
 if(r.fault){
  const symptom=/黑屏|花屏|不亮|闪烁|闪屏|偏色|颜色异常|搜不到|找不到|搜索不到|发送失败|连接失败|报错|无法|不显示|不能/.test(compact);
  const featureOnly=/支持.{0,8}(?:一键黑屏|黑屏)|(?:一键黑屏|黑屏键)|指示灯|运行灯|RUN灯|GPS灯/.test(compact)&&!/故障|排查|异常|解决|处理方法|检查/.test(compact);
  if(!symptom||featureOnly)return {accepted:false,reason:'feature-is-not-fault-evidence'};
 }
 return {accepted:true};
}
function softwareAssociationExcerpt(text,q,candidate={}){
 const names=/HDPlayer|HDSet|HDShow|HDSign|HD2020|HD2018|LCD\s*Player|屏掌控|小灰云/i;
 const required=requirements(q);
 if(required.tasks.length){
  // An application's name alone cannot prove that it performs the requested
  // action. Use a task-bearing passage in that application's own manual.
  const lines=require('./native-lines.cjs').nativeLines(text),at=lines.findIndex(line=>required.tasks.every(id=>tasks.find(t=>t.id===id).actions.test(line)));
  if(at<0)return null;
  const body=lines.slice(Math.max(0,at-1),at+7).join('\n');
  if(names.test(candidate.name||'')||names.test(body))return {text:body,sectionFocused:true,softwareAssociation:true};
  return null;
 }
 if(q.operation?.upgrade&&/接收卡/.test(q.original)&&/HDSet/i.test(candidate.name||'')){
  const at=String(text).search(/(?:\d+(?:\.\d+)*\s*)?固件升级/);
  if(at>=0&&/升级接收卡|接收卡.{0,15}固件/.test(text))return {text:'软件：HDSet（操作手册）\n'+String(text).slice(at,at+550),sectionFocused:true,softwareAssociation:true};
 }
 const phone=requirements(q).phone,lines=String(text).split('\n'),options=[];
 if(!phone){const at=lines.findIndex(line=>/^\s*(?:应用|配套)软件[:：]/.test(line));if(at>=0){const table=lines.slice(at,at+6).join('\n').trim();if(names.test(table))return {text:table,sectionFocused:true,softwareAssociation:true};}}
 for(let i=0;i<lines.length;i++){
  if(!names.test(lines[i]))continue;
  let excerpt=lines[i].trim();
  if(i>0&&/应用软件|配套软件|电脑端|PC端|移动端|手机端/.test(lines[i-1].replace(/\s/g,'')))excerpt=lines[i-1].trim()+'\n'+excerpt;
  // Preserve native wrapped lines, rather than publishing an unfinished clause.
  for(let j=i+1;j<Math.min(i+4,lines.length)&&excerpt.length<450&&!/[。；;]$/.test(excerpt);j++){
   if(/^\s*(?:第.{1,8}章|\d+[.、]|图\s*\d)/.test(lines[j]))break;
   excerpt+='\n'+lines[j].trim();
  }
  if(!/软件|APP|客户端|PC\s*端|移动端|手机端|application|software/i.test(excerpt)||!/(?:是|为|配套|调试|支持|用于|手机|移动端|控屏|电脑端|PC)/i.test(excerpt))continue;
  if(phone&&!/手机|APP|平板/i.test(excerpt))continue;
  const score=(/配套软件|手机控屏\s*APP|手机\s*APP|电脑端软件|调试软件|应用软件/.test(excerpt)?20:0)+(/(?:是|为).{0,30}(?:软件|APP)/i.test(excerpt)?10:0)-(/注册|下载|升级|安装|卸载/.test(excerpt)?8:0);
  options.push({text:excerpt.slice(0,600),score,sectionFocused:true,softwareAssociation:true});
 }
 return options.sort((a,b)=>b.score-a.score||a.text.length-b.text.length)[0]||null;
}
function conciseOperation(text,q){
 if(String(text).length<=700)return text;
 const lines=String(text).split('\n'),r=requirements(q),groups=r.groups;
 const fieldWords=(q.concepts||[]).includes('grayscale')?['灰阶','灰度等级','灰度级']:[];
 const target=line=>fieldWords.length?fieldWords.some(w=>line.includes(w)):groups.some(g=>g.some(w=>line.includes(w)));
 const matches=lines.map((line,index)=>({line,index,score:(target(line)?10:0)+(/点击|选择|勾选|保存|导出|读取/.test(line)?2:0)})).filter(x=>target(x.line)).sort((a,b)=>b.score-a.score||a.index-b.index);
 const at=matches[0]?.index??-1;if(at<0)return String(text).slice(0,650)+'\n……（更多步骤见原文）';
 const keep=new Set([0]);
 const setup=lines.findIndex(line=>/选中设备|点击.{0,12}显示屏配置/.test(line));
 if(setup>=0)for(let i=setup;i<Math.min(setup+3,lines.length);i++)keep.add(i);
 for(let i=Math.max(0,at-2);i<Math.min(lines.length,at+5);i++)keep.add(i);
 let prior=-1,total=0;const output=[];
 for(const i of [...keep].sort((a,b)=>a-b)){
  if(/https?:|www\.|深圳市.*公司/.test(lines[i]))continue;
  if(total+lines[i].length>650)break;
  if(prior>=0&&i>prior+1)output.push('……');output.push(lines[i]);total+=lines[i].length;prior=i;
 }
 output.push('……（完整步骤和适用条件见原文）');return output.join('\n');
}
module.exports={requirements,clarificationPlan,meetsRequirements,softwareAssociationExcerpt,conciseOperation};
