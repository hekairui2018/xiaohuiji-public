'use strict';
const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'../../..');
const out=path.join(root,'tmp/qwen-fast-xhj-trial-20261020');
const {chromium}=require(path.join(root,'tmp/feishu-browser-runtime/driver/package'));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:8631/huiai',{waitUntil:'networkidle',timeout:60000});
  await page.locator('#v2ExpertMode').waitFor({state:'visible'});
  await page.locator('#v2ExpertMode').click();
  for(const message of ['你好','A5L带载多少','C16L右边三排闪烁，刚换过模组，其他区域正常，先查什么？']){
   await page.locator('#aiInput').fill(message);
   const response=page.waitForResponse(r=>r.url().endsWith('/api/ai/chat')&&r.request().method()==='POST',{timeout:180000});
   const start=Date.now();await page.locator('#aiSendBtn').click();
   const res=await response,body=await res.json();
   results.push({message,httpStatus:res.status(),elapsedMs:Date.now()-start,response:body});
   fs.writeFileSync(path.join(out,'ui-results.private.json'),JSON.stringify({results,errors},null,2));
   await page.waitForTimeout(500);
   await page.screenshot({path:path.join(out,'ui-'+results.length+'.png'),fullPage:true});
   console.log(JSON.stringify({message,status:body.status,error:body.error,reply:body.reply,model:body.model,calls:body.modelCallCount,tools:body.toolCallCount}));
  }
  if(errors.length)throw Error(JSON.stringify(errors));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
