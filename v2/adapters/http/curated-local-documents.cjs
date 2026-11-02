'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function createCuratedLocalDocuments({manifestFile,rootDirectory,resourceBase='http://127.0.0.1:8521'}){
 const root=fs.realpathSync(rootDirectory),data=JSON.parse(fs.readFileSync(manifestFile,'utf8').replace(/^\uFEFF/,''));
 if(data.schemaVersion!=='xhj-curated-documents-1'||!data.models||!Array.isArray(data.items))throw Error('invalid-document-manifest');
 // Optional top-directory -> kind map. The live public root keeps its approved
 // business folders (产品规格书（LED） etc.) instead of literal 规格书/说明书, so the
 // map is declared by the manifest itself while the security checks below stay.
 const kindDirectories=(data.kindDirectories&&typeof data.kindDirectories==='object')?data.kindDirectories:{};
 const byKey=new Map(),entries=[],signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
 for(const item of data.items){
  const softwareManual=item.kind==='manual'&&item.subjectType==='software'&&typeof item.software==='string'&&!!item.software.trim()&&Array.isArray(item.models)&&!item.models.length;
  if(!/^[a-f0-9]{64}$/.test(item.sha256)||!['spec','manual'].includes(item.kind)||typeof item.name!=='string'||/[\\/\0\r\n]/.test(item.name)||!Array.isArray(item.models)||!softwareManual&&(!item.models.length||item.models.some(m=>!data.models[m])))throw Error('invalid-document-identity');
  const file=fs.realpathSync(path.resolve(root,item.relativePath)),rel=path.relative(root,file);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('document-outside-root');
  const topDirectory=rel.split(path.sep)[0],mappedKind=kindDirectories[topDirectory];
  const allowed=mappedKind==null?null:(Array.isArray(mappedKind)?mappedKind:[mappedKind]);
  if(allowed?!allowed.includes(item.kind):topDirectory!==(item.kind==='spec'?'规格书':'说明书'))throw Error('document-outside-root');
  const stat=fs.statSync(file);if(!stat.isFile()||stat.size!==item.size)throw Error('document-changed');
  const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);
  if(h.digest('hex')!==item.sha256||signature(fs.statSync(file))!==signature(stat))throw Error('document-hash-mismatch');
  const e={...item,file,signature:signature(stat)};entries.push(e);const k=item.sha256+'\0'+item.name;if(byKey.has(k)&&byKey.get(k).file!==file)throw Error('duplicate-document-identity');byKey.set(k,e);
 }
 const available=e=>{try{return fs.realpathSync(e.file)===e.file&&signature(fs.statSync(e.file))===e.signature;}catch{return false;}};
 const display=e=>{const url='/v2/curated-documents/'+e.sha256+'/'+encodeURIComponent(e.name),previewUrl=/\.docx?$/i.test(e.name)?'/v2/curated-documents-preview/'+e.sha256+'/'+encodeURIComponent(e.name):null;return {name:e.name,clean:e.subjectType==='software'?e.name:e.name.replace(/\.(pdf|docx?)$/i,''),url,previewUrl,downloadUrl:url+'?download=1',kind:e.kind,available:true,sha256:e.sha256,brand:e.brand||null,documentLanguage:e.language||null,documentEdition:e.brand==='中性版'?'neutral':e.brand==='品牌版'?'standard':null,associatedModels:e.models,associationStatus:'g-public-catalog-association'};};
 function docs(kind){const groups=new Map();for(const e of entries)if(e.kind===kind&&available(e))for(const model of e.models){const cat=data.models[model];if(!groups.has(cat))groups.set(cat,new Map());const models=groups.get(cat);if(!models.has(model))models.set(model,{model,label:model,items:[]});models.get(model).items.push(display(e));}
  const result=[...groups].map(([label,products])=>({key:label,label,products:[...products.values()].map(p=>({...p,count:p.items.length})),count:products.size}));const all=result.flatMap(g=>g.products.flatMap(p=>p.items));return {localCurated:true,groups:result,total:all.length,associationCount:all.length,modelCount:new Set(result.flatMap(g=>g.products.map(p=>p.model))).size,uniqueFileCount:new Set(all.map(e=>e.sha256)).size};}
 function augment(body){for(const p of body.results||[]){const model=p.modelId||p.name;const es=entries.filter(e=>e.models.includes(model)&&available(e));const groups=['spec','manual'].map(kind=>({key:kind,label:kind==='spec'?'规格书':kind==='manual'?'使用说明书':'其他资料',items:es.filter(e=>e.kind===kind).map(display)})).filter(g=>g.items.length);p.specGroups=groups;p.docGroups=[...groups,...(p.firmwareGroup?[p.firmwareGroup]:[])];p.specFiles=groups.flatMap(g=>g.items.map(i=>i.name));p.specLinks=groups.flatMap(g=>g.items.map(i=>i.url));}return body;}
 async function serve(req,res){const u=new URL(req.url,'http://localhost'),m=/^\/v2\/curated-documents\/([a-f0-9]{64})\/([^/]+)$/.exec(u.pathname);let name;try{name=m&&decodeURIComponent(m[2]);}catch{}const e=m&&name&&byKey.get(m[1]+'\0'+name);if(!e){res.writeHead(404);res.end();return;}if(!available(e)){res.writeHead(409);res.end();return;}
  const ext=path.extname(e.name).toLowerCase(),mime=ext==='.pdf'?'application/pdf':'application/octet-stream';let start=0,end=e.size-1,partial=false;
  if(req.headers.range){const a=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!a||!a[1]&&!a[2]){res.writeHead(416,{'Content-Range':'bytes */'+e.size});res.end();return;}if(a[1]){start=Number(a[1]);if(a[2])end=Math.min(Number(a[2]),end);}else start=Math.max(0,e.size-Number(a[2]));if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=e.size){res.writeHead(416,{'Content-Range':'bytes */'+e.size});res.end();return;}partial=true;}
  const head={'Content-Type':mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Disposition':(u.searchParams.get('download')==='1'||mime!=='application/pdf'?'attachment':'inline')+"; filename*=UTF-8''"+encodeURIComponent(e.name),'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'};if(partial)head['Content-Range']=`bytes ${start}-${end}/${e.size}`;res.writeHead(partial?206:200,head);const stream=fs.createReadStream(e.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }
 async function preview(req,res){
  const u=new URL(req.url,'http://localhost'),m=/^\/v2\/curated-documents-preview\/([a-f0-9]{64})\/([^/]+)$/.exec(u.pathname);let name;try{name=m&&decodeURIComponent(m[2]);}catch{}
  const e=m&&name&&byKey.get(m[1]+'\0'+name);if(!e||!/\.docx?$/i.test(e.name)){res.writeHead(404);res.end();return;}if(!available(e)){res.writeHead(409);res.end();return;}
  try{const query=e.name.replace(/_[a-f0-9]{10}(?=\.)/i,'');const r=await fetch(resourceBase+'/search?q='+encodeURIComponent(query)+'&mode=files&limit=50',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('index-unavailable');const data=await r.json();const item=(data.results||[]).find(x=>x.kind==='file'&&x.sha256===e.sha256&&Number.isInteger(x.locationId));if(item){res.writeHead(302,{Location:'/v2/offline/preview?id='+item.locationId,'Cache-Control':'no-store'});res.end();return;}}catch{}
  const download='/v2/curated-documents/'+e.sha256+'/'+encodeURIComponent(e.name)+'?download=1';res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end('<!doctype html><meta charset="utf-8"><p>此 Word 文件尚无可用文本预览，请下载原文件查看。</p><a href="'+download+'">下载原文件</a>');
 }
 function softwareDocs(){const grouped=new Map();for(const e of entries)if(e.subjectType==='software'&&e.software&&available(e)){if(!grouped.has(e.software))grouped.set(e.software,{model:e.software,label:e.software,subjectType:'software',items:[]});grouped.get(e.software).items.push(display(e));}return [...grouped.values()];}
 const productDocs=docs;
 function allDocs(kind){const result=productDocs(kind);if(kind!=='manual')return result;const products=softwareDocs();if(!products.length)return result;const added=products.flatMap(p=>p.items);return {...result,groups:[...result.groups,{key:'software-manuals',label:'软件使用说明',products,count:products.length}],total:result.total+added.length,associationCount:result.associationCount+added.length,modelCount:result.modelCount+products.length,uniqueFileCount:new Set([...result.groups.flatMap(g=>g.products.flatMap(p=>p.items)),...added].map(i=>i.sha256)).size};}
 function augmentSoftware(body){const byName=new Map(softwareDocs().map(p=>[p.model.replace(/\s/g,'').toLowerCase(),p.items]));for(const s of body.software?.items||[]){s.manuals=(byName.get(s.name.replace(/\s/g,'').toLowerCase())||[]).map(i=>({...i,label:i.name}));}return body;}
 const publicSoftwareResources=()=>softwareDocs().flatMap(p=>p.items);
 return {docs:allDocs,augment,augmentSoftware,publicSoftwareResources,serve,preview};
}
module.exports={createCuratedLocalDocuments};
