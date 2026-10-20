'use strict';
// Separate loopback development instance. Reuses read-only index; no Feishu writer, scan, model startup or production restart.
const path=require('node:path'),{parseArgs}=require('node:util');
const {createCapture}=require('../dev-monitor/capture.cjs'),{createMonitorHttp}=require('../dev-monitor/http.cjs'),{createMonitoredExpert}=require('../dev-monitor/expert.cjs');
async function startBonsaiMonitor({enabled=false,port=8630,resourceBase='http://127.0.0.1:8521',modelBase='http://127.0.0.1:8080'}={}){
 if(!enabled)throw Error('Bonsai monitor is disabled by default; explicitly pass --enable for local development');
 if(!Number.isInteger(port)||port<1024||port>65535||[3789,3790,3791,8080,8520,8521,8620].includes(port))throw Error('Choose a separate local development port');
 const resource=new URL(resourceBase);if(resource.protocol!=='http:'||resource.hostname!=='127.0.0.1'||resource.pathname!=='/'||resource.username||resource.password||resource.search||resource.hash)throw Error('Use the existing loopback read-only resource service');
 const knowledge=require('../adapters/data/load-knowledge.cjs').loadKnowledge(path.resolve(__dirname,'../data/knowledge-next'),{manifestFile:'candidate-manifest.json'});
 const app=require('../app/bootstrap.cjs').createApp({knowledge}),capture=createCapture({enabled:true});
 const expert=createMonitoredExpert({capture,baseUrl:modelBase});
 const offlineKnowledge=require('../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({app,knowledge,resourceBase,expert});
 const accessGuard=require('../adapters/http/lan-access.cjs').createLanGuard({address:'127.0.0.1',cidr:'127.0.0.1/32',port});
 const server=require('../adapters/http/server.cjs').createServer(app,{offlineKnowledge,accessGuard,developmentMonitor:createMonitorHttp(capture)});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const close=()=>new Promise(resolve=>{server.closeAllConnections();server.close(()=>{capture.clear();resolve();});});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
 console.log(JSON.stringify({instance:'bonsai-local-development-monitor',pid:process.pid,monitor:'http://127.0.0.1:'+port+'/dev/bonsai',chat:'http://127.0.0.1:'+port+'/huiai',resourceBase,feishuStarted:false,indexStarted:false,modelStarted:false,storage:'memory-only'}));
 return {server,capture,close};
}
if(require.main===module){const {values}=parseArgs({options:{enable:{type:'boolean',default:false},port:{type:'string',default:'8630'},resources:{type:'string',default:'http://127.0.0.1:8521'},model:{type:'string',default:'http://127.0.0.1:8080'}}});startBonsaiMonitor({enabled:values.enable,port:Number(values.port),resourceBase:values.resources,modelBase:values.model}).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={startBonsaiMonitor};
