'use strict';
const net=require('node:net');
// Classification only, never grants access or trusts caller-supplied forwarded headers.
function accessEntry(req){
 const host=String(req.headers.host||'').toLowerCase(),hostname=host.replace(/:\d+$/,'');
 const peer=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
 const privateIp=s=>net.isIP(s)===4&&(/^10\./.test(s)||/^192\.168\./.test(s)||/^172\.(1[6-9]|2\d|3[01])\./.test(s));
 const entry=hostname==='127.0.0.1'||hostname==='localhost'?'local':privateIp(hostname)?'lan':hostname?'domain':'unknown';
 return {entry,requestHost:host,peerKind:peer==='127.0.0.1'||peer==='::1'?'local':privateIp(peer)?'private-network':'other',clientInternetIdentityVerified:false};
}
module.exports={accessEntry};
