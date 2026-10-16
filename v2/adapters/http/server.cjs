'use strict';
const http=require('node:http');
const {createApp}=require('../../app/bootstrap.cjs');
const {createQuickService}=require('./quick-service.cjs');
const {createDialogueService}=require('./dialogue-service.cjs');
const {serveStatic}=require('./static-service.cjs');
const {createOriginalResource}=require('./original-resource.cjs');
function createServer(app=createApp(),{localKnowledge=null}={}){
 // Customer HTTP routes always use the activation-gated pipeline. Raw domain remains for audits.
 app={...app,dialogue:app.customerDialogue||app.dialogue};
 const quick=createQuickService(app),dialogue=createDialogueService(app),original=createOriginalResource({evidenceDocuments:app.originalDocuments});
 return http.createServer(async(req,res)=>{
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  const route=req.url.split('?')[0];
  if(localKnowledge&&await localKnowledge.handle(req,res))return;
  if(req.method==='GET'&&['/health','/api/health'].includes(route)){send(200,app.health());return;}
  if(req.method==='GET'){
   const url=new URL(req.url,'http://localhost'),q=url.searchParams.get('q')||'';
   if(route.startsWith('/v2/resources/original/')){await original(route.slice('/v2/resources/original/'.length),res);return;}
   if(route==='/api/search'){send(200,quick.search(q));return;}
   if(route==='/api/software'){send(200,quick.software(q));return;}
   if(route==='/api/videos'){send(200,quick.videos(q));return;}
   if(route==='/api/docs'){const cat=url.searchParams.get('cat');if(!['spec','manual','firmware'].includes(cat)){send(400,{error:'invalid_category'});return;}send(200,quick.docs(cat));return;}
   if(serveStatic(req,res,undefined,{localKnowledge:!!localKnowledge}))return;
  }
  if(req.method!=='POST'||!['/v2/quick/products','/v2/dialogue','/api/ai/chat','/v2/ordering/ssm'].includes(route)){send(404,{error:'not_found'});return;}
  let size=0,chunks=[];
  try{for await(const chunk of req){size+=chunk.length;if(size>65536){send(413,{error:'body_too_large'});return;}chunks.push(chunk);}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'invalid_json'});return;}
   if(route==='/v2/ordering/ssm'){const output=await app.exportSsm(input);if(output.status!=='ready'){send(output.status==='invalid_request'?400:422,output);return;}
    res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Content-Disposition':'attachment; filename="xiaohuiji-v2.ssm"','X-SSM-Scope':'standard-grid-import-only'});res.end(output.xml);return;
   }
   const output=route==='/v2/quick/products'?app.quickLookup(input):route==='/api/ai/chat'?await dialogue(input):await app.dialogue(input);
   send(output.status==='invalid_request'?400:200,output);
  }catch{send(500,{error:'internal_error'});}
 });
}
if(require.main===module){const port=Number(process.argv[2]||4389);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');const localKnowledge=process.env.XHJ_LOCAL_KNOWLEDGE==='1'?require('./local-knowledge.cjs').createLocalKnowledge():null;createServer(undefined,{localKnowledge}).listen(port,'127.0.0.1',()=>console.log('v2 local server: '+port));}
module.exports={createServer};
