'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../..'),out=path.join(root,'tmp/studio-fast-chat-20261020');
const {chromium}=require(path.join(root,'tmp/feishu-browser-runtime/driver/package'));
const runs=()=>fs.existsSync(path.join(out,'chat-runs.jsonl'))?fs.readFileSync(path.join(out,'chat-runs.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
(async()=>{
 const token=fs.readFileSync(0,'utf8').trim();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const errors=[],requests=[],results=[];
 try {
  let ready=false;
  for(let i=0;i<180;i++){
    try{ready=(await (await fetch('http://127.0.0.1:8890/health')).json()).ready}catch{}
    if(ready)break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw Error('Accelerated model not ready');
  await page.addInitScript(t=>localStorage.setItem('unsloth_auth_token',t),token);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/v1/chat/completions'))requests.push(r.postDataJSON())});
  await page.goto('http://127.0.0.1:8888/chat',{waitUntil:'networkidle',timeout:60000});
  await page.waitForTimeout(1500);
  async function select(model){
    const header=page.locator('button').filter({hasText:/^(qwen35-08b-base|Qwen3\.5-0\.8B)/}).first();
    await header.click();await page.waitForTimeout(300);
    await page.getByText('Connected',{exact:true}).click();
    await page.getByText(model,{exact:true}).click();
  }
  async function settings(tokens,temp=0){
    await page.getByRole('button',{name:'Open run settings',exact:true}).click();
    await page.getByRole('textbox',{name:'Max Tokens',exact:true}).fill(String(tokens));
    await page.getByRole('textbox',{name:'Max Tokens',exact:true}).press('Tab');
    await page.getByRole('textbox',{name:'Temperature',exact:true}).fill(String(temp));
    await page.getByRole('textbox',{name:'Temperature',exact:true}).press('Tab');
    await page.getByRole('button',{name:'Close run settings',exact:true}).click();
  }
  async function send(name,prompt,tokens,temp=0){
    await settings(tokens,temp);
    const before=runs().length;
    await page.getByPlaceholder('Ask anything',{exact:true}).fill(prompt);
    const start=Date.now();
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    let completed=null;
    for(let i=0;i<480;i++){
      await page.waitForTimeout(500);
      const rows=runs();
      if(rows.length>before){completed=rows.at(-1);break}
      if(i===30)console.log('WAITING',name,(await page.locator('body').innerText()).slice(-1200));
    }
    if(!completed)throw Error('No sidecar completion: '+name);
    await page.waitForTimeout(800);
    const body=await page.locator('body').innerText();
    if(completed.error)throw Error(completed.error);
    const row={name,requestedTokens:tokens,wallMs:Date.now()-start,request:requests.at(-1),server:completed,body};
    results.push(row);
    fs.writeFileSync(path.join(out,'ui-results.json'),JSON.stringify({results,errors},null,2));
    await page.screenshot({path:path.join(out,'ui-'+name+'.png'),fullPage:true});
    console.log('UI_RESULT',JSON.stringify({name,tokens:completed.completion_tokens,tps:completed.tokens_per_s,mode:completed.mode,prompt:completed.prompt_tokens,error:completed.error}));
  }
  const fast='Qwen3.5-0.8B-BF16-Fast-Greedy';
  await select(fast);
  await send('base-128','请写一篇很长的关于海洋和灯塔的故事，至少两千字。直接开始故事，不要说明。',128);
  await send('base-multiturn-256','继续上面的故事。让主人公离开港口，登上灯塔，详细描写沿途风景和遭遇，至少两千字。',256);
  await send('base-multiturn-512','换一个话题，详细介绍十种城市公共交通工具，每种分别介绍优缺点与使用场景，至少三千字。',512);
  const timing=page.getByRole('button',{name:'Message timing',exact:true}).last();
  if(await timing.count()){
    await timing.click();await page.waitForTimeout(300);
    fs.writeFileSync(path.join(out,'timing-popup.txt'),await page.locator('body').innerText());
    await page.screenshot({path:path.join(out,'ui-timing.png')});
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button',{name:'新聊天',exact:true}).first().click();
  await select('Qwen3.5-0.8B-LoRA-Fast-Greedy');
  await send('lora-128','请详细介绍一下LED显示屏售后问题应该如何分类，列出尽可能完整的分类方式。',128);
  await send('lora-multiturn-256','继续介绍每种分类应该记录哪些客户信息，不要下维修结论。',256);
  await send('lora-multiturn-512','进一步展开，详细介绍客户信息记录和复核的步骤，至少两千字。',512);
  await page.getByRole('button',{name:'新聊天',exact:true}).first().click();
  await select('Qwen3.5-0.8B-BF16-Normal');
  await send('normal-64','请介绍三种常见树木，各写一段。',64,0);
  await select(fast);
  await send('base-after-lora-128','请写一篇关于森林夜晚的故事，至少两千字。',128);
  console.log('ALL UI TESTS COMPLETE',results.length,'errors',errors.length);
 }finally{
  await page.screenshot({path:path.join(out,'ui-final.png'),fullPage:true}).catch(()=>{});
  fs.writeFileSync(path.join(out,'ui-final-body.txt'),await page.locator('body').innerText());
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
