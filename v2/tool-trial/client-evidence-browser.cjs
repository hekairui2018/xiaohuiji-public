'use strict';
// Drive the existing two-entry client. No replacement HTML/demo client.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const work=process.env.XHJ_EXPERIMENT_WORK?path.resolve(process.env.XHJ_EXPERIMENT_WORK):path.resolve(__dirname,'../../tmp/client-evidence-stage5-20261016'),runPrefix=process.env.XHJ_EXPERIMENT_PREFIX||'p5',pause=ms=>new Promise(r=>setTimeout(r,ms));
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2));};
(async()=>{
 const log=fs.openSync(path.join(work,'browser-launch.log'),'a');
 const browser=spawn(process.env.XHJ_BROWSER || 'msedge',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9235','--user-data-dir='+path.join(work,'browser-profile'),'http://127.0.0.1:4499/quick'],{windowsHide:true,stdio:['ignore',log,log]});
 let ws;
 try{
  let tabs=[];for(let i=0;i<60;i++){try{tabs=await(await fetch('http://127.0.0.1:9235/json/list')).json();if(tabs.some(t=>t.url.includes(':4499/quick')))break;}catch{}await pause(250);}
  const tab=tabs.find(t=>t.url.includes(':4499/quick'));if(!tab)throw Error('existing client not opened');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  const pending=new Map();let next=0;const errors=[];ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id&&pending.has(v.id)){pending.get(v.id)(v);pending.delete(v.id);}if(v.method==='Runtime.exceptionThrown')errors.push(v.params);};
  const cdp=(method,params={})=>new Promise(r=>{const id=++next;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async(expression)=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
  const wait=async(expression,seconds=160)=>{for(let n=0;n<seconds*4;n++){const v=await evaluate(expression);if(v)return v;await pause(250);}throw Error('client timeout: '+expression);};
  await cdp('Runtime.enable');await wait("!!document.getElementById('localSearchMode')");
  const direct=[];
  async function search(q,mode){await evaluate(`window.__localLastSearch=null;document.getElementById('localSearchMode').value=${JSON.stringify(mode)};document.getElementById('quickSearchInput').value=${JSON.stringify(q)};document.getElementById('quickSearchBtn').click()`);return wait('window.__localLastSearch');}
  if(process.argv.includes('--offline')){
   await cdp('Page.navigate',{url:'http://127.0.0.1:4499/huiai'});await wait("!!document.getElementById('localAnswerMode')");
   await evaluate("document.getElementById('localAnswerMode').value='hybrid';document.getElementById('aiInput').value='模型连接失败测试';document.getElementById('aiSendBtn').click()");
   const failed=await wait('window.__localLastReply');if(failed.error!=='local-upstream-unavailable')throw Error('expected genuinely unavailable AI backend');
   await evaluate("document.querySelector('.vs-btn[data-view=quick]').click()");
   const retrieved=await search('HD-A3L规格书 V1.1','files');if(!retrieved.results.length)throw Error('quick failed without AI backend');
   const file=await evaluate(`(async()=>{const a=document.querySelector('#searchResults article a');const r=await fetch(a.getAttribute('href'));const b=await r.arrayBuffer();return {url:a.getAttribute('href'),status:r.status,bytes:b.byteLength,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('')}})()`);
   await evaluate("document.getElementById('localSearchMode').value='legacy';document.getElementById('quickSearchInput').value='A3L';document.getElementById('quickSearchBtn').click()");await wait("document.getElementById('searchResults').innerText.includes('A3L')");
   save(path.join(work,'client-backend-disconnected.json'),{method:'actual tool/model orchestration process 4512 stopped; shared model 8080 NOT stopped',failed,retrieved,file,originalQuickStillWorks:true,physicalBonsaiShutdownTested:false});
   await cdp('Browser.close');console.log('real AI-backend disconnection and both quick paths passed');return;
  }
  if(process.argv.includes('--links')){
   await cdp('Page.navigate',{url:'http://127.0.0.1:4499/huiai'});await wait("!!document.getElementById('localAnswerMode')");
   const reset=await evaluate("(()=>{chatHistory=[{role:'user',content:'UI reset fixture, not a real customer'}];const sid=localStorage.getItem('xhj_sid');document.getElementById('localNewSession').click();return {historyEmpty:chatHistory.length===0,clientIdChanged:localStorage.getItem('xhj_sid')!==sid}})()");if(!reset.historyEmpty||!reset.clientIdChanged)throw Error('new customer did not reset existing client state');
   async function replay(id){const r=JSON.parse(fs.readFileSync(path.join(work,'results',id+'.json'),'utf8')),old=r.B.localTrace;const body={message:r.question,localSession:old.session,localMode:'complete',evidenceCase:id,localRunId:old.runId};return evaluate(`(async()=>{const r=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json','X-V2-Local-Knowledge':'1'},body:${JSON.stringify(JSON.stringify(body))}}).then(r=>r.json());window.addAssistantMessage(r);return r})()`);}
   await replay('S08');await evaluate("window.__localLastRead=null;const d=document.querySelector('#aiMessages .local-evidence');d.open=true;d.querySelector('button').click()");const read=await wait('window.__localLastRead');
   const data=await replay('L02');if(!data.localFiles?.length)throw Error('model document source link not rendered');
   const link=data.localFiles[0].url;const file=await evaluate(`(async()=>{const r=await fetch(${JSON.stringify(link)});const b=await r.arrayBuffer();return {status:r.status,bytes:b.byteLength,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('')}})()`);
   if(file.status!==200)throw Error('model source download failed');
   const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(work,'chat-source-read.png'),Buffer.from(shot.result.data,'base64'));
   save(path.join(work,'client-fixed-links.json'),{cacheReplayOnly:true,modelCallsAdded:0,newClientStateReset:reset,chatSourceRead:read,modelFileURL:link,file});
   await cdp('Browser.close');console.log('cached original model answer citation/read/download checked in existing client');return;
  }
  for(const [q,m] of [['HD-A3L规格书 V1.1','files'],['HDPlayer.3.9.209.7','files'],['word 连续左移 43','text'],['3566S pwm 更严重','text']]){const r=await search(q,m);direct.push({question:q,mode:m,result:r});}
  await evaluate("window.__localLastRead=null;document.querySelector('#searchResults button')?.click()");const read=await wait('window.__localLastRead');save(path.join(work,'client-direct-search.json'),{queries:direct,read,throughExistingQuick:true});
  await cdp('Page.navigate',{url:'http://127.0.0.1:4499/huiai'});await wait("document.getElementById('localEvidenceCase')?.options.length>1");
  const cases=JSON.parse(fs.readFileSync(path.join(work,'cases.json'),'utf8'));
  async function ask(q,id,mode,caseId,reset=true){
   await evaluate(`${reset?"document.getElementById('localNewSession').click();":''}document.getElementById('localAnswerMode').value=${JSON.stringify(mode)};document.getElementById('localEvidenceCase').value=${JSON.stringify(caseId||'')};window.__localNextRunId=${JSON.stringify(id)};window.__localLastReply=null;document.getElementById('aiInput').value=${JSON.stringify(q)};document.getElementById('aiSendBtn').click()`);
   const r=await wait('window.__localLastReply',220);if(!r.localTrace)throw Error('tool backend failed: '+JSON.stringify(r));
   r.clientDOM=await evaluate("document.querySelector('#aiMessages .ai-msg-assistant:last-child')?.innerText");return r;
  }
  fs.mkdirSync(path.join(work,'results'),{recursive:true});
  for(const t of cases){
   const target=path.join(work,'results',t.id+'.json');if(fs.existsSync(target))continue;
   const A=await ask(t.question,runPrefix+'-A-'+t.id,'hybrid',t.id),B=await ask(t.question,runPrefix+'-B-'+t.id,'complete',t.id);
   save(target,{id:t.id,split:t.split,question:t.question,A,B,client:'actual /huiai existing input and send button'});
   console.log(JSON.stringify({id:t.id,A:A.localTrace.seconds,B:B.localTrace.seconds,Aanswer:A.reply,Banswer:B.reply}),true);
  }
  const prior=JSON.parse(fs.readFileSync(path.join(work,'../tool-trial-stage4-20261016/questions.json'),'utf8'));
  const multi=[];for(const [i,id] of ['MA1','MA2','MA3'].entries()){const q=prior.find(q=>q.id===id).question;multi.push(await ask(q,runPrefix+'-multi-'+i,'hybrid',null,i===0));}
  const other=await ask('加了开机画面，重启后黑了。',runPrefix+'-other-customer','hybrid',null,true);
  const absent=await ask('XYZ999999控制卡有什么官方规格和固件兼容记录？',runPrefix+'-missing','hybrid',null,true);
  save(path.join(work,'client-multi-and-missing.json'),{multi,other,absent});
  await evaluate("document.getElementById('localModelOff').checked=true;window.__localLastReply=null;document.getElementById('aiInput').value='模型离线检查';document.getElementById('aiSendBtn').click()");
  const off=await wait('window.__localLastReply');
  await cdp('Page.navigate',{url:'http://127.0.0.1:4499/quick'});await wait("!!document.getElementById('localSearchMode')");
  const offlineSearch=await search('HD-A3L规格书 V1.1','files');
  save(path.join(work,'client-offline.json'),{method:'client model transport deliberately disabled; shared 8080 inference process NOT stopped',off,offlineSearch,notPhysicalModelShutdown:true});
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(work,'existing-client.png'),Buffer.from(shot.result.data,'base64'));
  save(path.join(work,'client-browser-summary.json'),{existingPages:['/quick','/huiai'],pairedQuestions:cases.length,directQueries:4,multiTurns:3,independentSecondCustomer:true,sourceRead:!!read.blocks?.length,offlineSearch:!!offlineSearch.results?.length,consoleExceptions:errors,finished:true});
  await cdp('Browser.close');console.log('actual client experiment complete');
 }finally{if(ws)ws.close();browser.kill();fs.closeSync(log);}
})().catch(e=>{console.error(e);process.exitCode=1;});
