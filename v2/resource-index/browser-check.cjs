'use strict';
const fs=require('node:fs'),path=require('node:path');
async function main(){
 const dir=path.resolve('tmp/resource-index-stage1-20261016');
 let tab;for(let i=0;i<25;i++){try{tab=await(await fetch('http://127.0.0.1:9521/json/new?about:blank',{method:'PUT'})).json();break;}catch{await new Promise(r=>setTimeout(r,200));}}if(!tab)throw Error('Candidate browser did not start');
 const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[],requests=[];let seq=0;
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(Error('CDP timeout'));}},10000).unref();});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const wait=async expression=>{for(let i=0;i<50;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200));}throw Error('DOM condition failed');};
 const results=[];
 try{
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:4510/'});await wait("document.readyState==='complete'&&!!document.getElementById('form')");
  await evaluate("document.getElementById('q').value='A3L规格书';document.getElementById('mode').value='files';document.getElementById('form').requestSubmit()");await wait("document.querySelectorAll('article').length>0");
  const first=await evaluate("document.querySelector('article').innerText");results.push({test:'file-search-real-DOM',passed:first.includes('A3L')&&first.includes('规格书'),text:first.slice(0,500)});
  await evaluate("document.getElementById('q').value='预览窗口不显示 RGB';document.getElementById('mode').value='text';document.getElementById('form').requestSubmit()");await wait("document.querySelector('article pre')?.textContent.includes('RGB')");
  await evaluate("document.querySelector('article button').click()");await wait("!document.getElementById('detail').hidden&&document.querySelector('#detail pre')");
  const detail=await evaluate("document.getElementById('detail').innerText");results.push({test:'text-evidence-and-read-more-real-DOM',passed:detail.includes('RGB')&&detail.includes('原始记录第'),text:detail.slice(0,1000)});
  fs.writeFileSync(path.join(dir,'search-preview.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const receipt={results,errors,requests,onlyLocalRequests:requests.every(url=>url.startsWith('http://127.0.0.1:4510/')||url==='about:blank')};fs.writeFileSync(path.join(dir,'browser-acceptance.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  if(errors.length||results.some(r=>!r.passed)||!receipt.onlyLocalRequests)process.exitCode=1;
 }finally{await send('Page.close');ws.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
