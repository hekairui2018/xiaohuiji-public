'use strict';
function chatStream(req,res){
 if(req.method!=='POST'||!String(req.headers.accept||'').includes('application/x-ndjson'))return null;
 let started=false;
 function write(event){if(res.destroyed||res.writableEnded)return;if(!started){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});started=true;}res.write(JSON.stringify(event)+'\n');}
 return {progress(summary){if(summary?.version===1)write({type:'progress',summary});},text(text){if(typeof text==='string'&&text)write({type:'text',text});},finish(code,data){if(!started)return false;if(!res.destroyed&&!res.writableEnded)res.end(JSON.stringify({type:'final',code,data})+'\n');return true;}};
}
module.exports={chatStream};
