'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module'),{randomUUID,createHash}=require('node:crypto');
const {createCore}=require('./core.cjs'),{createDocuments}=require('./documents.cjs'),{createResponder}=require('./responder.cjs');
const {createMedia}=require('./media.cjs'),{createPresentation}=require('./presentation.cjs');
const configFile=process.argv[2];if(!configFile)throw Error('explicit-private-config-required');
const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));if(!cfg.botId||!cfg.secret||!cfg.sdkRoot)throw Error('missing-private-config');
const SDK=createRequire(path.resolve(cfg.sdkRoot,'package.json'))('@wecom/aibot-node-sdk');
const core=createCore(cfg),documents=createDocuments(cfg.documents);
const presentation=createPresentation({core,documents,media:createMedia({sdkRoot:cfg.sdkRoot,...cfg.media}),internalWebOrigin:cfg.internalWebOrigin});
const auditDirectory=path.join(path.dirname(path.resolve(configFile)),'delivery');fs.mkdirSync(auditDirectory,{recursive:true});
function record(event){const id=createHash('sha256').update(String(event.messageId||event.chatKey)).digest('hex');fs.appendFileSync(path.join(auditDirectory,id+'.jsonl'),JSON.stringify(event)+'\n');}
const state={authenticated:false,received:0,completed:0,partial:0,failed:0,notificationFailures:0,filesSent:0,imagesSent:0,videosSent:0,fileFailures:0,lastDelivery:null,lastMode:null,lastInboundAt:null,lastCompletedAt:null,lastError:null};
function diagnostic(stage,error){
 let message=String(error?.message||error).slice(0,1000);for(const value of [cfg.secret,cfg.botId])message=message.split(value).join('[redacted]');
 console.error(JSON.stringify({at:new Date().toISOString(),stage,message,cause:error?.cause?.code||null}));
}
const logger={debug(){},log(){},info(){},warn(){},error(){}};
const client=new SDK.WSClient({botId:cfg.botId,secret:cfg.secret,maxReconnectAttempts:-1,maxAuthFailureAttempts:-1,logger});
client.on('authenticated',()=>{state.authenticated=true;console.log('authenticated');});
client.on('disconnected',()=>{state.authenticated=false;});client.on('reconnecting',()=>{state.authenticated=false;});
client.on('error',error=>diagnostic('connection',error));
const responder=createResponder({client,core,documents,presentation,state,onError:diagnostic,onRecord:record});
for(const kind of ['text','image','mixed'])client.on('message.'+kind,frame=>responder.handle(frame).catch(error=>{state.failed++;diagnostic('dispatch',error);}));
client.on('message.voice',frame=>client.replyStream(frame,randomUUID(),'请用文字或图片发送问题。',true).catch(error=>diagnostic('voice-notice',error)));
const server=http.createServer((req,res)=>{if(req.url!=='/health'){res.writeHead(404);return res.end();}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'xiaohuiji-v2-wecom',version:'20261104-04',pid:process.pid,...state,active:responder.active()}));});
server.on('error',error=>{diagnostic('health-server',error);client.disconnect();process.exit(1);});
server.listen(cfg.port||8522,'127.0.0.1',()=>client.connect());
process.on('SIGTERM',()=>{client.disconnect();server.close(()=>process.exit(0));});
