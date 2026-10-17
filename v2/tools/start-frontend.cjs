'use strict';
// Loopback-only UI development server. Reuses the running backend, never starts logs/models/data jobs.
const http=require('node:http'),path=require('node:path'),{parseArgs}=require('node:util');
const {serveStatic}=require('../adapters/http/static-service.cjs');
function createFrontendServer({backend='http://127.0.0.1:8520',frontendRoot=path.resolve(__dirname,'../frontend'),port=8620}={}){
 const target=new URL(backend);if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw Error('Backend must be an explicit loopback HTTP origin');
 if(!Number.isInteger(port)||port<1024||port>65535||[3789,3790,3791,8080,8520,8521].includes(port))throw Error('Use a separate frontend development port');
 const allowed=new Set(['/health','/api/health','/api/search','/api/software','/api/videos','/api/docs','/api/ai/chat','/api/ocr','/v2/ordering/chat','/v2/ordering/ssm',...['status','capabilities','session','search','cases','case','read','file','preview'].map(n=>'/v2/offline/'+n)]);
 return http.createServer(async(req,res)=>{
  const send=(code,error)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error}));};
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return send(403,'invalid-development-host');
  if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return send(403,'invalid-development-origin');
  const url=new URL(req.url,'http://localhost'),route=url.pathname;
  if(req.method==='GET'&&route==='/'){res.writeHead(302,{Location:'/wiki'+url.search});res.end();return;}
  if(req.method==='GET'&&route==='/v2/frontend/status'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({instance:'v2-frontend-development',port,pid:process.pid,backend:target.origin,logSyncStarted:false}));}
  if(req.method==='GET'&&route==='/v2/offline/client.js')req.url='/offline-client.js';
  if(req.method==='GET'&&route==='/v2/local-knowledge/client.js')req.url='/local-knowledge.js';
  if(req.method==='GET'&&serveStatic(req,res,frontendRoot,{offlineKnowledge:true}))return;
  const originalFile=req.method==='GET'&&/^\/official-files\/[^\0]+$/.test(route);
  if(!allowed.has(route)&&!/^\/v2\/resources\/original\/[a-f0-9]{64}$/.test(route)&&!originalFile)return send(404,'not-an-existing-frontend-api');
  if(!['GET','POST'].includes(req.method))return send(405,'method-not-allowed');
  let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(route==='/api/ocr'?15*1024*1024:65536))return send(413,'body-too-large');chunks.push(chunk);}
  const headers={host:target.host};if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];if(req.headers.range)headers.range=req.headers.range;
  if(req.headers['x-v2-offline-knowledge'])headers['x-v2-offline-knowledge']=req.headers['x-v2-offline-knowledge'];
  if(req.headers['x-v2-mode'])headers['x-v2-mode']=req.headers['x-v2-mode'];
  // Validate the browser origin above; forward only these required headers, never user cookies or secrets.
  const proxy=http.request(new URL(url.pathname+url.search,target),{method:req.method,headers},upstream=>{
   const responseHeaders={};for(const k of ['content-type','content-disposition','content-length','content-range','accept-ranges','location','cache-control','content-security-policy','x-content-type-options','x-ssm-scope'])if(upstream.headers[k])responseHeaders[k]=upstream.headers[k];
   res.writeHead(upstream.statusCode,responseHeaders);upstream.pipe(res);
  });
  proxy.setTimeout(120000,()=>proxy.destroy(Error('backend-timeout')));
  proxy.on('error',()=>{if(!res.headersSent)send(503,'v2-backend-unavailable');else res.destroy();});
  res.on('close',()=>{if(!res.writableEnded)proxy.destroy();});proxy.end(Buffer.concat(chunks));
 });
}
if(require.main===module){const {values}=parseArgs({options:{port:{type:'string',default:'8620'},backend:{type:'string',default:'http://127.0.0.1:8520'},'frontend-root':{type:'string'}}});const port=Number(values.port);const server=createFrontendServer({backend:values.backend,port,...(values['frontend-root']?{frontendRoot:path.resolve(values['frontend-root'])}:{})});server.on('error',e=>{console.error(e.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({instance:'v2-frontend-development',url:'http://127.0.0.1:'+port+'/wiki',backend:values.backend,pid:process.pid})));}
module.exports={createFrontendServer};
