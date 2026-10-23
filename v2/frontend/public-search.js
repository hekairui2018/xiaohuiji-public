'use strict';
// Same search work area; public filenames/directories and verified paragraphs only.
(()=>{
 if(document.body.dataset.audience!=='public')return;
 const el=id=>document.getElementById(id),button=el('quickMoreDocsBtn'),product=el('quickProductTitle'),input=el('quickSearchInput'),submit=el('quickSearchBtn'),results=el('searchResults');
 if(!button)return;let enabled=false,generation=0,timer,request;
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const setMode=on=>{enabled=on;generation++;clearTimeout(timer);request?.abort();button.setAttribute('aria-pressed',String(on));product.setAttribute('aria-pressed',String(!on));
  el('quickCats').hidden=on;el('quickExamples').hidden=on;el('resourceSearchTitle').textContent=on?'全文搜索':'产品速查';el('resourceSearchHint').textContent=on?'搜索公网目录、文件名和原文；命中参数句、操作段落时显示上下文。':'输入产品型号，查参数、规格书、说明书、软件、固件和操作视频。';input.placeholder=on?'搜索公网文件名、型号、正文…':'输入产品型号或资料关键词';};
 const card=r=>{const item=make('article');item.className='public-evidence-result';const title=make('a',r.name);title.href=r.download;title.target='_blank';title.rel='noopener';item.append(title,make('small',[r.directory,r.location].filter(Boolean).join(' · ')));
  if(r.text){const context=make('pre',r.text);context.className='public-evidence-context';item.append(context);
   if(r.nextOffset!==null&&r.nextOffset!==undefined){const more=make('button','继续阅读此段');more.type='button';more.onclick=async()=>{more.disabled=true;try{const p=new URLSearchParams({name:r.name,sha256:r.contextKey,id:r.contextId,offset:String(r.nextOffset)}),res=await fetch('/api/public-context?'+p);if(!res.ok)throw Error();const data=(await res.json()).result;context.textContent+='\n'+data.text;r.nextOffset=data.nextOffset;more.hidden=r.nextOffset===null;}catch{more.textContent='读取失败，点击重试';}finally{more.disabled=false;}};item.append(more);}
  }else item.append(make('p','文件名称与登记信息；未解析文件正文。'));
  if(r.visualContextRequired)item.append(make('small','此操作含界面图片，请结合原文预览。'));
  return item;};
 async function search(){if(!enabled)return;const query=input.value.trim(),current=++generation;request?.abort();results.style.display='block';results.replaceChildren(make('p',query?'正在检索公网原文…':'输入文件名、目录或正文关键词。'));if(!query)return;
  request=new AbortController();try{const res=await fetch('/api/public-search?q='+encodeURIComponent(query),{signal:request.signal});if(!res.ok)throw Error();const data=await res.json();if(current!==generation||!enabled)return;results.replaceChildren(make('p',data.results.length+' 份资料 · '+data.elapsedMs+' ms'));if(!data.results.length)results.append(make('p','公网资料中没有找到相关内容。'));for(const r of data.results)results.append(card(r));}catch(e){if(e.name!=='AbortError'&&current===generation)results.replaceChildren(make('p','检索暂不可用，请重试。'));}
 }
 button.addEventListener('click',e=>{e.stopImmediatePropagation();window.FrontendApp?.catalog.invalidate();setMode(true);search();},true);
 product.addEventListener('click',()=>setMode(false),true);
 input.addEventListener('input',e=>{if(!enabled)return;e.stopImmediatePropagation();clearTimeout(timer);timer=setTimeout(search,180);},true);
 input.addEventListener('keydown',e=>{if(enabled&&e.key==='Enter'&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();search();}},true);
 submit.addEventListener('click',e=>{if(enabled){e.preventDefault();e.stopImmediatePropagation();search();}},true);
})();
