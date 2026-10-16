'use strict';
// Existing client interaction only; no frontend changes and no embedded records.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const work=path.resolve(process.argv[2]),fixture=JSON.parse(fs.readFileSync(path.join(work,'client-controls.json'),'utf8'));
const pause=ms=>new Promise(r=>setTimeout(r,ms)),save=(n,v)=>fs.writeFileSync(path.join(work,n),JSON.stringify(v,null,2));
(async()=>{
 const log=fs.openSync(path.join(work,'stage7-browser.log'),'a');
 const browser=spawn(process.env.XHJ_BROWSER||'msedge',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9237','--user-data-dir='+path.join(work,'browser-profile'),'http://127.0.0.1:4499/quick'],{windowsHide:true,stdio:['ignore',log,log]});
 let ws;
 try{
  let tabs=[];for(let i=0;i<60;i++){try{tabs=await(await fetch('http://127.0.0.1:9237/json/list')).json();if(tabs.some(t=>t.url.includes(':4499/quick')))break;}catch{}await pause(250);}
  const tab=tabs.find(t=>t.url.includes(':4499/quick'));if(!tab)throw Error('existing client not opened');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let next=0;const pending=new Map(),errors=[];
  ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id&&pending.has(v.id)){pending.get(v.id)(v);pending.delete(v.id);}if(v.method==='Runtime.exceptionThrown')errors.push(v.params);};
  const cdp=(method,params={})=>new Promise(r=>{const id=++next;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
  const wait=async expression=>{for(let n=0;n<800;n++){const v=await evaluate(expression);if(v)return v;await pause(250);}throw Error('client timeout');};
  await cdp('Runtime.enable');await wait("!!document.getElementById('localSearchMode')");
  await evaluate(`window.__localLastSearch=null;document.getElementById('localSearchMode').value='files';document.getElementById('quickSearchInput').value=${JSON.stringify(fixture.fileQuery)};document.getElementById('quickSearchBtn').click()`);
  const direct=await wait('window.__localLastSearch');
  await cdp('Page.navigate',{url:'http://127.0.0.1:4499/huiai'});await wait("!!document.getElementById('localAnswerMode')");
  const replies=[];
  for(let i=0;i<fixture.uiQuestions.length;i++){
   await evaluate(`${i===0?"document.getElementById('localNewSession').click();":''}document.getElementById('localAnswerMode').value='hybrid';window.__localNextRunId='p7-browser-'+${i};window.__localLastReply=null;document.getElementById('aiInput').value=${JSON.stringify(fixture.uiQuestions[i])};document.getElementById('aiSendBtn').click()`);
   const r=await wait('window.__localLastReply');r.visibleAnswer=await evaluate("document.querySelector('#aiMessages .ai-msg-assistant:last-child')?.innerText");replies.push(r);
  }
  await evaluate("window.__localLastRead=null;const d=document.querySelector('#aiMessages .local-evidence');if(d){d.open=true;d.querySelector('button').click()}");
  const read=await wait('window.__localLastRead');
  const reset=await evaluate("(()=>{document.getElementById('localNewSession').click();return {emptyMessages:!document.getElementById('aiMessages').children.length,emptyHistory:chatHistory.length===0}})()");
  await evaluate("document.getElementById('localModelOff').checked=true;window.__localLastReply=null;document.getElementById('aiInput').value='本地模型断开检查';document.getElementById('aiSendBtn').click()");
  const offline=await wait('window.__localLastReply');
  await cdp('Page.navigate',{url:'http://127.0.0.1:4499/quick'});await wait("!!document.getElementById('localSearchMode')");
  await evaluate(`window.__localLastSearch=null;document.getElementById('localSearchMode').value='files';document.getElementById('quickSearchInput').value=${JSON.stringify(fixture.fileQuery)};document.getElementById('quickSearchBtn').click()`);
  const offlineSearch=await wait('window.__localLastSearch');
  save('client-browser.json',{direct,replies,read,reset,offline,offlineSearch,consoleErrors:errors,physicalModelShutdown:false,existingClient:true});
  await cdp('Browser.close');console.log('Existing /quick and /huiai: actual click, two turns, source read, reset and transport-off search recorded.');
 }finally{if(ws)ws.close();browser.kill();fs.closeSync(log);}
})().catch(e=>{console.error(e);process.exitCode=1;});
