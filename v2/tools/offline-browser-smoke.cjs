'use strict';
// Actual existing-client controls; no customer fixture, model or cloud calls.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const work=path.resolve(process.argv[2]||'tmp/v2-offline-browser'),base=process.env.XHJ_TRIAL_BASE||'http://127.0.0.1:4520';
fs.mkdirSync(work,{recursive:true});const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const fd=fs.openSync(path.join(work,'browser-launch.log'),'a');
 const browser=spawn(process.env.XHJ_BROWSER||'msedge',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9239','--user-data-dir='+path.join(work,'profile-'+Date.now()),base+'/quick'],{windowsHide:true,stdio:['ignore',fd,fd]});let ws;
 try{
  let tabs;for(let n=0;n<60;n++){try{tabs=await fetch('http://127.0.0.1:9239/json/list').then(r=>r.json());if(tabs.some(t=>t.url===base+'/quick'))break;}catch{}await pause(150);}
  const tab=tabs.find(t=>t.url===base+'/quick');ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('browser connection timeout')),10000);ws.onopen=()=>{clearTimeout(timer);r();};ws.onerror=j;});
  let serial=0;const pending=new Map(),requests=[],exceptions=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);else if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('browser command timeout: '+method));},15000);pending.set(id,m=>{clearTimeout(timer);resolve(m);});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const wait=async expression=>{for(let n=0;n<160;n++){const r=await evaluate(expression);if(r)return r;await pause(150);}throw Error('UI timeout: '+expression);};
  await call('Network.enable');await call('Runtime.enable');await wait("!!document.getElementById('v2SearchMode')");
  await evaluate("document.getElementById('v2SearchMode').value='files';document.getElementById('quickSearchInput').value='A3L规格书';document.getElementById('quickSearchBtn').click()");
  const files=await wait('window.__v2LastSearch');assert.ok(files.results.some(x=>x.name.includes('A3L')));
  const file=files.results.find(x=>/\.pdf$/i.test(x.name));assert.ok(file?.download);const pdf=await fetch(base+file.download);assert.equal(pdf.status,200);assert.ok((await pdf.arrayBuffer()).byteLength>1000);
  await evaluate("window.__v2LastSearch=null;document.getElementById('v2SearchMode').value='text';document.getElementById('quickSearchInput').value='图片连续左移';document.getElementById('quickSearchBtn').click()");
  const text=await wait('window.__v2LastSearch');assert.ok(text.results.some(r=>r.text));await evaluate("document.querySelector('#searchResults .v2-record button').click()");const read=await wait('window.__v2LastRead');assert.ok(read.blocks.length);
  await call('Page.navigate',{url:base+'/huiai'});await wait("!!document.getElementById('v2WorkMode')");
  await evaluate("document.getElementById('v2WorkMode').value='cases';document.getElementById('v2WorkMode').onchange();document.getElementById('aiInput').value='水波纹';document.getElementById('aiSendBtn').click()");
  const cases=await wait('window.__v2LastReply');assert.equal(cases.kind,'cases');assert.ok(cases.results.length);assert.ok(cases.results.every(r=>r.referenceOnly));
  const caseImage=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(work,'history-cases.png'),Buffer.from(caseImage.result.data,'base64'));
  await evaluate("window.__v2LastReply=null;document.getElementById('v2WorkMode').value='ordering';document.getElementById('v2WorkMode').onchange();document.getElementById('aiInput').value='配单 P2 模组160x80 40扫 HUB75 全彩 室内 同步接收卡 10宽8高 R716';document.getElementById('aiSendBtn').click()");
  await wait("[...document.querySelectorAll('#aiMessages button')].some(b=>b.textContent.includes('下载 HDSet'))");
  const orderVisible=await evaluate("document.querySelector('#aiMessages .ai-msg-assistant:last-child').innerText");assert.ok(orderVisible.includes('接收卡'));
  await evaluate("document.getElementById('v2WorkMode').value='all';document.getElementById('v2WorkMode').onchange();const c=document.createElement('canvas');c.width=700;c.height=160;const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,700,160);g.fillStyle='black';g.font='48px SimSun';g.fillText('A3L 规格书',30,90);window.sendImageMessage(c.toDataURL('image/png'))");
  const ocr=await wait('window.__v2LastOCR');assert.ok(ocr.ok&&ocr.text.includes('A3L'),JSON.stringify(ocr));await wait('window.__v2LastReply');
  await evaluate("document.getElementById('v2NewQuery').click()");assert.equal(await evaluate("document.getElementById('aiMessages').children.length"),0);
  const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(work,'client.png'),Buffer.from(screenshot.result.data,'base64'));
  assert.equal(requests.some(u=>/:8080|:4512|open\.feishu/.test(u)),false);
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  const result={quickFileSearch:true,actualPdfDownload:true,bodySearch:true,originalContextRead:true,historyCases:true,caseConditionsVisible:true,orderingBOMAndSSMButton:true,localImageOCR:true,ocrText:ocr.text,newSession:true,modelRequests:0,unhandledBrowserErrors:exceptions.length,requestCount:requests.length};
  fs.writeFileSync(path.join(work,'browser-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{ws?.close();browser.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
