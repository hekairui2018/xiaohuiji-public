'use strict';
const http=require('node:http');
const {createApp}=require('../../app/bootstrap.cjs');
const {createQuickService}=require('./quick-service.cjs');
const {createDialogueService}=require('./dialogue-service.cjs');
const {serveStatic}=require('./static-service.cjs');
const {createOriginalResource}=require('./original-resource.cjs');
function createServer(app=createApp(),{localKnowledge=null,offlineKnowledge=null,accessGuard=null,publicCatalog=null}={}){
 // Customer HTTP routes always use the activation-gated pipeline. Raw domain remains for audits.
 app={...app,dialogue:app.customerDialogue||app.dialogue};
 const publicQuick=createQuickService(app,{resolveDocuments:offlineKnowledge?.resolveDocuments});
 const localQuick=createQuickService(app,{resolveDocuments:offlineKnowledge?.resolveDocuments,localCatalog:offlineKnowledge?.localCatalog}),dialogue=createDialogueService(app),original=createOriginalResource({evidenceDocuments:app.originalDocuments});
 const orderingDialogue=createDialogueService(app,{operation:'ordering'});
 return http.createServer(async(req,res)=>{
  if(accessGuard&&!accessGuard(req,res))return;
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',...(req.v2Public?{'Cache-Control':'no-store'}:{})});res.end(JSON.stringify(req.v2Public?publicCatalog.transform(body):body));};
  const route=req.url.split('?')[0];
  if(req.v2Public&&!publicCatalog){res.writeHead(503);res.end('Public resources are not configured');return;}
  if(route==='/'){res.writeHead(302,{Location:'/wiki'});res.end();return;}
  if(!req.v2Public&&offlineKnowledge&&await offlineKnowledge.handle(req,res))return;
  if(!req.v2Public&&localKnowledge&&await localKnowledge.handle(req,res))return;
  if(req.method==='GET'&&['/health','/api/health'].includes(route)){send(200,app.health());return;}
  if(req.method==='GET'){
   const quick=req.v2Public?publicQuick:localQuick;
   const url=new URL(req.url,'http://localhost'),q=url.searchParams.get('q')||'';
   if(route.startsWith('/v2/resources/original/')){await original(route.slice('/v2/resources/original/'.length),res);return;}
   const media=async body=>!req.v2Public&&offlineKnowledge?.localizeMedia?offlineKnowledge.localizeMedia(body):body;
   if(route==='/api/search'){send(200,await media(await quick.search(q)));return;}
   if(route==='/api/software'){send(200,await media(await quick.software(q)));return;}
   if(route==='/api/videos'){
    const body=quick.videos(q);
    if(url.searchParams.get('outline')==='1'){
     if(!req.v2Public&&offlineKnowledge?.localizeMedia)send(200,await offlineKnowledge.localizeMedia(body,{metadataOnly:true}));
     else send(200,{cat:'video',metadataOnly:true,groups:body.video.topicGroups.map(g=>({key:g.key,label:g.label,count:g.count})),total:body.video.total});
    }else send(200,await media(body));return;
   }
   if(route==='/api/docs'){
    const cat=url.searchParams.get('cat'),history=url.searchParams.get('history')||'current';
    if(req.v2Public&&(!['spec','manual','firmware'].includes(cat)||history!=='current')){send(403,{error:'public-catalog-scope-not-enabled'});return;}
    if(!['spec','manual','firmware','other','pending','history'].includes(cat)||!['current','all','only'].includes(history)){send(400,{error:'invalid_category_or_history'});return;}
    const limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):null,offset=Number(url.searchParams.get('offset')||0);
    const view=url.searchParams.get('view')||'grouped';if(!['grouped','flat'].includes(view)){send(400,{error:'invalid_view'});return;}
    if(!Number.isInteger(offset)||offset<0||(limit!==null&&(!Number.isInteger(limit)||limit<1||limit>200))||(offset&&limit===null)){send(400,{error:'invalid_pagination'});return;}
    send(200,await media(await quick.docs(cat,{includeHistory:history==='all',historyOnly:cat==='history'||history==='only',websiteOnly:true,offset,limit,view})));return;
   }
   if(serveStatic(req,res,undefined,{localKnowledge:!req.v2Public&&!!localKnowledge,offlineKnowledge:!req.v2Public&&!!offlineKnowledge}))return;
  }
  if(req.method!=='POST'||!['/v2/wiki/products','/v2/quick/products','/v2/dialogue','/api/ai/chat','/v2/ordering/chat','/v2/ordering/ssm'].includes(route)){send(404,{error:'not_found'});return;}
  let size=0,chunks=[];
  try{for await(const chunk of req){size+=chunk.length;if(size>65536){send(413,{error:'body_too_large'});return;}chunks.push(chunk);}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'invalid_json'});return;}
   if(route==='/v2/ordering/ssm'){const output=await app.exportSsm(input);if(output.status!=='ready'){send(output.status==='invalid_request'?400:422,output);return;}
    res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Content-Disposition':'attachment; filename="xiaohuiji-v2.ssm"','X-SSM-Scope':'standard-grid-import-only'});res.end(output.xml);return;
   }
   const output=['/v2/wiki/products','/v2/quick/products'].includes(route)?app.quickLookup(input):route==='/v2/ordering/chat'?await orderingDialogue(input):route==='/api/ai/chat'?await dialogue(input):await app.dialogue(input);
   send(output.status==='invalid_request'?400:200,output);
  }catch{send(500,{error:'internal_error'});}
 });
}
if(require.main===module){const port=Number(process.argv[2]||4389);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');const localKnowledge=process.env.XHJ_LOCAL_KNOWLEDGE==='1'?require('./local-knowledge.cjs').createLocalKnowledge():null;createServer(undefined,{localKnowledge}).listen(port,'127.0.0.1',()=>console.log('v2 local server: '+port));}
module.exports={createServer};
