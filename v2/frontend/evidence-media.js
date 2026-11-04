(() => {
 'use strict';
 const safe=url=>typeof url==='string'&&(/^\/(?!\/)/.test(url)||/^https?:\/\//i.test(url));
 function open(url,caption){
  if(!safe(url)&&!/^data:image\/(?:svg\+xml;charset=utf-8,|png;base64,|jpeg;base64,)/.test(url||''))return;
  const dialog=document.createElement('dialog');dialog.className='v2-image-preview';dialog.setAttribute('aria-label',caption||'图片预览');
  const head=document.createElement('header'),label=document.createElement('span');label.textContent=caption||'图片预览';head.append(label);
  const viewport=document.createElement('div');viewport.className='v2-image-viewport';const img=document.createElement('img');img.src=url;img.alt=caption||'原图';viewport.append(img);let scale=1;
  const apply=()=>{img.style.transform='scale('+scale+')';img.style.transformOrigin='center';},control=(text,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;head.append(b);};
  control('−',()=>{scale=Math.max(.5,scale/1.3);apply();});control('+',()=>{scale=Math.min(6,scale*1.3);apply();});control('复位',()=>{scale=1;apply();viewport.scrollTo(0,0);});control('关闭',()=>dialog.close());
  let drag;viewport.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(e.pointerId);});viewport.addEventListener('pointermove',e=>{if(drag){viewport.scrollLeft=drag.left-(e.clientX-drag.x);viewport.scrollTop=drag.top-(e.clientY-drag.y);}});viewport.addEventListener('pointerup',()=>{drag=null;});viewport.addEventListener('pointercancel',()=>{drag=null;});
  dialog.append(head,viewport);dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
 }
 function render(container,data){
  const sources=[...(data.results||[]).filter(r=>!r.resourceOnly),...(data.caseCards||[]).map(c=>({...c,name:c.sourceName,previewUrl:c.preview}))];const seen=new Set();
  for(const s of sources){const assets=[...(s.assets||[]),...(s.images||[])].filter(a=>a&&safe(a.url||a.src)&&!a.decorative);if(!assets.length)continue;
   const group=document.createElement('section');group.className='v2-evidence-images';const unique=assets.filter(a=>{const key=a.sha256||a.url||a.src;if(seen.has(key))return false;seen.add(key);return true;});
   // Preserve the existing source relation; no search by filename or cross-source image guesses.
   const compact=unique.reduce((sum,a)=>sum+(a.width&&a.height?Math.min(170,210*a.height/a.width):150),0)<=380;
   const chosen=compact?unique:unique.slice(0,1);
   for(const asset of chosen){const figure=document.createElement('figure'),b=document.createElement('button'),img=document.createElement('img'),caption=document.createElement('figcaption');const text=[s.name||s.title,asset.caption||asset.locator].filter(Boolean).join(' · ');b.type='button';b.title='点击查看大图';img.src=asset.url||asset.src;img.alt=text||'原文配图';img.loading='lazy';img.referrerPolicy='same-origin';b.append(img);b.onclick=()=>open(img.src,text);caption.textContent=text;figure.append(b,caption);group.append(figure);}
   if(unique.length>chosen.length){const a=document.createElement('a'),url=s.previewUrl||s.preview||s.download;if(safe(url)){a.href=url;a.target='_blank';a.rel='noopener';a.textContent='查看完整原文与配图';group.append(a);}}
   if(group.childNodes.length)container.append(group);
  }
 }
 window.EvidenceMedia={open,render};
})();
