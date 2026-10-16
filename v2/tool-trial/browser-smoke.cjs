'use strict';
// One local UI interaction, no model or new knowledge processing.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const work=path.resolve(__dirname,'../../tmp/tool-trial-stage4-20261016');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const err=fs.openSync(path.join(work,'browser-launch.log'),'a');
 const browser=spawn(process.env.XHJ_BROWSER || 'msedge',[
  '--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9234',
  '--user-data-dir='+path.join(work,'browser-profile'),'http://127.0.0.1:4512/'
 ],{windowsHide:true,stdio:['ignore',err,err]});
 let ws;
 try {
  let tabs;
  for(let i=0;i<40;i++){try{tabs=await (await fetch('http://127.0.0.1:9234/json/list')).json();if(tabs.some(t=>t.url==='http://127.0.0.1:4512/'))break;}catch{}await pause(250);}
  const tab=(tabs||[]).find(t=>t.url==='http://127.0.0.1:4512/');
  if(!tab)throw Error('trial tab unavailable');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let next=0;const pending=new Map();ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id&&pending.has(v.id)){pending.get(v.id)(v);pending.delete(v.id);}};
  const call=(method,params={})=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
  await pause(400);
  await call('Runtime.evaluate',{expression:`document.querySelector('#q').value='A3L规格书';document.querySelector('#go').click();`});
  let result;
  for(let i=0;i<40;i++){
   await pause(200);const v=await call('Runtime.evaluate',{expression:`JSON.stringify({status:document.querySelector('#status').textContent,output:document.querySelector('#out').textContent,links:[...document.querySelectorAll('#links a')].map(a=>({name:a.textContent,href:a.getAttribute('href')}))})`,returnByValue:true});
   result=JSON.parse(v.result.result.value);if(result.status==='只读检索完成')break;
  }
  if(!result.links.some(a=>a.name.includes('A3L')&&a.href.startsWith('/download?')))throw Error('real search button did not produce expected source download');
  await call('Runtime.evaluate',{expression:`document.querySelector('#new').click()`});
  const n=await call('Runtime.evaluate',{expression:`document.querySelector('#out').textContent`,returnByValue:true});
  const evidence={mode:'real headless Edge DOM interaction, local only, no model',...result,newCustomerButton:n.result.result.value==='已新建独立会话',modelCalls:0};
  fs.writeFileSync(path.join(work,'browser-smoke.json'),JSON.stringify(evidence,null,2));
  const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(work,'trial-ui.png'),Buffer.from(screenshot.result.data,'base64'));
  await call('Browser.close');console.log(JSON.stringify({searchPassed:true,newCustomerPassed:evidence.newCustomerButton}));
 } finally {if(ws)ws.close();browser.kill();fs.closeSync(err);}
})().catch(e=>{console.error(e);process.exitCode=1;});
