'use strict';
const fs=require('node:fs'),path=require('node:path');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.pdf':'application/pdf','.png':'image/png','.ico':'image/x-icon'};
function serveStatic(req,res,root=path.resolve(__dirname,'../../frontend'),{localKnowledge=false,offlineKnowledge=false,publicView=false}={}){
 let route;try{route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return false;}
 if(route==='/wiki/'){const url=new URL(req.url,'http://localhost');res.writeHead(302,{Location:'/wiki'+url.search});res.end();return true;}
 if(route==='/v2-site-compat.js'){res.writeHead(200,{'Content-Type':types['.js'],'X-Content-Type-Options':'nosniff'});fs.createReadStream(path.join(root,'site-compat.js')).pipe(res);return true;}
 if(route==='/img/software-screen-control.png'&&publicView){const image=path.resolve(__dirname,'../../../tmp/v2-offline-runtime/software-assets/pingzhangkong-download.png');if(!fs.existsSync(image)){res.writeHead(404);res.end();return true;}res.writeHead(200,{'Content-Type':'image/png','X-Content-Type-Options':'nosniff'});fs.createReadStream(image).pipe(res);return true;}
 if(['/wiki','/huiai','/'].includes(route))route='/index.html';
 const file=path.resolve(root,'.'+route);if(!file.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()||!types[path.extname(file)])return false;
 res.writeHead(200,{'Content-Type':types[path.extname(file)],'X-Content-Type-Options':'nosniff',...(publicView&&route==='/index.html'?{'Cache-Control':'no-store'}:{})});
 if(route==='/index.html'){
  let html=fs.readFileSync(file,'utf8').replace(/<body(?: data-client="rules")?/, '<body'+(publicView?' data-audience="public"':'')+' data-client="'+(publicView?'public':offlineKnowledge?'offline':localKnowledge?'local':'rules')+'"');
  if(publicView){
   html=html.replace(/\s*<script src="(?:offline-client|local-knowledge|conversation-client|source-directory-browser)\.js[^"\n]*"><\/script>/g,'');
   html=html.replace(/\s*<button\b[^>]*\bdata-cat="(?:other|pending)"[^>]*>[\s\S]*?<\/button>/g,'');
   html=html.replace('</body>','<script src="/public-search.js?v=20261023"></script></body>');
  }
  res.end(html);
 }
 else fs.createReadStream(file).pipe(res);return true;
}
module.exports={serveStatic};
