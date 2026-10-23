'use strict';
// Opt-in local developer adapter, never enabled on the production/legacy server.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
function createLocalKnowledge({resourceBase='http://127.0.0.1:4510',toolBase='http://127.0.0.1:4512'}={}){
 for(const base of [resourceBase,toolBase]){const u=new URL(base);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1')throw Error('local knowledge requires loopback');}
 const clean=s=>String(s||'').replace(/[A-Za-z]:\\[^\r\n|<>"']+|\\\\[^\r\n|<>"']+/g,'[内部路径]').replace(/(?<!\d)1[3-9]\d{9}(?!\d)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[联系方式]');
 const locator=x=>Object.fromEntries(Object.entries(x||{}).filter(([k])=>['part','page','paragraph','table','row','sheet','slide','section','line','charStart','charEnd'].includes(k)).map(([k,v])=>[k,typeof v==='string'?clean(v):v]));
 async function request(base,route,body){const response=await fetch(base+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});return response.json();}
 async function handle(req,res){
  const u=new URL(req.url,'http://localhost'),p=u.pathname,chat=p==='/api/ai/chat'&&req.headers['x-v2-local-knowledge'];
  if(!p.startsWith('/v2/local-knowledge/')&&!chat)return false;
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));return true;};
  if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:'+req.socket.localPort)return send(403,{error:'origin-not-allowed'});
  try{
   if(req.method==='GET'&&p==='/v2/local-knowledge/client.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'../../frontend/local-knowledge.js')));return true;}
   if(req.method==='GET'&&p==='/v2/local-knowledge/cases')return send(200,await request(toolBase,'/experiment/cases'));
   if(req.method==='GET'&&p==='/v2/local-knowledge/search'){
    const q=u.searchParams.get('q')||'',mode=u.searchParams.get('mode')||'all';if(q.length>240||!['all','files','text'].includes(mode))return send(400,{error:'invalid-query'});
    const raw=await request(resourceBase,'/search?q='+encodeURIComponent(q)+'&mode='+mode+'&limit=10');
    return send(200,{query:q,elapsedMs:raw.elapsedMs,results:(raw.results||[]).map(r=>({name:r.name,resourceId:r.resourceId,versionId:r.versionId,blockId:r.blockId,evidenceId:r.sha256&&r.blockId?'block-'+r.blockId:null,text:clean(r.text),locator:locator(r.locator),versions:r.versions,score:r.score,download:r.locationId?'/v2/local-knowledge/file?id='+r.locationId:null}))});
   }
   if(req.method==='GET'&&p==='/v2/local-knowledge/read'){
    const id=u.searchParams.get('block');if(!/^\d+$/.test(id||''))return send(400,{error:'invalid-block'});
    const raw=await request(resourceBase,'/read?block='+id);
    const csv=(raw.locations||[]).some(l=>/\.csv$/i.test(l.path));
    return send(200,{sha256:raw.sha256,blocks:(raw.blocks||[]).map(b=>({blockId:b.id,locator:locator(b.locator),text:clean(csv?b.text.split(' | ').slice(0,3).join(' | '):b.text)}))});
   }
   if(req.method==='GET'&&['/v2/local-knowledge/file','/v2/local-knowledge/download'].includes(p)){
    const id=u.searchParams.get('id'),rid=u.searchParams.get('resourceId'),vid=u.searchParams.get('versionId');
    if(p.endsWith('/file')&&!/^\d+$/.test(id||''))return send(400,{error:'invalid-resource'});
    if(p.endsWith('/download')&&(!/^res-[a-f0-9]{32}$/.test(rid||'')||!/^ver-[a-f0-9]{32}$/.test(vid||'')))return send(400,{error:'invalid-resource-version'});
    const upstream=p.endsWith('/file')?resourceBase+'/resource?id='+id:toolBase+'/download?resourceId='+rid+'&versionId='+vid;
    const r=await fetch(upstream,{signal:AbortSignal.timeout(30000)});res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/octet-stream','Content-Disposition':r.headers.get('content-disposition')||'attachment','X-Content-Type-Options':'nosniff'});
    for await(const chunk of r.body)res.write(chunk);res.end();return true;
   }
   if(req.method==='POST'&&chat){
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16000)return send(413,{error:'body-too-large'});chunks.push(chunk);}
    const b=JSON.parse(Buffer.concat(chunks)),session=b.localSession||b.sessionId;
    if(!/^[A-Za-z0-9_-]{4,70}$/.test(session||''))return send(400,{error:'invalid-session'});
    const trace=await request(toolBase,'/chat',{question:b.message,session,arm:'hybrid',runId:b.localRunId||'ui-'+randomUUID(),evidenceCase:b.localMode==='complete'?b.evidenceCase:undefined,modelDisabled:b.modelDisabled===true,profile:b.localProfile});
    const blocks=[...(trace.providedEvidence?.blocks||[]),...(trace.tools||[]).flatMap(t=>[...(t.result?.blocks||[]),...(t.result?.results||[])])].filter(x=>x.blockId);
    const files=[...(trace.tools||[]).flatMap(t=>t.result?.results||[]),...(trace.providedEvidence?.blocks||[])].filter(x=>x.download||/\.pdf$/i.test(x.sourceName||''));
    const localFiles=[...new Map(files.map(x=>[x.resourceId,{name:x.sourceName,url:'/v2/local-knowledge/download?resourceId='+x.resourceId+'&versionId='+x.versionId}])).values()];
    return send(200,{status:trace.error?'clarify':'answer',reply:(trace.answer||'本轮未获得可用回答，请补充型号和条件。').replace(/\/download\?resourceId=(res-[a-f0-9]{32})&versionId=(ver-[a-f0-9]{32})/g,'/v2/local-knowledge/download?resourceId=$1&versionId=$2'),model:'bonsai-local-tools',localTrace:trace,localFiles,localSources:[...new Map(blocks.map(b=>[b.blockId,{...b,readUrl:'/v2/local-knowledge/read?block='+b.blockId}])).values()]});
   }
   return send(404,{error:'local-route-not-found'});
  }catch{return send(503,{status:'clarify',reply:'本地知识或模型服务暂不可用；产品速查保持独立。',error:'local-upstream-unavailable'});}
 }
 return {handle};
}
module.exports={createLocalKnowledge};
