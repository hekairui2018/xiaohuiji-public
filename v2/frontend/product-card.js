/* Product summary presentation. Never infer parameters or device compatibility. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductCard=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function layout(product){
  const f=product.features||{},metrics=[],details=[];let load=f.load||'',outputs=f.outputs||'',resolution=f.resolution||'';
  let m=/^(\d+(?:\.\d+)?)\s*(万)?像素$/.exec(load);
  const points=/^(\d+)×(\d+)点（(\d+)像素）$/.exec(load);
  if(m){metrics.push({label:'最大带载',value:m[1]+(m[2]||''),unit:'像素'});load='';}
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
  return {metrics,details,subtitle:[f.series,String(product.name||'').replace(/^HD[-_ ]?/i,''),f.color].filter(Boolean).join(' · ')};
 }
 function render(product){
  const f=product.features||{},view=layout(product);
  let html=`<div class="pq-header"><div><h3>${esc(product.name)}</h3><p class="pq-subtitle">${esc(view.subtitle)}</p></div><span class="pq-badge">产品速查</span></div>`;
  if(view.metrics.length)html+='<div class="pq-metrics">'+view.metrics.map(m=>`<div class="pq-metric"><span>${esc(m.label)}</span><div><strong>${esc(m.value)}</strong><small>${esc(m.unit)}</small></div></div>`).join('')+'</div>';
  if(view.details.length)html+='<div class="pq-details">'+view.details.map(d=>d.value.length>180?`<details class="pq-long"><summary>${esc(d.label)} · 查看完整说明</summary><p>${esc(d.value)}</p></details>`:`<div class="pq-detail"><span>${esc(d.label)}</span><p>${esc(d.value)}</p></div>`).join('')+'</div>';
  if(f.parameterVersion)html+=`<p class="pq-source">带载/宽高参数版次：${esc(f.parameterVersion)}</p>`;
  if(f.notice)html+=`<p class="pq-notice">${esc(f.notice)}</p>`;
  for(const s of f.sources||[])if(/^\/v2\/offline\/preview\?id=\d+$/.test(s.url||'')&&Number.isInteger(s.row))html+=`<p class="pq-source">参数来源：<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} · ${esc(s.sheet)} · 第${s.row}行</a></p>`;
  return html;
 }
 return {layout,render};
});
