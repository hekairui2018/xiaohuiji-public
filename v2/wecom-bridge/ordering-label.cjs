'use strict';
function orderingLabel(result){
 const p=result?.plan,n=result?.nativeOrdering;
 if(!p&&!n)return null;
 const pitch=p?.module?.dotPitch?.spacing||result.normalizedDemand?.module?.pitchMm;
 const screen=p?.screen||n?.screen;
 const specification=[pitch?'P'+pitch:null,screen?.pixelWidth&&screen?.pixelHeight?screen.pixelWidth+'×'+screen.pixelHeight+'像素':null].filter(Boolean).join(' · ');
 let id=result.selectedOptionId;
 if(!Number.isSafeInteger(id)){
  const matching=(result.options||[]).filter(o=>o.controller===p?.controller?.model&&String(o.receiver?.modelId||'').replace(/^HD-/,'')===p?.receiver?.model&&(!o.metrics||o.metrics.ports===p?.ports?.length));
  if(matching.length===1)id=matching[0].id;
 }
 const option=Number.isSafeInteger(id)?'方案'+id:'当前方案';
 const title=[specification||'LED大屏',option,result.previewBom||result.provisionalExportDemand?'暂定':''].filter(Boolean).join(' · ');
 return {id:Number.isSafeInteger(id)?id:null,title,prefix:title.replace(/[<>:"/\\|?*\r\n]/g,'_').slice(0,90)};
}
module.exports={orderingLabel};
