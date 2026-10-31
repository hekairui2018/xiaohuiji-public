'use strict';
const crypto=require('node:crypto'),net=require('node:net');
const normalize=ip=>String(ip||'').replace(/^::ffff:/,'');
function peerAddress(req){return req.v2Gateway?.peerAddress||normalize(req.socket?.remoteAddress);}
function peerPort(req){return req.v2Gateway?.port||req.socket?.localPort;}
function gatewayHeaders(req,key,port,now=Date.now){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Gateway key must contain 32 bytes');
 const data={method:req.method,url:req.url,host:String(req.headers.host||''),origin:String(req.headers.origin||''),peerAddress:normalize(req.socket?.remoteAddress),port,at:now(),nonce:crypto.randomBytes(16).toString('hex')};
 const metadata=Buffer.from(JSON.stringify(data)).toString('base64url'),mac=crypto.createHmac('sha256',key).update(metadata).digest('hex');return {'x-xhj-gateway':metadata,'x-xhj-gateway-mac':mac};
}
function createGatewayTrust({key,now=Date.now,maxAgeMs=30000}){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Gateway key must contain 32 bytes');const used=new Map();
 return (req,res)=>{
  const deny=()=>{res.writeHead(403,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'authenticated-web-gateway-required'}));return false;};
  if(!['127.0.0.1','::1'].includes(normalize(req.socket?.remoteAddress)))return deny();
  const metadata=req.headers['x-xhj-gateway'],mac=req.headers['x-xhj-gateway-mac'];if(typeof metadata!=='string'||metadata.length>4096||typeof mac!=='string'||!/^[a-f0-9]{64}$/.test(mac))return deny();
  const expected=crypto.createHmac('sha256',key).update(metadata).digest();if(!crypto.timingSafeEqual(expected,Buffer.from(mac,'hex')))return deny();
  let data;try{data=JSON.parse(Buffer.from(metadata,'base64url').toString('utf8'));}catch{return deny();}
  if(data.method!==req.method||data.url!==req.url||data.host!==String(req.headers.host||'')||data.origin!==String(req.headers.origin||'')||!net.isIP(data.peerAddress)||!Number.isInteger(data.port)||data.port<1024||data.port>65535||!Number.isFinite(data.at)||Math.abs(now()-data.at)>maxAgeMs||!/^[a-f0-9]{32}$/.test(data.nonce))return deny();
  for(const [nonce,at]of used)if(now()-at>maxAgeMs)used.delete(nonce);if(used.has(data.nonce)||used.size>=4096)return deny();used.set(data.nonce,data.at);
  Object.defineProperty(req,'v2Gateway',{value:Object.freeze({peerAddress:data.peerAddress,port:data.port}),enumerable:false});delete req.headers['x-xhj-gateway'];delete req.headers['x-xhj-gateway-mac'];return true;
 };
}
module.exports={peerAddress,peerPort,gatewayHeaders,createGatewayTrust};
