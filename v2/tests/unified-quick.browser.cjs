'use strict';
// UI-only local preview/regression. Read existing data, use an ephemeral app port, no log writer/model.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {loadDataset}=require('../adapters/data/load-dataset.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs'),{createServer}=require('../adapters/http/server.cjs');
const {augmentProducts}=require('../domain/knowledge/local-resource-catalog.cjs');
const {chromium}=require('../../tmp/feishu-browser-runtime/driver/package');
async function main(){
 const root=path.resolve(__dirname,'../..'),folder=path.join(root,'tmp/blue-action-preview-20261019');fs.mkdirSync(folder,{recursive:true});
 const knowledge=loadKnowledge(path.join(root,'v2/data/knowledge-next'),{manifestFile:'candidate-manifest.json'}),app=createApp({knowledge,dataset:loadDataset()});
 const offlineKnowledge=createOfflineKnowledge({knowledge,app,resourceBase:process.env.XHJ_TEST_RESOURCE_BASE||'http://127.0.0.1:8521'}),server=createServer(app,{offlineKnowledge});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let browser;const results={checks:[],models:[],noModelCalls:true,isolated:true};
 try{
  const fileOnly=augmentProducts(app.quickBrowse(),await offlineKnowledge.localCatalog(),{includeSigned:true}).find(p=>p.modelId&&p.identityStatus==='filename-only-resource-association'&&p.documents.length);
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1280,height:1000});await page.goto(base+'/wiki');
  const search=async model=>{await page.locator('#quickSearchInput').fill(model);const event=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/search'&&new URL(r.url()).searchParams.get('q')===model);await page.locator('#quickSearchBtn').click();const data=await (await event).json();await page.locator('.product-quick-card').first().waitFor();return data;};
  for(const model of ['A5','KV410','C16L','R712','W62',...(fileOnly?[fileOnly.modelId.replace(/^HD-/,'')]:[])]){
   const data=await search(model),card=page.locator('.product-quick-card').first(),product=data.results[0],resources=card.locator('.pr-panel-compact');assert.ok(product);assert.equal(await page.locator('.product-quick-card').count(),data.results.length);
   assert.equal(await resources.getByRole('heading',{name:'相关资料',exact:true}).count(),1);assert.equal(await resources.locator('.pr-navigation button').count(),3);assert.deepEqual(await resources.locator('.pr-navigation button').evaluateAll(nodes=>nodes.map(n=>n.dataset.category)),['spec','manual','firmware']);
   assert.equal(await resources.locator('.pr-all-resources,.pr-featured,.pr-category-summary').count(),0);assert.equal(await resources.locator('.pr-resource').count(),product.docGroups.reduce((n,g)=>n+g.items.length,0));
   const other=resources.locator('.pr-other-resources'),extra=product.docGroups.filter(g=>!['spec','manual','firmware'].includes(g.key));assert.equal(await other.count(),extra.length?1:0);
   if(extra.length){assert.equal(await other.getAttribute('open'),null);await other.locator(':scope > summary').focus();await page.keyboard.press('Enter');assert.equal(await other.evaluate(n=>n.open),true);await page.keyboard.press('Enter');assert.equal(await other.evaluate(n=>n.open),false);}
   for(const key of ['spec','manual','firmware']){const button=resources.locator('.pr-navigation button[data-category="'+key+'"]'),count=product.docGroups.find(g=>g.key===key)?.items.length||0;assert.equal(await button.isDisabled(),!count);if(count){await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');assert.equal(await resources.locator('.pr-primary-groups>.pr-group:visible').count(),1);assert.equal(await resources.locator('.pr-primary-groups .pr-current-files .pr-resource:visible').count(),count);}}
   const initial=resources.locator('.pr-navigation button:enabled').first();if(await initial.count())await initial.click();
   if(model==='A5'){
    const rgb=style=>style.match(/\d+/g).map(Number),nameColor=rgb(await resources.locator('.pr-primary-groups .pr-file-name:visible').first().evaluate(n=>getComputedStyle(n).color)),iconColor=rgb(await resources.locator('.pr-primary-groups .pr-actions a:visible').first().evaluate(n=>getComputedStyle(n).color));
    assert.ok(Math.max(...nameColor)-Math.min(...nameColor)<35,'filename stays neutral gray');assert.ok(iconColor[2]>iconColor[0]+50,'clickable action is blue');
    const selectedColor=rgb(await resources.locator('.pr-navigation [aria-pressed="true"]').evaluate(n=>getComputedStyle(n).backgroundColor));assert.ok(selectedColor[1]>selectedColor[0]&&selectedColor[1]>selectedColor[2],'selected category is pale green');
   }
   if(model==='KV410'){const pair=resources.locator('.pr-current-files:visible .pr-featured-pair').first();assert.equal(await pair.locator('.pr-resource').count(),2);const boxes=await pair.locator('.pr-resource').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));assert.equal(boxes[0].y,boxes[1].y);assert.ok(boxes[1].x>boxes[0].x);}
   results.models.push({model,primaryTabs:3,otherFiles:extra.reduce((n,g)=>n+g.items.length,0),allFiles:await resources.locator('.pr-resource').count()});
   await page.mouse.move(0,0);await page.locator(':focus').evaluateAll(nodes=>nodes.forEach(n=>n.blur()));
   if(['A5','KV410','R712'].includes(model)){await card.screenshot({path:path.join(folder,model+'-desktop.png')});await resources.screenshot({path:path.join(folder,model+'-resources-desktop.png')});}
   for(const width of [768,390,360]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,model+' page overflow');assert.equal(await card.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,model+' card overflow');if(width===390&&model==='KV410')await resources.screenshot({path:path.join(folder,'KV410-resources-mobile.png')});}await page.setViewportSize({width:1280,height:1000});
  }
  const data=await search('A5'),resources=page.locator('.pr-panel-compact'),other=resources.locator('.pr-other-resources');assert.equal(await resources.locator('.pr-primary-groups .pr-resource:visible').count(),1);assert.equal(await other.locator('.pr-resource:visible').count(),0);
  await other.locator(':scope > summary').click();assert.equal(await other.locator('.pr-resource:visible').count(),2);const otherSearch=other.getByRole('searchbox');await otherSearch.fill('不存在的附件');assert.equal(await other.locator('.pr-resource:visible').count(),0);assert.equal(await resources.locator('.pr-primary-groups .pr-resource:visible').count(),1);await otherSearch.fill('');
  const primarySearch=resources.getByRole('searchbox',{name:'HD-A5资料筛选',exact:true});await primarySearch.fill('无关文件');assert.equal(await resources.locator('.pr-primary-groups .pr-resource:visible').count(),0);assert.equal(await other.locator('.pr-resource:visible').count(),2);await primarySearch.fill('');
  const manual=resources.locator('.pr-primary-groups .pr-resource').filter({hasText:'简易操作说明.pdf'}),opened=page.context().waitForEvent('page');await manual.getByRole('link',{name:/在线预览/}).click();const original=await opened;await original.waitForLoadState();assert.match(await original.locator('body').innerText(),/A5/);await original.close();assert.equal(await manual.getByRole('link',{name:/在线预览/}).evaluate(n=>n.classList.contains('pr-action-used')),true);const usedColor=await manual.getByRole('link',{name:/在线预览/}).evaluate(n=>getComputedStyle(n).backgroundColor);const usedRgb=usedColor.match(/\d+/g).map(Number);assert.ok(usedRgb[1]>usedRgb[0]&&usedRgb[1]>usedRgb[2],'used action turns pale green');
  for(const item of data.results[0].docGroups.flatMap(g=>g.items)){const response=await fetch(base+item.downloadUrl,{headers:{Range:'bytes=0-15'}});assert.equal(response.status,206);await response.body.cancel();}
  await resources.locator('.pr-primary-groups .pr-history>summary').click();await page.waitForFunction(()=>{const n=document.querySelector('.pr-history[open]');return n&&!n.textContent.includes('读取历史版本…');});assert.equal(await resources.getByRole('heading',{name:'相关资料',exact:true}).count(),1);
  const related=page.locator('.related-chip').first();if(await related.count()){const q=await related.getAttribute('data-q');await related.click();await page.waitForFunction(q=>document.querySelector('#quickSearchInput').value===q,q);}
  assert.deepEqual(errors,[]);results.checks=['gray file names, blue actions, pale-green selection/click','exactly three primary category pills','other files separated and initially collapsed','independent primary/other search','bilingual files paired without duplication','responsive 1280/768/390/360','existing categories/filter','original preview/download','existing history and related-model navigation'];
  fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
