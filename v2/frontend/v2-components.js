'use strict';
function renderV2ResourceLinks(resources){
 const root=document.createElement('div');root.className='v2-resource-links';
 if(resources.kind==='firmware'){const note=document.createElement('p');note.textContent='原文件需按设备型号、硬件版本及文件变体核对，不能只凭文件名判断适用。';root.appendChild(note);}
 for(const item of resources.items){const row=document.createElement('p'),url=item.publicUrl||item.url,label=item.file||item.name;
  if(url&&/^(https?:\/\/|\/[^/])/i.test(url)){const a=document.createElement('a');a.className='v2-file-link'+(resources.kind==='firmware'?' v2-file-download':'');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;row.appendChild(a);}else row.textContent=label;
  if(resources.kind==='firmware'){const conditions=document.createElement('span');conditions.textContent=' · '+item.card+'，硬件尾位 '+(item.hwFromFile||'未记载')+'，文件变体 '+(item.variant||'文件名未注明');row.appendChild(conditions);}
  root.appendChild(row);
 }return root;
}
// Presentation only: all choices and quantities come from the validated domain result.
function renderV2Ordering(result){
 const root=document.createElement('div');
 if(result.planningStatus==='conditional'){const label=document.createElement('p');label.textContent='条件配单 · 清单与连接图已计算';label.className='v2-conditional-plan';root.appendChild(label);}
 const direct=result.plan.architecture==='direct';
 if(result.options?.length>1){const choices=document.createElement('div');for(const option of result.options){const b=document.createElement('button');b.type='button';b.textContent='方案'+option.id+' '+option.controller+' '+(option.controlMode==='async'?'异步':'同步')+' / 模组'+option.moduleId;b.onclick=()=>{const input=document.querySelector('#aiInput'),send=document.querySelector('#aiSendBtn');if(!input||!send||send.disabled)return;input.value='配单方案：'+option.id;input.dispatchEvent(new Event('input',{bubbles:true}));send.click();};choices.appendChild(b);}root.appendChild(choices);}
 const heading=document.createElement('p');heading.textContent=`整屏 ${result.plan.screen.pixelWidth}×${result.plan.screen.pixelHeight} 像素，`+(direct?`${result.plan.directOutputs.length} 个逻辑HUB接口区域`:`${result.plan.ports.length} 个网口`);root.appendChild(heading);
 const list=document.createElement('ul');
 for(const item of result.bom||result.previewBom||[]){const li=document.createElement('li');const name=item.kind==='module'?`P${result.plan.module.dotPitch.spacing} 模组 ${result.plan.module.resolution.join('×')}`:item.kind==='receiver'?`接收卡 ${item.modelId}`:`主控 ${item.modelId}`;li.textContent=`${name}：${item.quantity}${item.kind==='module'?'块':item.kind==='receiver'?'张':'台'}`;list.appendChild(li);}root.appendChild(list);
 if(result.hdsetSvg||result.topologySvg){const img=document.createElement('img');img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(result.hdsetSvg||result.topologySvg);img.alt='网口与接收卡区域规划';img.style.width='100%';img.style.maxHeight='440px';root.appendChild(img);}
 if(direct||result.plan.builtInRegions?.length){const note=document.createElement('p');note.textContent=direct?'直控方案不生成接收卡连屏文件；逻辑接口区域需按对应设备资料核对实际排线。':'末端箱体由控制卡内置接口接管；当前没有混合配置格式依据，暂不导出SSM。';root.appendChild(note);return root;}
 if(result.exportAllowed===false){const note=document.createElement('p');note.textContent=result.planningStatus==='conditional'?'可先按清单评估方案。扫描、接口等采用了注明的候选规格；现场不一致时重新计算，导入配置须核对后生成。':'暂定方案预览：现场模组、使用方式及接线条件确认后才可生成导入配置。';root.appendChild(note);return root;}
 const button=document.createElement('button');button.type='button';button.className='ord-topo-btn';button.textContent='下载 HDSet 连屏文件';
 const message=document.createElement('p');message.textContent='供 HDSet 标准模式导入检查；请核对现场型号和带载条件。';
 button.onclick=async()=>{button.disabled=true;try{const response=await fetch('/v2/ordering/ssm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result.normalizedDemand)});
  if(!response.ok){const error=await response.json();throw Error(error.reason||error.message||(typeof error.error==='string'?error.error:'当前方案不能导出（'+response.status+'）'));}
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='xiaohuiji-v2.ssm';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message.textContent='文件已生成，请在 HDSet 中导入并核对。';
 }catch(error){message.textContent='下载失败：'+error.message;}finally{button.disabled=false;}};
 root.append(button,message);return root;
}
