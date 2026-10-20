/* Product summary presentation. Never infer parameters or device compatibility. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductCard=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function layout(product){
  const f=product.features||{},metrics=[],details=[];let load=f.load||'',outputs=f.outputs||'',resolution=f.resolution||'';
  let m=/^(\d+(?:\.\d+)?)\s*(万)?像素$/.exec(load);
  const points=/^(\d+)×(\d+)点（(\d+)像素）$/.exec(load);
  if(m){const value=!m[2]&&Number(m[1])>=10000?String(Number(m[1])/10000)+'万':m[1]+(m[2]||'');metrics.push({label:'最大带载',value,unit:'像素'});load='';}
  else if(points){const pixels=Number(points[3]);metrics.push({label:'带载',value:pixels>=10000?String(pixels/10000)+'万':points[3],unit:'像素'});load=points[1]+'×'+points[2]+'点';}
  m=/^(?:网口×(\d+)|级联网口：(\d+)路)(?:；|$)/.exec(outputs);
  if(m){metrics.push({label:'输出网口',value:m[1]||m[2],unit:'个'});outputs=outputs.slice(m[0].length);}
  m=/^最宽\s*(\d+)；最高\s*(\d+)（独立上限）(.*)$/.exec(resolution);
  if(m){metrics.push({label:'最大宽度',value:m[1],unit:'像素'},{label:'最大高度',value:m[2],unit:'像素'});resolution='宽、高为独立上限'+m[3];}
  if(load)details.push({label:points?'带载尺寸':'带载条件',value:load});
  if(resolution)details.push({label:m?'适用条件':f.resolutionLabel||'尺寸条件',value:resolution});
  if(f.inputs)details.push({label:'信号输入',value:f.inputs});
  if(outputs)details.push({label:'其他输出',value:outputs});
  if(f.interfaces)details.push({label:'控制与接口',value:f.interfaces});
  if(f.highlights)details.push({label:'产品特点',value:f.highlights});
  const aliases=(product.aliases||[]).filter(a=>String(a).replace(/^HD[-_ ]?/i,'').toUpperCase()!==String(product.name||'').replace(/^HD[-_ ]?/i,'').toUpperCase());
  if(aliases.length)details.push({label:'型号别名',value:aliases.join(' / ')});
  return {metrics,details,subtitle:[f.series,String(product.name||'').replace(/^HD[-_ ]?/i,''),f.color].filter(Boolean).join(' · ')};
 }
 function render(product){
  const f=product.features||{},view=layout(product);
  let html=`<div class="pq-header"><div><h3>${esc(product.name)}</h3><p class="pq-subtitle">${esc(view.subtitle)}</p></div><span class="pq-badge">产品速查</span></div>`;
  if(view.metrics.length)html+='<div class="pq-metrics">'+view.metrics.map(m=>`<div class="pq-metric"><span>${esc(m.label)}</span><div><strong>${esc(m.value)}</strong><small>${esc(m.unit)}</small></div></div>`).join('')+'</div>';
  if(view.details.length)html+='<section class="pq-more"><h4>更多参数</h4><div class="pq-details">'+view.details.map(d=>d.value.length>180?`<details class="pq-long"><summary><span class="pq-long-title">${esc(d.label)}</span><span class="pq-parameter-preview">${esc(d.value)}</span><span class="pq-expand-hint">展开说明</span></summary><p>${esc(d.value)}</p></details>`:`<div class="pq-detail"><span>${esc(d.label)}</span><p>${esc(d.value)}</p></div>`).join('')+'</div></section>';
  if(f.parameterVersion)html+=`<p class="pq-source">带载/宽高参数版次：${esc(f.parameterVersion)}</p>`;
  if(f.notice)html+=`<p class="pq-notice">${esc(f.notice)}</p>`;
  const hasSource=(f.sources||[]).some(s=>/^\/v2\/offline\/preview\?id=\d+$/.test(s.url||'')&&Number.isInteger(s.row))||Object.values(f.evidence?.parameterEvidence||{}).flat().some(ref=>ref?.verificationStatus==='verified'&&ref.name);
  if(hasSource)html+='<p class="pq-source">基础参数来源：官方产品资料</p>';
  else if(view.metrics.length||view.details.length)html+='<p class="pq-source">基础参数来源：产品资料索引（原文待核对）</p>';
  return html;
 }
 return {layout,render};
});
