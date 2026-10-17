'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fileUrl,previewPage,pdfPreviewPage}=require('../adapters/http/document-preview.cjs');
test('Documents open named preview pages; binary resources retain original streaming',()=>{
 assert.equal(fileUrl(12,'规格书.docx'),'/v2/offline/preview?id=12');
 assert.equal(fileUrl(12,'规格书.pdf'),'/v2/offline/preview?id=12');
 assert.equal(fileUrl(12,'固件.bin'),'/v2/offline/file?id=12');
});
test('Text preview escapes source content, keeps positions and distinguishes missing image layout',()=>{
 const page=previewPage({name:'<script>.docx',offset:50,nextOffset:100,blocks:[{locator:{paragraph:6},text:'<img src=x onerror=alert(1)>'}]},12,s=>s,l=>l);
 assert.ok(!page.includes('<img'));assert.ok(page.includes('&lt;img'));assert.ok(page.includes('paragraph: 6'));
 assert.ok(page.includes('offset=100'));assert.ok(page.includes('offset=0'));assert.ok(page.includes('不是完整排版预览'));
 const empty=previewPage({name:'X.docx',offset:0,nextOffset:null,blocks:[]},12,s=>s,l=>l);
 assert.ok(empty.includes('尚无可用正文缓存'));assert.ok(empty.includes('/file?id=12'));
});

test('PDF preview names the tab and streams the unchanged original in a same-origin frame',()=>{
 const page=pdfPreviewPage('HD-X1 <test>.pdf',12);
 assert.ok(page.includes('<title>HD-X1 &lt;test&gt;.pdf</title>'));
 assert.ok(page.includes('src="/v2/offline/file?id=12"'));
 assert.ok(page.includes('id=12&download=1'));
});

test('website hides operation guides without removing their original/history records',async()=>{
 const {createQuickService,productView}=require('../adapters/http/quick-service.cjs');
 const product={modelId:'HD-X1',displayName:'X1',documents:[{name:'X1使用说明V1.0.pdf',kind:'manual'},{name:'X1操作指南V1.0.pdf',kind:'manual'}]};
 const quick=createQuickService({quickResources:()=>({}),quickSearch:()=>({records:[]}),quickBrowse:()=>[product]});
 assert.equal((await quick.docs('manual',{websiteOnly:true})).docs.items.length,1);
 assert.equal((await quick.docs('manual',{websiteOnly:true,includeHistory:true})).docs.items.length,2);
 assert.equal(productView(product).specGroups[0].items.length,1);assert.equal(product.documents.length,2);
});

test('current website excludes DOCX even without PDF and excludes English operation guides',async()=>{
 const {createQuickService,productView}=require('../adapters/http/quick-service.cjs');
 const names=['X1使用说明V1.0.pdf','X1使用说明V1.0.docx','X1 Operation GuideV1.0.pdf','X1独有手册.docx'];
 const product={modelId:'HD-X1',displayName:'X1',documents:names.map(name=>({name,kind:'manual'}))};
 const quick=createQuickService({quickResources:()=>({}),quickSearch:()=>({records:[]}),quickBrowse:()=>[product]});
 assert.deepEqual((await quick.docs('manual',{websiteOnly:true})).docs.items.map(x=>x.name),[names[0]]);
 assert.equal((await quick.docs('manual',{websiteOnly:true,includeHistory:true})).docs.items.length,4);
 assert.deepEqual(productView(product).specGroups[0].items.map(x=>x.name),[names[0]]);assert.equal(product.documents.length,4);
});
