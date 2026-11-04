(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OrderingBomData=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const columns=['序号','名称','型号','参数','数量','单位','备注'];
 function build(result){
  const p=result.plan,n=result.nativeOrdering,optionId=result.selectedOptionId||1;
  const screen=p?.screen||{},pixel=n?.screen?.pixel,pitch=p?.module?.dotPitch?.spacing||n?.module?.dotPitch?.spacing;
  const resolution=screen.pixelWidth&&screen.pixelHeight?screen.pixelWidth+'×'+screen.pixelHeight:pixel?.long&&pixel?.width?pixel.long+'×'+pixel.width:'未确认';
  const provisional=result.exportAllowed===false||result.status==='needs_input';
  const title=(provisional?'暂定 · ':'')+(pitch?'P'+pitch+' · ':'')+resolution+'像素 LED大屏控制系统BOM表｜方案'+optionId;
  const raw=result.bom||result.previewBom||[],items=[];
  for(const r of raw.filter(r=>['controller','sender','receiver','output-board'].includes(r.kind)&&r.quantity>0).sort((a,b)=>Number(a.kind==='receiver')-Number(b.kind==='receiver'))){
   const receiver=r.kind==='receiver',device=receiver?p?.receiver:p?.controller,source=device?.source;
   const sameDevice=String(r.modelId||r.model||'').replace(/^HD-/i,'').toUpperCase()===String(device?.model||'').replace(/^HD-/i,'').toUpperCase();
   const parameters=[];
   if(source&&device&&sameDevice){for(const [key,label,unit]of [['totalPoints','额定总带载','像素'],['maxWidth','额定最大宽','像素'],['maxHeight','额定最大高','像素']])if(Number.isFinite(device[key]))parameters.push({label,value:device[key],unit,type:'rated',source});}
   if(p&&sameDevice){if(receiver){const cells=p.cells||[];if(cells.length)parameters.push({label:'本方案接收单元数',value:cells.length,unit:'个',type:'actual',source:'current-validated-plan'});}else {parameters.push({label:'本方案整屏',value:resolution,unit:'像素',type:'actual',source:'current-validated-plan'});if(p.ports?.length)parameters.push({label:'本方案使用网口',value:p.ports.length,unit:'个',type:'actual',source:'current-validated-plan'});}}
   const remarks=[r.note,r.notes,result.includedReceiverNotice,p?.includedReceiver&&'主控含1个内置等效接收单元，不另购；接收卡数量为外置采购数量',p?.builtInRegions?.length&&'控制卡内置HUB单元不另购',provisional&&'暂定方案，未确认条件按默认值'].filter(x=>typeof x==='string'&&x);
   const rawModel=r.modelId||r.model||device?.model||'未确认',model=/^(?:HD-)?[A-Z]+\d[A-Z0-9-]*$/i.test(rawModel)?'HD-'+rawModel.replace(/^HD-/i,''):rawModel;
   items.push({index:items.length+1,kind:r.kind,name:receiver?'接收卡':r.kind==='output-board'?'发送端输出板卡':r.kind==='sender'?'发送设备':'发送端设备',model,parameters,quantity:r.quantity,unit:receiver?'张':r.kind==='output-board'?'块':'台',remarks:[...new Set(remarks)].join('；')});
  }
  const defaults=[...result.defaults||[],...result.orderingAssumptions||[]].map(d=>d.label).filter(Boolean);
  const warnings=[...new Set([...defaults,...result.warnings||[],result.includedReceiverNotice].filter(x=>typeof x==='string'&&x))];
  return {schemaVersion:'xhj-control-bom/1',title,optionId,provisional,resolution,pitch: pitch??null,columns,items,warnings,fileStem:title.replace(/[<>:"/\\|?*]/g,'_'),scope:'control-equipment-only; no quote or unverified accessories'};
 }
 const values=r=>[r.index,r.name,r.model,r.parameters.map(p=>p.label+'：'+p.value+p.unit).join('\n'),r.quantity,r.unit,r.remarks];
 const csv=bom=>'\uFEFF'+[bom.columns,...bom.items.map(values),...bom.warnings.map(w=>['','','','','','',''+w])].map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');
 return {build,values,csv};
});
