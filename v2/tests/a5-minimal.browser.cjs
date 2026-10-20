'use strict';
// Local-only regression: existing read-only index, ephemeral app port, no live restart/log writer.
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {execFileSync}=require('node:child_process');
const {loadDataset}=require('../adapters/data/load-dataset.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createApp}=require('../app/bootstrap.cjs'),{createServer}=require('../adapters/http/server.cjs');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs'),{createQuickService}=require('../adapters/http/quick-service.cjs');
const {chromium}=require('../../tmp/feishu-browser-runtime/driver/package');
async function main(){
 const root=path.resolve(__dirname,'../..'),dataset=loadDataset(),knowledge=loadKnowledge(path.join(root,'v2/data/knowledge-next'),{manifestFile:'candidate-manifest.json'}),app=createApp({dataset,knowledge});
 const offlineKnowledge=createOfflineKnowledge({knowledge,app,resourceBase:process.env.XHJ_TEST_RESOURCE_BASE||'http://127.0.0.1:8521'});
 const server=createServer(app,{offlineKnowledge});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let browser;const result={unit:'A5 minimal repair',modelCalls:0,otherModels:[],checks:[]};
 try{
  // Compare every other sampled product against the pre-repair pipeline in memory.
  const file=path.join(root,'v2/app/request-pipeline.cjs'),old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
  old._compile(execFileSync('git',['show','HEAD:v2/app/request-pipeline.cjs'],{cwd:root,encoding:'utf8'}),file);
  const prior={...app,...old.exports.createPipeline({dataset,knowledge,router:()=>{throw Error('No dialogue expected');}})};
  const options={localCatalog:offlineKnowledge.localCatalog,resolveDocuments:offlineKnowledge.resolveDocuments,productFacts:offlineKnowledge.productFacts};
  const before=createQuickService(prior,options),after=createQuickService(app,options);
  for(const model of ['A4','A5L','A6','KV410','A3L','R712']){assert.deepEqual(await after.search(model),await before.search(model),model+' changed');result.otherModels.push(model);}
  const withoutExcel=(await createQuickService(app).search('A5')).results[0];assert.equal(withoutExcel.features.load,'');assert.equal(withoutExcel.features.evidence.structuredProduct,undefined);result.checks.push('No selection-tool parameter fallback without actual documents/table');
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const search=async model=>{await page.locator('#quickSearchInput').fill(model);const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/search'&&new URL(r.url()).searchParams.get('q')===model);await page.locator('#quickSearchBtn').click();const data=await (await response).json();await page.locator('.search-item').first().waitFor();return data.results.find(p=>p.modelId==='HD-'+model);};
  await page.goto(base+'/wiki');const product=await search('A5');
  assert.equal(product.features.load,'1280×1024点（1310720像素）');assert.match(product.features.resolution,/最高 2048/);assert.match(product.features.resolution,/宽打折触发宽度：3840/);assert.match(product.features.highlights,/运行内存：2G/);assert.match(product.features.highlights,/大于1080P必须转码/);assert.equal(product.features.notice,undefined);assert.equal(product.features.evidence.structuredProduct,undefined);assert.equal(product.features.sources[0].row,28);result.checks.push('A5 real table parameters and conditions; selection-tool conflict removed');
  assert.equal(await page.getByRole('heading',{name:'相关资料',exact:true}).count(),1);assert.equal(await page.locator('.pq-files,.pq-all-resources,.pq-resource-heading').count(),0);assert.equal(await page.locator('.pr-resource').count(),3);
  assert.ok(product.docGroups.flatMap(g=>g.items).every(d=>!d.name.endsWith('.docx')));assert.equal(product.docGroups.find(g=>g.key==='spec'),undefined);result.checks.push('single original resource panel; 3 files; DOCX/spec policy unchanged');
  const resources=page.locator('.pr-panel-compact');assert.equal(await resources.locator('.pr-resource:visible').count(),1);const other=resources.locator('.pr-other-resources');assert.equal(await other.getAttribute('open'),null);assert.equal(await resources.locator('[data-category="spec"]').isDisabled(),true);assert.equal(await resources.locator('[data-category="manual"]').getAttribute('aria-pressed'),'true');await other.locator(':scope > summary').click();assert.equal(await resources.locator('.pr-resource:visible').count(),3);
  const names=await page.locator('.pr-resource .pr-file-name').allTextContents();assert.equal(names.filter(n=>n==='HD-A5.pdf').length,2);const others=product.docGroups.find(g=>g.key==='other').items;assert.equal(new Set(others.map(d=>d.sha256)).size,2);result.checks.push('category clicks and distinct same-name originals');
  const manual=page.locator('.pr-resource').filter({hasText:'简易操作说明.pdf'});const link=manual.getByRole('link',{name:/在线预览/});const opened=page.context().waitForEvent('page');await link.click();const original=await opened;await original.waitForLoadState();assert.match(await original.locator('body').innerText(),/A5/);await original.close();
  for(const item of product.docGroups.flatMap(g=>g.items)){const response=await fetch(base+item.downloadUrl,{headers:{Range:'bytes=0-15'}});assert.equal(response.status,206);assert.match(response.headers.get('content-type'),/application\/pdf/);await response.body.cancel();}result.checks.push('original preview click and all three download URLs');
  const summary=page.locator('.pr-group').filter({has:page.locator('summary',{hasText:'其他资料 · 2 份'})}).locator('summary').first();await summary.click();await summary.click();assert.equal(await page.getByRole('heading',{name:'相关资料',exact:true}).count(),1);result.checks.push('group expand/collapse never adds a second panel');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await search('A5L');assert.equal(await page.locator('.product-quick-card').count(),1);assert.equal(await page.getByRole('heading',{name:'相关资料',exact:true}).count(),1);assert.deepEqual(errors,[]);result.checks.push('mobile width, unified A5L layout and zero page errors');
  console.log(JSON.stringify(result));
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
