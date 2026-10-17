'use strict';
const fs=require('node:fs'),path=require('node:path');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.pdf':'application/pdf','.png':'image/png','.ico':'image/x-icon'};
function serveStatic(req,res,root=path.resolve(__dirname,'../../frontend'),{localKnowledge=false,offlineKnowledge=false}={}){
 let route;try{route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return false;}
 if(route==='/wiki/'){const url=new URL(req.url,'http://localhost');res.writeHead(302,{Location:'/wiki'+url.search});res.end();return true;}
 if(route==='/v2-site-compat.js'){res.writeHead(200,{'Content-Type':types['.js'],'X-Content-Type-Options':'nosniff'});fs.createReadStream(path.join(root,'site-compat.js')).pipe(res);return true;}
 if(['/wiki','/huiai','/'].includes(route))route='/index.html';
 const file=path.resolve(root,'.'+route);if(!file.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()||!types[path.extname(file)])return false;
 res.writeHead(200,{'Content-Type':types[path.extname(file)],'X-Content-Type-Options':'nosniff'});if(route==='/index.html')res.end(fs.readFileSync(file,'utf8').replace('</body>','<script src="/v2-site-compat.js"></script>'+(offlineKnowledge?'<script src="/v2/offline/client.js"></script>':localKnowledge?'<script src="/v2/local-knowledge/client.js"></script>':'')+'</body>'));else if(route==='/app.js')res.end(fs.readFileSync(file,'utf8').replace(/(["'])\/quick\1/g,'$1/wiki$1'));else fs.createReadStream(file).pipe(res);return true;
}
module.exports={serveStatic};
