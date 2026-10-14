'use strict';
const {gridEnvelope}=require('../../domain/ordering/output/ssm-codec.cjs'),{auditSsm}=require('../../acceptance/ssm.cjs'),{loadSsmShell}=require('../data/load-ssm-shell.cjs');
function createTrialClient(base){
 const url=new URL(base);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Trial client is loopback only');
 async function post(route,input){const r=await fetch(new URL(route,url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});const body=await r.json();if(r.status>=500)throw Error('Trial HTTP failure '+r.status);return body;}
 return {dialogue:input=>post('/v2/dialogue',input),quickLookup:query=>post('/v2/quick/products',query),resourceLookup:async(topic,{providedDevices}={})=>(await post('/v2/dialogue',{schemaVersion:'2.0',operation:'consultation',topic,providedDevices:providedDevices||[]})).resources,
  async exportSsm(input){const r=await fetch(new URL('/v2/ordering/ssm',url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});if(!r.ok)return r.json();const xml=await r.text(),exported={xml,gridXml:gridEnvelope(xml).gridXml,metadata:{hardwareDownloadVerified:false}};exported.acceptance=auditSsm(exported,await post('/v2/dialogue',input),loadSsmShell());return {status:'ready',...exported};}};
}
module.exports={createTrialClient};
