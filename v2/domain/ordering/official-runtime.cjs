'use strict';
// Execute only pinned, isolated pure calculation closures from the downloaded
// website. Never execute its DOM, network, storage or application bootstrap.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const SHA='9b0644bbc31016b126d8167a884104200c328a8f1c0aca83ef1229a865c7c54e';
let source;
function closure(start,end){
 if(!source){source=fs.readFileSync(path.resolve(__dirname,'../../..','reference/selection-sources/official-js-analysis-20261013/official-index-26d75d63.js'),'utf8');if(crypto.createHash('sha256').update(source).digest('hex')!==SHA)throw Error('official-runtime-source-checksum-mismatch');}
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);if(a<0||b<0)throw Error('official-runtime-boundary-missing');return source.slice(a+start.length,b);
}
function run(code,values){const box=vm.createContext({...values,console:{log(){},warn(){},error(){}},result:null},{codeGeneration:{strings:false,wasm:false}});new vm.Script(code).runInContext(box,{timeout:1000});return JSON.parse(JSON.stringify(box.result));}
function officialHeight(columns,rows,module,receiver){
 const fn=closure('Ex=',',Ox=');
 return run('const Et=()=>state;const calc='+fn+';result=calc(columns,rows);',{columns,rows,ml:{SingleNetWorkPortsSize:655360},state:{moduleProducts:{value:module},modInformation:{value:{receiveCard:[receiver],divReceiveCard:{model:receiver.model}}},builtIn2Open:{value:false},multiOpenDrawing:{value:false},MaxMoreOpenNum:{value:1}}});
}
function publicFilter(devices,screen,category){
 const fn=closure('dL=',',fL=');
 return run('const Jo=()=>({});const Et=()=>state;const calc='+fn+';const api=calc();result=api.MatchWidthAndHeightWithPoints(api.PublicFilterSendingCard(devices),category);',{devices,category,state:{modInformation:{value:{}},screenInformation:{value:{}},NumberOfModulesX:{value:0},NumberOfModulesY:{value:0},AreaLong:{value:0},PixelLong:{value:screen.pixelWidth},PixelWidth:{value:screen.pixelHeight},scene:{value:{}},receivingCard:{value:{}},drawFail:{value:[]},div:{value:{}},ReceiveCardWidth:{value:0},PointSpacing:{value:0},HubAdapterBoardResult:{value:{}}}});
}
function officialCabinet(cabinet,module,receiver){
 const fn='function hL'+closure('function hL','const Js=');
 const state={moduleProducts:{value:module},modInformation:{value:{receiveCard:[receiver],divReceiveCard:{model:receiver.model},HUBSpecification:{name:module.interface.replace('HUB','')}}},scene:{value:{}},productCard:{value:{}},receivingCard:{value:{}},drawFail:{value:[]},VP8000Output:{value:{}},NumberOfModulesX:{value:cabinet.columns},NumberOfModulesY:{value:cabinet.rows},CabinetNumberOfModulesX:{value:cabinet.moduleColumns},CabinetNumberOfModulesY:{value:cabinet.moduleRows},SingleInputPortsSize:{value:0}};
 // Ordinary cabinet branch only. Built-in C16 sharing is a distinct source
 // branch and must not be inferred by decrementing receiver counts here.
 return run('const Et=()=>state;const Gi=()=>false;'+fn+';hL().filterCabinetReceivingCard();result=state.receivingCard.value;',{state});
}
function officialDiscount(module,screen,controller,receivers){
 const fn='function mL'+closure('function mL','function pL');
 const ref=value=>({value}),width=module.resolution[0],pitch=module.dotPitch.spacing;
 const state={scene:ref({H4K:false}),moduleProducts:ref(module),modInformation:ref({receiveCard:module.receiveCard,divReceiveCard:{model:''},HUBSpecification:{name:module.interface.replace('HUB','')}}),screenInformation:ref({pixel:{long:screen.pixelWidth,width:screen.pixelHeight}}),productCard:ref(controller),receivingCard:ref({}),ModulePixelWidth:ref(width),NumberOfModulesX:ref(screen.columns),NumberOfModulesY:ref(screen.rows),builtIn2Open:ref(false),IsFullColorModules:ref(true),ReceiveCardWidth:ref(module.receiveCard[0].width),ResetModulesWidthProportional:ref(Math.floor((pitch>=4?768:pitch>=3?1024:pitch>=2.5?1280:2048)/width)*width),IsC16L:ref(false)};
 return run('const Et=()=>state;const Js={value:[]},ol={value:[]},sd={value:{}},z2={value:0};let failed=false;'+fn+';mL().discountPlan(controller,()=>{failed=true});result={failed,excluded:ol.value,segments:sd.value,receiver:state.receivingCard.value,candidates:Js.value};',{state,controller,My:structuredClone(receivers),ml:{SingleNetWorkPortsSize:655360,FixedCanvas:[{width:1024,height:512},{width:768,height:704},{width:512,height:1024}]}});
}
module.exports={officialHeight,officialCabinet,officialDiscount,publicFilter,sourceSHA256:SHA};
