'use strict';
const office=name=>/\.(docx?|pptx?|xlsx?|csv|txt|md)$/i.test(name||'');
const fileUrl=(id,name)=>'/v2/offline/'+(office(name)||/\.pdf$/i.test(name||'')?'preview':'file')+'?id='+id;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function previewPage(data,id,clean,location){
 const sections=(data.blocks||[]).map(b=>'<section><small>'+escape(Object.entries(location(b.locator)).map(([k,v])=>k+': '+v).join(' · '))+'</small><pre>'+escape(clean(b.text))+'</pre></section>').join('');
 const page=n=>'/v2/offline/preview?id='+id+'&offset='+n;
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(clean(data.name))+'</title><style>body{font:16px system-ui;color:#172338;background:#f5f7fa;max-width:1000px;margin:24px auto;padding:20px}main{background:white;padding:24px;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}section{border-top:1px solid #ddd;padding:18px 0}small,p{color:#526071}a{display:inline-block;margin-right:20px;color:#2254ae}h1{overflow-wrap:anywhere;font-size:24px}</style><main><h1>'+escape(clean(data.name))+'</h1><p>原文文本预览：保留已解析的段落、表格和位置。图片、版式及未解析内容请下载原文件查看；此页面不是完整排版预览。</p><a href="/v2/offline/file?id='+id+'">下载原文件</a>'+(data.offset?'<a href="'+page(Math.max(0,data.offset-50))+'">上一页</a>':'')+(data.nextOffset!==null?'<a href="'+page(data.nextOffset)+'">下一页</a>':'')+(sections||'<p>此文件尚无可用正文缓存，暂不能在线预览。请下载原文件查看。</p>')+'</main></html>';
}
function pdfPreviewPage(name,id){
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(name)+'</title><style>html,body{height:100%;margin:0;font:14px system-ui;color:#27343D;background:#F7F9FA}body{display:flex;flex-direction:column}header{display:flex;align-items:center;gap:16px;padding:12px 18px;background:white;border-bottom:1px solid #E5EBEF}h1{font-size:14px;font-weight:500;margin:0;overflow-wrap:anywhere;flex:1}a{color:#168FA9;white-space:nowrap}iframe{width:100%;flex:1;border:0;min-height:0}</style><header><h1>'+escape(name)+'</h1><a href="/v2/offline/file?id='+id+'&download=1">下载原文件</a></header><iframe title="'+escape(name)+'" src="/v2/offline/file?id='+id+'"></iframe></html>';
}
module.exports={fileUrl,previewPage,pdfPreviewPage};
