'use strict';
// Public UI lifecycle, real Edge browser with synthetic API responses only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(path.resolve(process.argv[2])),{serveStatic}=require('../adapters/http/static-service.cjs');
(async()=>{
 const server=http.createServer((req,res)=>{if(!serveStatic(req,res,undefined,{publicView:true})){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),requests=[],errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));let fail=false,delay=false,release;
 const suggestion={recommended:true,reason:'需要结合现场条件和上文分析',label:'请专家继续分析',message:'请结合上文继续分析，沿用已提供条件'};
 await page.route(/\/(?:api\/|v2\/software-access\/)/,async route=>{
  const url=new URL(route.request().url());let body={results:[]},status=200;
  if(url.pathname==='/api/ai/capabilities')body={expert:{available:true}};
  else if(url.pathname==='/api/ai/chat'){
   const input=route.request().postDataJSON();requests.push(input);if(delay)await new Promise(r=>{release=r;});
   if(fail){status=503;body={reply:'合成服务暂不可用'};}
   else body={status:'answer',reply:input.message==='延迟回答'?'旧会话延迟回复':'资料已核对 <img src=x onerror=alert(1)>',actualMode:input.mode,conversationId:input.conversationId||'synthetic-public-'+requests.length,results:[{name:'R712规格书.pdf',download:'https://example.test/approved.pdf',location:'页 1'}],expertSuggestion:input.mode==='quick'?suggestion:null,interpretation:{corrections:[{from:'接受卡',to:'接收卡'}]}};
  }else if(url.pathname==='/api/docs')body={docs:{groups:[],total:0,modelCount:0}};
  else if(url.pathname==='/api/videos')body={video:{groups:[],topicGroups:[],total:0}};
  else if(url.pathname==='/api/software')body={software:{items:[]}};
  try{await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});}catch(error){if(!/Target.*closed|disposed|Invalid InterceptionId/.test(error.message))throw error;}
 });
 const idle=()=>page.waitForFunction(()=>!document.getElementById('aiSendBtn').disabled);
 const send=async text=>{await page.locator('#aiInput').fill(text);await page.locator('#aiSendBtn').click();await idle();};
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/huiai');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('已连接'));await page.addStyleTag({content:'.xhj-mascot{display:none!important}'});
  assert.equal(await page.locator('#aiImgBtn').isVisible(),false);assert.equal(await page.locator('#v2PublicNewQuery').count(),1);
  await send('R712 接受卡带载多少');assert.equal(requests[0].mode,'quick');assert.equal(requests[0].conversationId,null);assert.equal(requests[0].history,undefined);assert.equal(requests[0].sessionId,undefined);
  assert.equal(await page.locator('.ai-msg-assistant img').count(),0);assert.ok((await page.locator('#aiMessages').innerText()).includes('<img src=x'));assert.equal(await page.locator('.ai-msg-assistant a').last().getAttribute('rel'),'noopener noreferrer');
  checks.push('quick-mode-public-payload-and-text-safe-render');
  await page.locator('.v2-expert-handoff').click();await idle();assert.equal(requests[1].mode,'expert');assert.equal(requests[1].conversationId,'synthetic-public-1');assert.equal(requests[1].message,suggestion.message);checks.push('quick-context-expert-handoff');
  await page.locator('#v2PublicNewQuery').click();await send('独立新咨询');assert.equal(requests[2].conversationId,null);checks.push('new-consultation-independent-conversation');
  fail=true;await send('失败输入要保留');assert.equal(await page.locator('#aiInput').inputValue(),'失败输入要保留');assert.match(await page.locator('#aiMessages').innerText(),/合成服务暂不可用/);fail=false;checks.push('failure-retains-draft-and-restores-controls');
  delay=true;await page.locator('#aiInput').fill('延迟回答');await page.locator('#aiSendBtn').click();await page.waitForFunction(()=>document.getElementById('aiSendBtn').disabled);while(!release)await new Promise(r=>setTimeout(r,10));await page.locator('#v2PublicNewQuery').click();await idle();release();delay=false;
  await send('取消后的新咨询');assert.equal(requests.at(-1).conversationId,null);assert.ok(!(await page.locator('#aiMessages').innerText()).includes('旧会话延迟回复'));checks.push('reset-aborts-request-and-ignores-late-response');
  for(const width of [390,360]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  checks.push('390-and-360-width-layout');assert.deepEqual(errors,[]);checks.push('no-browser-runtime-errors');
  const result={checks,modelContacted:false};if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await page.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
