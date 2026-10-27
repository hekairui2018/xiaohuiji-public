'use strict';
const os=require('node:os'),net=require('node:net');
const ipv4=s=>{if(net.isIP(s)!==4)throw Error('Invalid IPv4 address');return s.split('.').reduce((v,n)=>(v*256+Number(n))>>>0,0);};
function subnet(cidr){const [address,bits]=cidr.split('/');if(!/^\d+$/.test(bits)||Number(bits)<8||Number(bits)>32)throw Error('Invalid LAN subnet');const mask=(0xffffffff<<(32-Number(bits)))>>>0,network=ipv4(address)&mask;return ip=>{try{return (ipv4(ip)&mask)===network;}catch{return false;}};}
function lanConfiguration(address){
 const privateIp=ip=>/^10\./.test(ip)||/^192\.168\./.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip);
 const interfaces=Object.values(os.networkInterfaces()).flat().filter(x=>x.family==='IPv4'&&!x.internal&&privateIp(x.address)&&x.cidr);
 const matches=interfaces.filter(x=>!address||x.address===address);
 if(matches.length!==1)throw Error('Provide --lan-address for exactly one active private LAN interface');
 return {address:matches[0].address,cidr:matches[0].cidr};
}
function createLanGuard({address,cidr,port,publicOrigin=null,publicOnly=false}){
 const allowed=subnet(cidr),hosts=new Set(['127.0.0.1:'+port,'localhost:'+port,address+':'+port]);
 const external=publicOrigin?new URL(publicOrigin):null;
 if(external&&(!['http:','https:'].includes(external.protocol)||external.pathname!=='/'||external.search||external.hash||external.username||external.password))throw Error('Invalid public origin');
 const publicRoutes=require('./public-routes.cjs').publicGetRoutes;
 return (req,res)=>{
  const ip=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
  const reject=()=>{res.writeHead(403,{'Content-Type':'application/json'});res.end('{"error":"lan_access_denied"}');return false;};
  if(ip!=='127.0.0.1'&&!allowed(ip))return reject();
  const externalHost=!!external&&req.headers.host===external.host;
  if(!hosts.has(req.headers.host)&&!externalHost)return reject();
  const route=new URL(req.url,'http://localhost').pathname;
  const localMaintenance=ip==='127.0.0.1'&&!externalHost&&(route==='/api/operations/maintenance'||req.method==='GET'&&(route==='/health'||route==='/api/health'||route==='/dev/bonsai'||route.startsWith('/dev/bonsai/')));
  req.v2Public=externalHost||publicOnly&&!localMaintenance;
  if(req.v2Public&&route==='/api/graydesk/errors'&&external?.protocol!=='https:'){res.writeHead(426,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:false,error:'https-required',retryable:false}));return false;}
  if(req.v2Public&&!require('../../external-services/assistant-updates.cjs').isUpdateRoute(req.method,route)&&!(req.method==='POST'&&route==='/api/graydesk/errors')&&!require('./public-routes.cjs').isPublicRoute(req.method,route)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'public-route-not-enabled',message:'此公网接口未开放。'}));return false;}
  if(req.headers.origin){try{const o=new URL(req.headers.origin);if(o.host!==req.headers.host||(externalHost?o.origin!==external.origin:o.protocol!=='http:'))return reject();}catch{return reject();}}
  if(req.headers['sec-fetch-site']==='cross-site'){
   // Opening a local page from a link is a navigation, not a cross-origin API call.
   const page=req.method==='GET'&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document'&&['/','/wiki','/wiki/','/huiai'].includes(new URL(req.url,'http://localhost').pathname);
   if(!page)return reject();
  }
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  return true;
 };
}
module.exports={lanConfiguration,createLanGuard};
