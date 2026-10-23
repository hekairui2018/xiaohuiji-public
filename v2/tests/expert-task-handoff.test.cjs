'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createApp}=require('../app/bootstrap.cjs');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const knowledge=loadKnowledge();
function ordering(state){return state.taskState.tasks.find(task=>task.type==='ordering');}
function active(state){return state.taskState.tasks.find(task=>task.id===state.taskState.activeId);}
async function fixture(run,expertResult={status:'clarify',reply:'新尺寸已保留，接下来核对模组条件。',actualMode:'expert',results:[]}){
 const observed=[];let api;
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/synthetic-index/')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({results:[],resources:[],blocks:[]}));return;}
  api.handle(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end();}}).catch(error=>{res.statusCode=500;res.end(error.message);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 api=createOfflineKnowledge({knowledge,app:createApp({knowledge}),resourceBase:base+'/synthetic-index',expert:{answer:async request=>{observed.push(structuredClone(request.sessionState));return expertResult;}}});
 async function say(message,mode='quick'){
  const response=await fetch(base+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'handoff-test',message,mode})});
  const body=await response.json();assert.ok([200,503].includes(response.status),JSON.stringify(body));return body;
 }
 try{await run({say,observed});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function seed(say){await say('配单P2室内屏');const r=await say('整屏分辨率1600×800');assert.equal(active(r.sessionState).ordering.confirmed.screen.pixelWidth,1600);return r.sessionState;}

for(const [label,result]of [
 ['the expert answers',{status:'clarify',reply:'已记录新尺寸，接下来核对模组条件。',actualMode:'expert',results:[]}],
 ['the model fails',{status:'unavailable',reply:'模型本次未完成，客户条件仍应保留。',actualMode:'expert',error:'expert-timeout',results:[]}]
])test('An explicit customer correction survives expert to quick handoff when '+label,async()=>fixture(async({say,observed})=>{
 const before=await seed(say),id=active(before).id;
 const expert=await say('整屏分辨率改成1920×960','expert');
 assert.equal(observed.length,1);assert.equal(active(observed[0]).id,id);assert.equal(active(observed[0]).ordering.confirmed.screen.pixelWidth,1920);
 assert.equal(active(expert.sessionState).ordering.confirmed.screen.pixelHeight,960);
 const continued=await say('继续配单'),task=active(continued.sessionState);
 assert.equal(task.id,id);assert.equal(task.ordering.confirmed.screen.pixelWidth,1920);assert.equal(task.ordering.confirmed.screen.pixelHeight,960);assert.equal(task.ordering.confirmed.module.pitchMm,2);assert.equal(task.ordering.confirmed.environment,'indoor');
 assert.match(continued.reply,/1920[×x]960/);assert.doesNotMatch(continued.reply,/1600[×x]800/);
},result));

test('An independent expert product question cannot change an existing engineering demand',async()=>fixture(async({say,observed})=>{
 const before=await seed(say),confirmed=structuredClone(active(before).ordering.confirmed);
 const expert=await say('R716带载多少','expert');
 assert.deepEqual(ordering(expert.sessionState).ordering.confirmed,confirmed);assert.deepEqual(ordering(observed[0]).ordering.confirmed,confirmed);
 const continued=await say('继续配单');assert.equal(active(continued.sessionState).ordering.confirmed.screen.pixelWidth,1600);assert.equal(active(continued.sessionState).ordering.confirmed.screen.pixelHeight,800);
 assert.ok(!active(continued.sessionState).ordering.confirmed.providedDevices?.some(device=>device.modelId==='HD-R716'));
}));

test('An expert request with multiple actions cannot silently apply only its engineering clause',async()=>fixture(async({say,observed})=>{
 const before=await seed(say),confirmed=structuredClone(active(before).ordering.confirmed);
 const expert=await say('改成同步，同时查R712灰阶','expert');
 assert.deepEqual(ordering(expert.sessionState).ordering.confirmed,confirmed);assert.deepEqual(ordering(observed[0]).ordering.confirmed,confirmed);
 const continued=await say('继续配单');assert.equal(active(continued.sessionState).ordering.confirmed.controlMode,undefined);assert.equal(active(continued.sessionState).ordering.confirmed.screen.pixelWidth,1600);
}));
