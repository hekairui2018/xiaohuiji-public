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
function createLanGuard({address,cidr,port}){
 const allowed=subnet(cidr),hosts=new Set(['127.0.0.1:'+port,'localhost:'+port,address+':'+port]);
 return (req,res)=>{
  const ip=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
  const reject=()=>{res.writeHead(403,{'Content-Type':'application/json'});res.end('{"error":"lan_access_denied"}');return false;};
  if(ip!=='127.0.0.1'&&!allowed(ip))return reject();
  if(!hosts.has(req.headers.host))return reject();
  if(req.headers.origin){try{const o=new URL(req.headers.origin);if(o.protocol!=='http:'||o.host!==req.headers.host)return reject();}catch{return reject();}}
  if(req.headers['sec-fetch-site']==='cross-site')return reject();
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  return true;
 };
}
module.exports={lanConfiguration,createLanGuard};
