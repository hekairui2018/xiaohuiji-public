'use strict';
// Browser interaction regression. API replies are deliberately controlled, not a model quality test.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8520',out=process.env.TEST_OUTPUT_DIR;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1360,height:1000}}),calls=[],interrupts=[],errors=[];let failInterrupt=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/ai/chat',route=>{calls.push({route,body:route.request().postDataJSON()});});
  await page.route('**/v2/offline/session/interrupt',async route=>{interrupts.push(route.request().postDataJSON());await route.fulfill(failInterrupt?{status:409,json:{error:'still-stopping',reply:'仍在停止'}}:{json:{ready:true,interrupted:true}});});
  await page.goto(base+'/huiai');await page.locator('#v2GuestConversation').click();
  const input=page.locator('#aiInput'),queue=page.locator('.v2-message-queue');
  // Expose only a synthetic request count to coordinate browser assertions.
  const until=async n=>{for(let i=0;i<100&&calls.length<n;i++)await page.waitForTimeout(50);assert.equal(calls.length,n);};
  const send=async text=>{await input.fill(text);await input.press('Enter');};
  const finish=async(index,reply)=>{await calls[index].route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'text',text:reply})+'\n'+JSON.stringify({type:'final',data:{status:'answer',actualMode:'quick',reply,model:'v2-offline-search'}})+'\n'});};
  await send('合成问题甲');await until(1);
  await input.fill('候补乙');await input.press('Control+Enter');
  await input.fill('候补丙');await input.press('Control+Enter');
  await input.fill('待移除');await input.press('Control+Enter');await queue.getByRole('button',{name:'移除此条候补消息'}).last().click();
  assert.equal(calls.length,1);assert.equal(await queue.locator('div').count(),2);
  assert(!(await page.locator('#aiMessages').innerText()).includes('候补乙'));
  await input.fill('尚未发送的草稿');
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'queue-desktop.png')});}
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(out)await page.screenshot({path:path.join(out,'queue-mobile.png')});
  await page.setViewportSize({width:1360,height:1000});
  await finish(0,'甲完成');await until(2);assert.equal(calls[1].body.message,'候补乙');assert.equal(await input.inputValue(),'尚未发送的草稿');
  await finish(1,'乙完成');await until(3);assert.equal(calls[2].body.message,'候补丙');
  await finish(2,'丙完成');await page.waitForSelector('#aiLoading',{state:'detached'});
  assert.equal(await input.inputValue(),'尚未发送的草稿');
  await send('旧条件');await until(4);await send('更正条件');await until(5);
  assert.equal(interrupts.length,1);assert.equal(interrupts[0].pendingMessage,'旧条件');assert.equal(calls[3].body.sessionId,calls[4].body.sessionId);
  assert.equal(interrupts[0].sessionId,calls[4].body.sessionId);await finish(4,'按更正条件完成');await page.waitForSelector('#aiLoading',{state:'detached'});
  await send('失败测试');await until(6);await input.fill('失败后候补');await input.press('Control+Enter');
  await calls[5].route.fulfill({status:503,json:{error:'synthetic-unavailable',reply:'合成服务不可用'}});await page.waitForSelector('#aiLoading',{state:'detached'});
  assert.equal(calls.length,6);assert((await queue.innerText()).includes('已暂停'));
  await queue.getByRole('button',{name:'继续发送候补'}).click();await until(7);assert.equal(calls[6].body.message,'失败后候补');assert.equal(await input.inputValue(),'失败测试');
  await finish(6,'候补恢复完成');await page.waitForSelector('#aiLoading',{state:'detached'});
  await input.fill('输入法');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(calls.length,7);
  await input.press('Shift+Enter');assert((await input.inputValue()).includes('\n'));assert.equal(calls.length,7);
  await send('停止失败的旧请求');await until(8);failInterrupt=true;await send('停止失败时保留的更正');
  await page.waitForFunction(()=>document.querySelector('#aiMessages').innerText.includes('前一条停止未确认'));
  assert.equal(calls.length,8);assert.equal(await input.inputValue(),'停止失败时保留的更正');
  failInterrupt=false;await input.press('Enter');await until(9);await finish(8,'重试成功');await page.waitForSelector('#aiLoading',{state:'detached'});
  await page.route('**/api/ocr',route=>route.fulfill({json:{ok:true,text:'合成图片文字',imageId:'synthetic-image'}}));
  await page.evaluate(()=>{window.__testImageSend=FrontendApp.chat.sendImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=');});
  await until(10);assert.equal(calls[9].body.message,'合成图片文字');assert.deepEqual(calls[9].body.images,['synthetic-image']);
  await input.fill('OCR候补');await input.press('Control+Enter');await finish(9,'图片检索完成');await until(11);assert.equal(calls[10].body.message,'OCR候补');await finish(10,'OCR候补完成');await page.waitForSelector('#aiLoading',{state:'detached'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,controlledApi:true,queueOrder:true,queueRemoval:true,draftPreserved:true,sameSessionInterrupt:true,errorPausesQueue:true,ime:true,mobile:true}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
