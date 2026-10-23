'use strict';
// Lexical parameters only. Device/count/port choices are left to rules and math.
function parseOrderingFields(text){
 text=require('./customer-meaning.cjs').spokenGeometry(text).replace(/(\d)\s*乘\s*(\d)/g,'$1×$2');
 // V1 axis convention: 长…宽… without 高 means horizontal/vertical.
 if(/长[^高]*宽/.test(text)&&!text.includes('高'))text=text.replace(/长度|长/g,'\uE000').replace(/宽度|宽/g,'高').replace(/\uE000/g,'宽');
 const fields={},module={},screen={},provenance={},requirements={};
 const set=(target,key,value,match,prefix)=>{target[key]=value;provenance[prefix+'/'+key]={kind:'user-stated',text:match[0]};};
 let m=text.match(/\bP\s*(\d+(?:\.\d+)?)/i);if(m)set(module,'pitchMm',Number(m[1]),m,'/module');
 m=text.match(/点间距\s*(?:是|为)?\s*(\d+(?:\.\d+)?)\s*(?:毫米|mm)/i);if(m)set(module,'pitchMm',Number(m[1]),m,'/module');
 m=text.match(/模组(?:的)?(?:物理)?尺寸\s*(?:是|为)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米)/i);if(m){const factor=/cm|厘米/i.test(m[3])?10:1;set(module,'physicalWidthMm',Number(m[1])*factor,m,'/module');set(module,'physicalHeightMm',Number(m[2])*factor,m,'/module');}
 m=text.match(/模组(?:的)?(?:分辨率|像素)?\s*(?:是|为|改为|调整为)?\s*[:：]?\s*(\d+)\s*[x×*]\s*(\d+)(?![\d.]|\s*(?:mm|毫米|米|m\b))/i);if(m){set(module,'pixelWidth',Number(m[1]),m,'/module');set(module,'pixelHeight',Number(m[2]),m,'/module');}
 m=text.match(/(?:^|[^A-Z0-9_-])(?:(\d+)\s*\/\s*)?(\d+)\s*(?:扫|S\b)/i);if(m)set(module,'scan',{numerator:m[1]?Number(m[1]):1,denominator:Number(m[2])},m,'/module');
 m=text.match(/\bHUB(?:75E?|12|08|320|50)\b/i);if(m)set(module,'interface',m[0].toUpperCase(),m,'/module');
 m=text.match(/(\d+)R\s*(\d+)G\s*(\d+)B/i);if(m)set(module,'color',{r:Number(m[1]),g:Number(m[2]),b:Number(m[3])},m,'/module');
 else if(/全彩/.test(text)&&!/(?:不是|非|不要|不使用)\s*全彩/.test(text))set(module,'color',{r:1,g:1,b:1},['全彩'],'/module');
 if(/PWM/i.test(text)&&!/常规芯片/.test(text)&&!/(?:不是|非|不要|不使用)\s*PWM/i.test(text))set(module,'driverFamily','pwm',['PWM'],'/module');else if(/常规芯片/.test(text)&&!/PWM/i.test(text))set(module,'driverFamily','conventional',['常规芯片'],'/module');
 if(/(?:不是|非|不要|不使用)\s*全彩/.test(text))provenance['/module/color']={kind:'user-negated',text};
 if(/(?:不是|非|不要|不使用)\s*PWM/i.test(text))provenance['/module/driverFamily']={kind:'user-negated',text};
 m=text.match(/整屏(?:分辨率|像素)\s*[:：]?\s*(\d+)\s*[x×*]\s*(\d+)/i);if(m){set(screen,'pixelWidth',Number(m[1]),m,'/screen');set(screen,'pixelHeight',Number(m[2]),m,'/screen');}
 // A standalone resolution statement supplies screen pixels, including a
 // follow-up answer to the ordering assistant. Keep module/input dimensions
 // and physical units out of this field rather than matching a loose suffix.
 m=text.match(/(?:^|[，,;；。])\s*(?:(?:整屏|屏幕)(?:的)?\s*)?(?:分辨率|像素)\s*(?:是|为|改为|调整为)?\s*[:：]?\s*(\d+)\s*[x×*]\s*(\d+)(?![\d.]|\s*(?:mm|毫米|米|m\b))/i);
 if(m){set(screen,'pixelWidth',Number(m[1]),m,'/screen');set(screen,'pixelHeight',Number(m[2]),m,'/screen');}
 m=text.match(/^(?:配单\s*)?P\d+(?:\.\d+)?\s+(\d+)\s*[x×]\s*(\d+)\s+(?:同步|异步)/i);if(m){set(screen,'pixelWidth',Number(m[1]),m,'/screen');set(screen,'pixelHeight',Number(m[2]),m,'/screen');}
 m=text.match(/(\d+)\s*(?:块|个)?(?:宽|列)\s*[，,x×* ]*\s*(\d+)\s*(?:块|个)?(?:高|行)/i);if(m){set(screen,'moduleColumns',Number(m[1]),m,'/screen');set(screen,'moduleRows',Number(m[2]),m,'/screen');}
 // Screen and module dimensions are distinct. No grid rounding or inferred module properties.
 m=text.match(/(?:整屏|屏幕)(?:的)?(?:分辨率|像素)?\s*(?:是|为|改为|调整为)?\s*[:：]?\s*(\d{3,5})\s*[x×*]\s*(\d{2,5})(?![\d.]|\s*(?:mm|毫米|米|m\b))/i)||text.match(/^\s*(\d{3,5})\s*[x×*]\s*(\d{3,5})(?:\s*(?:点|像素))?(?:[，,\s]*(?:同步|异步))?\s*$/i);
 if(m){set(screen,'pixelWidth',Number(m[1]),m,'/screen');set(screen,'pixelHeight',Number(m[2]),m,'/screen');}
 for(const [axis,key]of [['宽|长','pixelWidth'],['高','pixelHeight']]){
  m=text.match(new RegExp('(?:'+axis+')\\s*(\\d{3,5})(?![0-9]|\\s*(?:米|m|毫米|张|块|排|个|列|行))','i'));
  if(m)set(screen,key,Number(m[1]),m,'/screen');
 }
 for(const [axis,key]of [['宽|长','physicalWidthMm'],['高','physicalHeightMm']]){
  m=text.match(new RegExp('(?:'+axis+')\\s*(\\d+(?:\\.\\d+)?)\\s*(米|m(?![a-z])|毫米|mm)','i'));
  if(m)set(screen,key,Number(m[1])*(/^(?:米|m)$/i.test(m[2])?1000:1),m,'/screen');
 }
 m=text.match(/(\d+(?:\.\d+)?)\s*(?:米|m)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*(?:米|m)(?![a-z])/i);
 if(m){set(screen,'physicalWidthMm',Number(m[1])*1000,m,'/screen');set(screen,'physicalHeightMm',Number(m[2])*1000,m,'/screen');}
 m=text.match(/(\d+(?:\.\d+)?)\s*(?:米|m)\s*(?:宽|长)[，,\s]*(\d+(?:\.\d+)?)\s*(?:米|m)\s*高/i);
 if(m){set(screen,'physicalWidthMm',Number(m[1])*1000,m,'/screen');set(screen,'physicalHeightMm',Number(m[2])*1000,m,'/screen');}
 for(const [axis,key]of [['横(?:向|着|排)?|宽|列','moduleColumns'],['竖(?:向|着|排)?|纵(?:向|着|排)?|高|行','moduleRows']]){
  m=text.match(new RegExp('(?:'+axis+')\\s*(?:排了|摆了|放了|排|摆|放|有|是|为)?\\s*(\\d{1,3})\\s*(?:张|块|个)(?!像素|点)','i'));
  if(m)set(screen,key,Number(m[1]),m,'/screen');
 }
 m=text.match(/(?:模组)?\s*(?:一|1|每)(?:行|排)\s*(\d+)\s*(?:块|张|个)(?:模组)?[，,\s]*(?:一共|共|总共)?\s*(\d+)\s*(?:行|排)/);if(m){set(screen,'moduleColumns',Number(m[1]),m,'/screen');set(screen,'moduleRows',Number(m[2]),m,'/screen');}
 const box=text.match(/每箱模组\s*(\d+)\s*[x×*]\s*(\d+)/i),array=text.match(/箱体阵列\s*(\d+)\s*[x×*]\s*(\d+)/i);
 if(box||array){fields.cabinet={};if(box){fields.cabinet.moduleColumns=Number(box[1]);fields.cabinet.moduleRows=Number(box[2]);}if(array){fields.cabinet.columns=Number(array[1]);fields.cabinet.rows=Number(array[2]);}}
 const positive=text.replace(/(?:不是|不要|不用|不做|非)\s*(?:同步|异步|室内|户内|室外|户外)/g,'');
 if(/室内|户内/.test(positive)&&!/室外|户外/.test(positive))fields.environment='indoor';else if(/室外|户外/.test(positive)&&!/室内|户内/.test(positive))fields.environment='outdoor';
 else if(/(?:不是|不要|不用|不做|非)\s*(?:室内|户内|室外|户外)/.test(text))provenance['/environment']={kind:'user-negated',text};
 if(/异步/.test(positive)&&!/同步/.test(positive.replace(/异步/g,'')))fields.controlMode='async';else if(/同步/.test(positive)&&!/异步/.test(positive))fields.controlMode='sync';
 else if(/(?:不是|不要|不用|不做|非)\s*(?:同步|异步)/.test(text))provenance['/controlMode']={kind:'user-negated',text};
 if(!fields.controlMode){const described=require('./customer-meaning.cjs').describedControlMode(text);if(described){fields.controlMode=described;delete provenance['/controlMode'];}}
 if(/接收卡/.test(text)&&!/直控/.test(text))fields.architecture='receiver';else if(/直控/.test(text)&&!/接收卡/.test(text))fields.architecture='direct';
 if(/播放盒/.test(text)&&!/(?:不是|不要|不用|不使用)\s*播放盒/.test(text))requirements.controllerFamily='playBox';
 if(/异步(?:控制)?卡/.test(text)&&!/(?:不是|不要|不用|不使用)\s*异步(?:控制)?卡/.test(text))requirements.controllerFamily='asyncCard';
 if(/C16(?:L|H)?共享|内置接口共享/i.test(text))requirements.c16Sharing=true;
 if(/(?:需要|要|支持)\s*HDMI\s*输出/i.test(text)&&!/(?:不要|不需要|无需|不支持)\s*HDMI\s*输出/i.test(text))requirements.hdmiOut=true;
 if(/(?:用于|做|是)\s*广告屏/.test(text)&&!/(?:不是|不做|不用于)\s*广告屏/.test(text))requirements.posterScreen=true;
 if(/(?:用于|做|是)\s*会议屏/.test(text)&&!/(?:不是|不做|不用于)\s*会议屏/.test(text))requirements.meetingScreen=true;
 if(Object.keys(requirements).length)fields.requirements=requirements;
 for(const k of ['environment','controlMode','architecture'])if(fields[k])provenance['/'+k]={kind:'user-stated',text};
 if(Object.keys(module).length)fields.module=module;if(Object.keys(screen).length)fields.screen=screen;
 if(Object.keys(provenance).length)fields.provenance=provenance;return fields;
}
// Shared lexical observation: values, entity and units stay independent until
// the dialogue owner resolves them. This never selects equipment or rounds grids.
function geometryObservation(input){
 const text=require('./customer-meaning.cjs').spokenGeometry(input).replace(/乘以|乘/g,'×');
 const number='(\\d+(?:\\.\\d+)?)',unit='(毫米|mm|厘米|cm|米|m|像素|点|px)?';
 const pair=new RegExp(number+'\\s*'+unit+'\\s*[x×*]\\s*'+number+'\\s*'+unit,'i').exec(text);
 const axes=[...text.matchAll(new RegExp('(宽|长|高)\\s*(?:是|为|改为)?\\s*'+number+'\\s*'+unit,'gi'))];
 let values=null,units=[],axisUnits={};
 if(pair){values={width:Number(pair[1]),height:Number(pair[3])};units=[pair[2],pair[4]].filter(Boolean);axisUnits={width:pair[2]||pair[4],height:pair[4]||pair[2]};}
 else if(axes.length){values={};for(const a of axes){const axis=a[1]==='高'?'height':'width';values[axis]=Number(a[2]);if(a[3]){units.push(a[3]);axisUnits[axis]=a[3];}}}
 // Resolve the object and its label in the clause containing the dimensions.
 // A later request to use a catalogue module must not own an earlier screen size.
 const anchor=pair?.index??axes[0]?.index;
 const left=anchor===undefined?0:Math.max(...[...text.slice(0,anchor).matchAll(/[，,；;。]/g)].map(m=>m.index+1),0);
 const right=anchor===undefined?text.length:anchor+(text.slice(anchor).search(/[，,；;。]/)<0?text.length-anchor:text.slice(anchor).search(/[，,；;。]/));
 const scope=text.slice(left,right).replace(/(?:按|用|采用).{0,6}(?:常规|默认|推荐).{0,4}模组(?:配|计算)?|模组(?:不知道|不清楚|不确定)|(?:不知道|不清楚|不确定)模组/g,'');
 const entity=/模组/.test(scope)?'module':/箱体/.test(scope)?'cabinet':/HDMI|输入|输出|信号源/i.test(scope)?'signal':/整屏|屏幕|屏宽|屏高/.test(scope)?'screen':null;
 const label=/分辨率|像素|\bpx\b|这是.{0,3}点数/i.test(scope)?'pixels':/毫米|\bmm\b/i.test(scope)?'mm':/厘米|\bcm\b/i.test(scope)?'cm':/(?:单位|尺寸|宽|高|长).{0,8}米|\bm\b/i.test(scope)?'m':null;
 const normalize=u=>/毫米|^mm$/i.test(u)?'mm':/厘米|^cm$/i.test(u)?'cm':/^米$|^m$/i.test(u)?'m':'pixels';
 const kinds=[...new Set(units.map(normalize))];
 const mixedPhysical=kinds.length>1&&!kinds.includes('pixels');
 return {values,axisUnits:Object.fromEntries(Object.entries(axisUnits).filter(([,u])=>u).map(([k,u])=>[k,normalize(u)])),entity,unit:kinds.length===1?kinds[0]:mixedPhysical?'mm':label,conflict:kinds.length>1&&!mixedPhysical||kinds.length===1&&label&&kinds[0]!==label,quote:String(input)};
}
function geometryDelta(observation,entity,unit){
 const delta={provenance:{}},factor={mm:1,cm:10,m:1000,pixels:1}[unit];
 if(!observation?.values||!['screen','module'].includes(entity)||factor===undefined)return delta;
 for(const [axis,value]of Object.entries(observation.values)){
  const key=(unit==='pixels'?'pixel':'physical')+(axis==='width'?'Width':'Height')+(unit==='pixels'?'':'Mm');
  const axisFactor={mm:1,cm:10,m:1000,pixels:1}[observation.axisUnits?.[axis]]??factor;
  delta[entity]??={};delta[entity][key]=value*axisFactor;
  delta.provenance['/'+entity+'/'+key]={kind:'user-stated',text:observation.quote,unit:observation.axisUnits?.[axis]||unit,rawValue:value};
 }
 return delta;
}
module.exports={parseOrderingFields,geometryObservation,geometryDelta};
