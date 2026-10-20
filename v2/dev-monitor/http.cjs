'use strict';
const fs=require('node:fs'),path=require('node:path');
function createMonitorHttp(capture){
 return {handle(req,res){
  const url=new URL(req.url,'http://localhost');if(url.pathname!=='/dev'&&!url.pathname.startsWith('/dev/bonsai'))return false;
  const send=(status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(body);return true;};
  if(!capture.enabled)return send(404,JSON.stringify({error:'monitor-disabled'}));
  const ip=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');const hosts=['127.0.0.1:'+req.socket.localPort,'localhost:'+req.socket.localPort];
  if(ip!=='127.0.0.1'&&!['::1'].includes(ip)||!hosts.includes(req.headers.host)||req.headers.forwarded||req.headers['x-forwarded-for']||req.headers['x-real-ip']||req.headers['sec-fetch-site']==='cross-site')return send(403,JSON.stringify({error:'local-development-only'}));
  if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return send(403,JSON.stringify({error:'same-origin-only'}));
  if(req.method!=='GET')return send(405,JSON.stringify({error:'read-only-monitor'}));
  if(url.pathname==='/dev'){res.writeHead(302,{Location:'/dev/bonsai','Cache-Control':'no-store'});res.end();return true;}
  if(url.pathname==='/dev/bonsai/api/status')return send(200,JSON.stringify(capture.status()));
  if(url.pathname==='/dev/bonsai/api/requests')return send(200,JSON.stringify({requests:capture.list()}));
  if(url.pathname.startsWith('/dev/bonsai/api/requests/')){const record=capture.get(url.pathname.slice('/dev/bonsai/api/requests/'.length));return record?send(200,JSON.stringify(record)):send(404,JSON.stringify({error:'record-not-retained'}));}
  const asset={'/dev/bonsai':'index.html','/dev/bonsai/monitor.js':'monitor.js','/dev/bonsai/monitor.css':'monitor.css'}[url.pathname];
  if(!asset)return send(404,JSON.stringify({error:'not-found'}));
  return send(200,fs.readFileSync(path.join(__dirname,asset)),asset.endsWith('.html')?'text/html; charset=utf-8':asset.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');
 }};
}
module.exports={createMonitorHttp};
