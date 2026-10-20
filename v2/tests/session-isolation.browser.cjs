'use strict';
const assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require('../../tmp/feishu-browser-runtime/driver/package');
const {serveStatic}=require('../adapters/http/static-service.cjs');
const seen=[];
const api=require('../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({expert:{status:async()=>({available:true,model:'test'}),answer:async({message,sessionState})=>{
 seen.push({message,id:sessionState.id,history:structuredClone(sessionState.messages)});
 return {status:'answer',actualMode:'expert',reply:'收到 '+message,results:[]};
}}});
const server=http.createServer(async(req,res)=>{try{if(serveStatic(req,res,undefined,{offlineKnowledge:true}))return;if(await api.handle(req,res))return;res.setHeader('Content-Type','application/json');res.end('{}');}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}});
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const legacy=await browser.newContext();await legacy.addInitScript(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined});});
  const prior=require('node:child_process').execFileSync('git',['show','HEAD:v2/frontend/conversation-client.js'],{encoding:'utf8'});
  await legacy.route('**/conversation-client.js*',r=>r.fulfill({contentType:'application/javascript',body:prior}));
  const oldPage=await legacy.newPage(),oldErrors=[];oldPage.on('pageerror',e=>oldErrors.push(e.message));await oldPage.goto('http://127.0.0.1:'+server.address().port+'/huiai');
  assert.ok(oldErrors.some(e=>/randomUUID/.test(e)));assert.equal(await oldPage.evaluate(()=>!!window.v2Conversations),false);await legacy.close();
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
  for(const c of contexts)await c.addInitScript(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined});});
  const pages=await Promise.all(contexts.map(c=>c.newPage())),errors=[];pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
  await Promise.all(pages.map(p=>p.goto('http://127.0.0.1:'+server.address().port+'/huiai')));
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.v2Conversations&&window.__v2SessionId)));
  const ids=await Promise.all(pages.map(p=>p.evaluate(()=>window.__v2SessionId)));assert.notEqual(ids[0],ids[1]);
  await Promise.all(pages.map((p,i)=>p.evaluate(async i=>{await FrontendApp.chat.send('client-'+i);},i)));
  assert.equal(seen.length,2);for(let i=0;i<2;i++){const r=seen.find(r=>r.message==='client-'+i);assert.equal(r.id,ids[i]);assert.equal(r.history.length,1);}
  await pages[0].reload();await pages[0].waitForFunction(()=>window.v2Conversations);assert.equal(await pages[0].evaluate(()=>window.__v2SessionId),ids[0]);
  await pages[0].evaluate(()=>window.v2Conversations.startTemporary());const guest=await pages[0].evaluate(()=>window.__v2SessionId);assert.notEqual(guest,ids[0]);
  await pages[0].evaluate(()=>FrontendApp.chat.send('guest-only'));assert.equal(seen.at(-1).history.length,1);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,clients:2,lanHttpWithoutRandomUUID:true,distinctIds:true,restoredSameConversation:true,guestIsolated:true}));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
