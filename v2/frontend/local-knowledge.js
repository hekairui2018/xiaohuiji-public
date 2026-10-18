// Local-only enhancement of the existing /wiki and /huiai pages.
window.LocalKnowledgeClient = Object.freeze({create(ui) {
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const style=make('style');style.textContent='.local-tools{padding:10px;border:1px solid #cad6e0;margin:10px 0;border-radius:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.local-tools select,.local-tools button{font:inherit;padding:5px}.local-evidence{white-space:pre-wrap;padding:8px;border-left:3px solid #7996b2;margin:8px 0}.local-evidence pre{white-space:pre-wrap;max-height:320px;overflow:auto}';document.head.append(style);
 let session=crypto.randomUUID();window.__localSession=session;
 const bar=make('div');bar.className='local-tools';
 const mode=make('select');mode.id='localAnswerMode';for(const [value,label] of [['rules','原有二代功能'],['hybrid','27B自主检索 A'],['complete','完整原文对照 B']]){const o=make('option',label);o.value=value;mode.append(o);}
 const cases=make('select');cases.id='localEvidenceCase';cases.append(make('option','选择固定对照题'));
 const offline=make('input');offline.type='checkbox';offline.id='localModelOff';const ol=make('label','断开本客户端模型连接');ol.prepend(offline);
 const newClient=make('button','新会话');newClient.id='localNewSession';newClient.type='button';newClient.onclick=()=>{session=crypto.randomUUID();window.__localSession=session;window.__localLastReply=null;ui.setSessionId("w-"+crypto.randomUUID());ui.resetState();document.getElementById('aiMessages').replaceChildren();};
 bar.append(make('span','本机验证'),mode,cases,ol,newClient);document.querySelector('.ai-input-row').before(bar);
 fetch('/v2/local-knowledge/cases').then(r=>r.json()).then(r=>{for(const c of r.cases||[]){const o=make('option',c.id+' · '+c.question);o.value=c.id;o.dataset.question=c.question;cases.append(o);}});
 cases.onchange=()=>{const o=cases.selectedOptions[0];if(o.dataset.question)document.getElementById('aiInput').value=o.dataset.question;};
 const originalFetch=window.fetch.bind(window);
 async function request(body){
  const headers={'Content-Type':'application/json'};
  if(mode.value!=='rules'){body={...body,localMode:mode.value,localSession:session,localRunId:window.__localNextRunId||'ui-'+crypto.randomUUID(),modelDisabled:offline.checked};window.__localNextRunId=null;if(mode.value==='complete')body.evidenceCase=cases.value;headers['X-V2-Local-Knowledge']='1';}
  return originalFetch('/api/ai/chat',{method:'POST',headers,body:JSON.stringify(body)}).then(r=>r.json());
 }
 async function readSource(source,target){
  target.textContent='读取原文…';try{const r=await originalFetch(source.readUrl).then(r=>r.json());target.textContent=(r.blocks||[]).map(b=>JSON.stringify(b.locator)+'\n'+b.text).join('\n\n');window.__localLastRead=r;}catch{target.textContent='原文暂不可读。';}
 }
 function render(data){
  if(data.model!=='bonsai-local-tools'&&!data.error)return false;
  window.__localLastReply=data;const row=make('div');row.className='ai-msg ai-msg-assistant';const bubble=make('div');bubble.className='ai-msg-bubble';bubble.append(make('div',data.reply||'本地服务暂不可用。'));
  for(const f of data.localFiles||[]){const a=make('a','查看原件：'+f.name);a.href=f.url;a.target='_blank';bubble.append(a,make('br'));}
  for(const s of data.localSources||[]){const d=make('details');d.className='local-evidence';d.append(make('summary',s.sourceName+' · '+s.evidenceId+' · '+JSON.stringify(s.locator)),make('pre',s.text));const b=make('button','继续阅读原文');b.type='button';const more=make('pre');b.onclick=()=>readSource(s,more);d.append(b,more);bubble.append(d);}
  const debug=make('details');debug.append(make('summary','本地调用轨迹'),make('pre',JSON.stringify(data.localTrace||{error:data.error},null,2)));bubble.append(debug);row.append(bubble);document.getElementById('aiMessages').append(row);return true;
 };
 // An explicit search-source selector, not an intent classifier or chat route.
 const source=make('select');source.id='localSearchMode';for(const [v,t] of [['legacy','原有产品速查'],['all','本地文件＋正文'],['files','本地文件目录'],['text','本地正文']]){const o=make('option',t);o.value=v;source.append(o);}
 document.getElementById('quickSearchInput').before(source);
 const search=async()=>{
  const q=document.getElementById('quickSearchInput').value.trim(),out=document.getElementById('searchResults');out.style.display='block';out.replaceChildren(make('p','原文检索中…'));
  try{const r=await originalFetch('/v2/local-knowledge/search?q='+encodeURIComponent(q)+'&mode='+source.value).then(r=>r.json());window.__localLastSearch=r;out.replaceChildren(make('p',(r.results||[]).length+' 条 · '+r.elapsedMs+' ms · 不使用模型'));
   for(const s of r.results||[]){const box=make('article');box.className='local-evidence';box.append(make('strong',s.name),make('div',(s.versions||[]).join(', ')+' · '+JSON.stringify(s.locator)),make('pre',s.text));if(s.download){const a=make('a','原文件');a.href=s.download;a.target='_blank';box.append(a);}if(s.blockId){const b=make('button','继续阅读原文'),more=make('pre');b.type='button';b.onclick=()=>readSource({readUrl:'/v2/local-knowledge/read?block='+s.blockId},more);box.append(b,more);}out.append(box);}
  }catch{out.replaceChildren(make('p','资料服务暂不可用，仍可选择原有产品速查。'));}
 };
 document.getElementById('quickSearchBtn').addEventListener('click',e=>{if(source.value==='legacy')return;e.preventDefault();e.stopImmediatePropagation();search();},true);
 document.getElementById('quickSearchInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&source.value!=='legacy'){e.preventDefault();e.stopImmediatePropagation();search();}},true);
 return {request,render,legacy:true};
}});
