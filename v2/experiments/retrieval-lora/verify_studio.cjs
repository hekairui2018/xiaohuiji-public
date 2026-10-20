'use strict';
// Read-only browser smoke check: never creates credentials or starts training.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const {chromium} = require(path.join(root, 'tmp/feishu-browser-runtime/driver/package'));
(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1365, height: 900}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const response = await page.goto('http://127.0.0.1:8888', {waitUntil: 'networkidle', timeout: 60000});
    const title = await page.title();
    const body = (await page.locator('body').innerText()).slice(0, 6000);
    const assets = await page.locator('script[src]').evaluateAll(nodes => nodes.map(n => n.src));
    const report = {status: response.status(), title, url: page.url(), body, assets, errors,
      inputs: await page.locator('input').evaluateAll(nodes => nodes.map(n => ({type:n.type, placeholder:n.placeholder}))),
      timestamp: new Date().toISOString()};
    const out = path.join(root, 'tmp/unsloth-studio-20261020');
    await page.screenshot({path: path.join(out, 'studio-ready.png'), fullPage:true});
    fs.writeFileSync(path.join(out, 'browser-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (response.status() !== 200 || !/unsloth/i.test(title + body) || errors.length) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exitCode = 1;});
