'use strict';
// Lexical parameters only. Device/count/port choices are left to rules and math.
function parseOrderingFields(text){
 const fields={},module={},screen={},provenance={},requirements={};
 const set=(target,key,value,match,prefix)=>{target[key]=value;provenance[prefix+'/'+key]={kind:'user-stated',text:match[0]};};
 let m=text.match(/\bP\s*(\d+(?:\.\d+)?)/i);if(m)set(module,'pitchMm',Number(m[1]),m,'/module');
 m=text.match(/模组(?:分辨率|像素)?\s*[:：]?\s*(\d+)\s*[x×*]\s*(\d+)/i);if(m){set(module,'pixelWidth',Number(m[1]),m,'/module');set(module,'pixelHeight',Number(m[2]),m,'/module');}
 m=text.match(/(?:^|[^A-Z0-9_-])(?:(\d+)\s*\/\s*)?(\d+)\s*(?:扫|S\b)/i);if(m)set(module,'scan',{numerator:m[1]?Number(m[1]):1,denominator:Number(m[2])},m,'/module');
 m=text.match(/\bHUB(?:75E?|12|08|320|50)\b/i);if(m)set(module,'interface',m[0].toUpperCase(),m,'/module');
 m=text.match(/(\d+)R\s*(\d+)G\s*(\d+)B/i);if(m)set(module,'color',{r:Number(m[1]),g:Number(m[2]),b:Number(m[3])},m,'/module');
 else if(/全彩/.test(text)&&!/(?:不是|非|不要|不使用)\s*全彩/.test(text))set(module,'color',{r:1,g:1,b:1},['全彩'],'/module');
 if(/PWM/i.test(text)&&!/常规芯片/.test(text)&&!/(?:不是|非|不要|不使用)\s*PWM/i.test(text))set(module,'driverFamily','pwm',['PWM'],'/module');else if(/常规芯片/.test(text)&&!/PWM/i.test(text))set(module,'driverFamily','conventional',['常规芯片'],'/module');
 if(/(?:不是|非|不要|不使用)\s*全彩/.test(text))provenance['/module/color']={kind:'user-negated',text};
 if(/(?:不是|非|不要|不使用)\s*PWM/i.test(text))provenance['/module/driverFamily']={kind:'user-negated',text};
 m=text.match(/整屏(?:分辨率|像素)\s*[:：]?\s*(\d+)\s*[x×*]\s*(\d+)/i);if(m){set(screen,'pixelWidth',Number(m[1]),m,'/screen');set(screen,'pixelHeight',Number(m[2]),m,'/screen');}
 m=text.match(/^(?:配单\s*)?P\d+(?:\.\d+)?\s+(\d+)\s*[x×]\s*(\d+)\s+(?:同步|异步)/i);if(m){set(screen,'pixelWidth',Number(m[1]),m,'/screen');set(screen,'pixelHeight',Number(m[2]),m,'/screen');}
 m=text.match(/(\d+)\s*(?:块|个)?(?:宽|列)\s*[，,x×* ]*\s*(\d+)\s*(?:块|个)?(?:高|行)/i);if(m){set(screen,'moduleColumns',Number(m[1]),m,'/screen');set(screen,'moduleRows',Number(m[2]),m,'/screen');}
 const box=text.match(/每箱模组\s*(\d+)\s*[x×*]\s*(\d+)/i),array=text.match(/箱体阵列\s*(\d+)\s*[x×*]\s*(\d+)/i);
 if(box||array){fields.cabinet={};if(box){fields.cabinet.moduleColumns=Number(box[1]);fields.cabinet.moduleRows=Number(box[2]);}if(array){fields.cabinet.columns=Number(array[1]);fields.cabinet.rows=Number(array[2]);}}
 if(/室内|户内/.test(text)&&!/室外|户外/.test(text))fields.environment='indoor';else if(/室外|户外/.test(text)&&!/室内|户内/.test(text))fields.environment='outdoor';
 if(/异步/.test(text)&&!/同步/.test(text.replace(/异步/g,'')))fields.controlMode='async';else if(/同步/.test(text)&&!/异步/.test(text))fields.controlMode='sync';
 if(/接收卡/.test(text)&&!/直控/.test(text))fields.architecture='receiver';else if(/直控/.test(text)&&!/接收卡/.test(text))fields.architecture='direct';
 if(/播放盒/.test(text)&&!/(?:不是|不要|不用|不使用)\s*播放盒/.test(text))requirements.controllerFamily='playBox';
 if(/异步(?:控制)?卡/.test(text)&&!/(?:不是|不要|不用|不使用)\s*异步(?:控制)?卡/.test(text))requirements.controllerFamily='asyncCard';
 if(/C16(?:L|H)?共享|内置接口共享/i.test(text))requirements.c16Sharing=true;
 if(/(?:需要|要|支持)\s*HDMI\s*输出/i.test(text)&&!/(?:不要|不需要|无需|不支持)\s*HDMI\s*输出/i.test(text))requirements.hdmiOut=true;
 if(/(?:用于|做|是)\s*广告屏/.test(text)&&!/(?:不是|不做|不用于)\s*广告屏/.test(text))requirements.posterScreen=true;
 if(/(?:用于|做|是)\s*会议屏/.test(text)&&!/(?:不是|不做|不用于)\s*会议屏/.test(text))requirements.meetingScreen=true;
 if(Object.keys(requirements).length)fields.requirements=requirements;
 if(Object.keys(module).length)fields.module=module;if(Object.keys(screen).length)fields.screen=screen;
 if(Object.keys(provenance).length)fields.provenance=provenance;return fields;
}
module.exports={parseOrderingFields};
