'use strict';
function chatStream(req,res){
 if(req.method!=='POST'||!String(req.headers.accept||'').includes('application/x-ndjson'))return null;
 let started=false;
 return {text(text){if(res.destroyed||res.writableEnded||typeof text!=='string'||!text)return;if(!started){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});started=true;}res.write(JSON.stringify({type:'text',text})+'\n');},finish(code,data){if(!started)return false;if(!res.destroyed&&!res.writableEnded)res.end(JSON.stringify({type:'final',code,data})+'\n');return true;}};
}
module.exports={chatStream};
