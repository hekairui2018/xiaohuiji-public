'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const {createCore}=require('./core.cjs'),{createDocuments}=require('./documents.cjs'),{createResponder}=require('./responder.cjs');
const configFile=process.argv[2];if(!configFile)throw Error('explicit-private-config-required');
const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));if(!cfg.botId||!cfg.secret||!cfg.sdkRoot)throw Error('missing-private-config');
const SDK=createRequire(path.resolve(cfg.sdkRoot,'package.json'))('@wecom/aibot-node-sdk');
const core=createCore(cfg),documents=createDocuments(cfg.documents);
const state={authenticated:false,received:0,completed:0,failed:0,notificationFailures:0,filesSent:0,fileFailures:0,lastMode:null,lastInboundAt:null,lastCompletedAt:null,lastError:null};
function diagnostic(stage,error){
 let message=String(error?.message||error).slice(0,1000);for(const value of [cfg.secret,cfg.botId])message=message.split(value).join('[redacted]');
 console.error(JSON.stringify({at:new Date().toISOString(),stage,message,cause:error?.cause?.code||null}));
}
const logger={debug(){},log(){},info(){},warn(){},error(){}};
const client=new SDK.WSClient({botId:cfg.botId,secret:cfg.secret,maxReconnectAttempts:-1,maxAuthFailureAttempts:-1,logger});
client.on('authenticated',()=>{state.authenticated=true;console.log('authenticated');});
client.on('disconnected',()=>{state.authenticated=false;});client.on('reconnecting',()=>{state.authenticated=false;});
client.on('error',error=>diagnostic('connection',error));
const responder=createResponder({client,core,documents,state,onError:diagnostic});
for(const kind of ['text','image','mixed'])client.on('message.'+kind,frame=>responder.handle(frame).catch(error=>{state.failed++;diagnostic('dispatch',error);}));
client.on('message.voice',frame=>client.replyStream(frame,randomUUID(),'请用文字或图片发送问题。',true).catch(error=>diagnostic('voice-notice',error)));
const server=http.createServer((req,res)=>{if(req.url!=='/health'){res.writeHead(404);return res.end();}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'xiaohuiji-v2-wecom',version:'20261104-03',pid:process.pid,...state,active:responder.active()}));});
server.on('error',error=>{diagnostic('health-server',error);client.disconnect();process.exit(1);});
server.listen(cfg.port||8522,'127.0.0.1',()=>client.connect());
process.on('SIGTERM',()=>{client.disconnect();server.close(()=>process.exit(0));});
