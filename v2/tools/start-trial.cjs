'use strict';
// Explicit, loopback-only trial; no production configuration or manifest writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),cp=require('node:child_process');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs'),{createServer}=require('../adapters/http/server.cjs');
function sourceFingerprint(root=path.resolve(__dirname,'../..')){
 const files=[];function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(cjs|js|json)$/.test(entry.name))files.push(file);}}
 for(const dir of ['v2/app','v2/domain','v2/adapters','v2/contracts','v2/model-adapter'])walk(dir);
 files.push('v2/tools/start-trial.cjs');for(const name of fs.readdirSync(path.join(root,'frontend')))if(/\.(html|js|css)$/.test(name))files.push(path.join('frontend',name));
 const hash=crypto.createHash('sha256');for(const file of files.sort()){hash.update(file.replace(/\\/g,'/'));hash.update('\0');hash.update(fs.readFileSync(path.join(root,file)));}return hash.digest('hex');
}
function startTrial(configFile){
 const config=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));
 if(config.host!=='127.0.0.1'||!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw Error('Trial requires a dedicated loopback port');
 if([3789,3790,3791,4389].includes(config.port))throw Error('Production/development ports cannot be reused');
 if(config.model?.enabled)throw Error('Online model is not yet connected to the application pipeline; do not claim AI-online acceptance');
 const fingerprint=sourceFingerprint();if(config.expectedSourceFingerprint&&config.expectedSourceFingerprint!==fingerprint)throw Error('Trial source changed; review before restarting this pinned instance');
 const dataDir=path.resolve(config.dataDirectory);if(dataDir===path.resolve(__dirname,'../../data'))throw Error('Trial data must be isolated');
 const knowledgeDir=path.resolve(config.knowledgeDirectory),knowledge=loadKnowledge(knowledgeDir,{manifestFile:config.manifestFile});
 const index=path.join(knowledgeDir,knowledge.version,'index.json'),sha=crypto.createHash('sha256').update(fs.readFileSync(index)).digest('hex');
 if(knowledge.version!==config.expectedKnowledgeVersion||sha!==config.expectedKnowledgeSHA256)throw Error('Pinned trial knowledge does not match configuration');
 fs.mkdirSync(dataDir,{recursive:true});
 const app=createApp({knowledge}),runtime={instance:'v2-stage17-3060',host:config.host,port:config.port,pid:process.pid,computer:os.hostname(),startedAt:new Date().toISOString(),sourceCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim(),sourceFingerprint:fingerprint,knowledgeSHA256:sha,configFile:path.resolve(configFile),dataDirectory:dataDir,modelMode:'offline',sessions:'isolated-process-memory'};
 const server=createServer({...app,health:()=>({...app.health(),trial:runtime})});
 server.once('error',error=>{console.error(error.message);process.exitCode=1;});
 server.listen(config.port,config.host,()=>{fs.writeFileSync(path.join(dataDir,'runtime.json'),JSON.stringify(runtime,null,2)+'\n');console.log(JSON.stringify(runtime));});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
 return server;
}
if(require.main===module){if(!process.argv[2])throw Error('Provide an explicit trial config JSON');startTrial(path.resolve(process.argv[2]));}
module.exports={startTrial,sourceFingerprint};
