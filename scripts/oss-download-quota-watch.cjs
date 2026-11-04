'use strict';
const fs=require('node:fs'),path=require('node:path');const {run}=require('./oss-download-quota.cjs');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')),dir=path.dirname(config.stateFile),lock=path.join(dir,'watch.pid'),log=path.join(dir,'watch.log');
const pipe='\\\\.\\pipe\\xhj-oss-quota-'+require('node:crypto').createHash('sha256').update(path.resolve(process.argv[2])).digest('hex').slice(0,16);
const server=require('node:net').createServer(socket=>socket.end());
server.on('error',e=>{if(e.code==='EADDRINUSE')process.exit(0);throw e;});
function record(data){if(fs.existsSync(log)&&fs.statSync(log).size>2*1024*1024)fs.renameSync(log,log+'.previous');fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),...data})+'\n');}
async function tick(){try{const s=await run(config);record({ok:true,bytes:s.bytes,stopped:!!s.stopped,notificationAccepted:!!s.notificationAccepted});}catch(e){record({ok:false,error:e.message});}setTimeout(tick,60000);}
server.listen(pipe,()=>{fs.writeFileSync(lock,String(process.pid));tick();});
