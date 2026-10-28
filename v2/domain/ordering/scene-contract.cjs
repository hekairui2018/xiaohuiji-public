'use strict';
// Source enum IDs: pinned official selection-tool Vt. Conditions are separate
// from module selection, so absent scene inputs never become guessed defaults.
function sceneMissing(demand){
 const r=demand.requirements||{},s={...r.nativeScene,...r},missing=[];
 const add=(path,reason)=>missing.push({path,reason});
 if(r.controllerFamily==='splicer'||s.T16===true){
  if(!s.sourceResolution?.length)add('/requirements/sourceResolution','信号源是2K、4K@30Hz还是4K@60Hz？这是输入源规格，不是整屏像素。');
  if(!s.outInput?.length&&(s.T16!==true||s.applicationScenarios?.id===2))add('/requirements/outInput',s.T16===true?'T16前端拼接器使用HDMI输出板还是DVI输出板？':'拼接器输出使用网口板、HDMI板还是DVI板？');
 }
 if(s.T16===true&&!s.applicationScenarios?.id)add('/requirements/applicationScenarios','T16前端接多媒体服务器、拼接器还是分布式设备？');
 if(r.cascadeSplicing?.supportive===true&&(!Number.isSafeInteger(r.cascadeSplicing.count)||r.cascadeSplicing.count<2))add('/requirements/cascadeSplicing/count','请确认级联的播放盒数量，至少两台。');
 if(demand.cabinet)for(const k of ['moduleColumns','moduleRows','columns','rows'])if(!Number.isSafeInteger(demand.cabinet[k])||demand.cabinet[k]<1)add('/cabinet/'+k,({moduleColumns:'每箱横向有几张模组？',moduleRows:'每箱竖向有几张模组？',columns:'整屏横向有几个箱体？',rows:'整屏竖向有几个箱体？'})[k]);
 return missing;
}
function sceneConflict(demand){
 const r=demand.requirements||{},s={...r.nativeScene,...r};
 for(const [key,ids]of [['sourceResolution',[1,2,3]],['outInput',[1,2,3,4]]])if(s[key]!==undefined&&(!Array.isArray(s[key])||s[key].some(x=>!ids.includes(typeof x==='object'?x?.id:x))))return {status:'conflict',reason:'unknown-official-scene-option',field:key};
 if(s.applicationScenarios!==undefined&&![1,2,3].includes(s.applicationScenarios?.id))return {status:'conflict',reason:'unknown-official-scene-option',field:'applicationScenarios'};
 if(s.T16===true&&s.outInput?.some(x=>(x?.id??x)===1))return {status:'conflict',reason:'t16-upstream-cannot-use-network-output-board'};
 return null;
}
module.exports={sceneMissing,sceneConflict};
