'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createApp}=require('../app/bootstrap.cjs');
const {createServer}=require('../adapters/http/server.cjs');
const {parseSsm}=require('../../backend/ordering/ssm-codec.cjs');
test('Website renders validated BOM and its download exports the same actual engineering demand',async()=>{
 const app=createApp(),server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{const result=await app.dialogue('配单 P2 模组160x80 40扫 HUB75 全彩 室内 同步接收卡 10宽8高 R716');assert.equal(result.status,'ready');let blob,downloaded=false;
  class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};}appendChild(n){this.children.push(n);}append(...n){this.children.push(...n);}click(){downloaded=true;}}
  const ctx={document:{createElement:tag=>new Element(tag)},fetch:(url,args)=>fetch(base+url,args),URL:{createObjectURL:value=>{blob=value;return 'blob:test';},revokeObjectURL:()=>{}},setTimeout:()=>{}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('frontend/v2-components.js','utf8'),ctx);const root=ctx.renderV2Ordering(result),button=root.children.find(n=>n.tag==='button');
  assert.ok(root.children.find(n=>n.tag==='ul').children.some(n=>n.textContent.includes('HD-R716')));await button.onclick();assert.ok(downloaded);assert.equal(button.disabled,false);
  const xml=await blob.text();assert.equal(parseSsm(xml).packetCount,25);assert.ok(parseSsm(xml).packets.every(p=>p.crcOk));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
