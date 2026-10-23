'use strict';
// Explicit release manifest, verified originals. No directory traversal or scan.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function createLocalPublicRelease(manifestFile){
 const root=fs.realpathSync(path.dirname(manifestFile)),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8').replace(/^\uFEFF/,''));
 if(manifest.schemaVersion!=='xhj-local-public-files-1')throw Error('invalid-public-release');
 const rows=[],byName=new Map(),byHash=new Map();
 const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
 for(const entry of manifest.files){
  if(!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('invalid-public-hash');
  for(const record of entry.records){
   if(!['spec','manual','firmware','software','video'].includes(record.category))throw Error('invalid-public-category');
   const file=fs.realpathSync(path.resolve(root,record.relativePath)),relative=path.relative(root,file);
   if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('outside-public-release');
   const stat=fs.statSync(file);if(!stat.isFile()||stat.size!==entry.sizeBytes)throw Error('changed-public-original');
   const row={name:record.name,sha256:entry.sha256,category:record.category,file,signature:signature(stat),size:stat.size,relativePath:record.relativePath.replace(/\\/g,'/')};
   if(!row.name||/[\\/\0\r\n]/.test(row.name))throw Error('invalid-public-name');
   if(byName.has(row.name)&&byName.get(row.name).sha256!==row.sha256)throw Error('ambiguous-public-name');
   rows.push(row);byName.set(row.name,row);if(!byHash.has(row.sha256))byHash.set(row.sha256,row);
   // A historically mislabeled extension must not hide the real parsed source
   // identity or cause a Word original to download with a PDF extension.
   const actualName=path.basename(file);
   if(actualName!==row.name){if(byName.has(actualName)&&byName.get(actualName).sha256!==row.sha256)throw Error('ambiguous-actual-public-name');byName.set(actualName,{...row,name:actualName});}
  }
 }
 if(rows.length!==manifest.recordCount||byHash.size!==manifest.uniqueContentCount)throw Error('public-release-count-mismatch');
 // Hash one physical content per identity; independently verify every location.
 for(const row of rows){
  const same=byHash.get(row.sha256);if(row!==same&&row.signature===same.signature)continue;
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(row.file))hash.update(chunk);
  if(hash.digest('hex')!==row.sha256||signature(fs.statSync(row.file))!==row.signature)throw Error('public-original-hash-mismatch');
 }
 const urlFor=name=>{const r=byName.get(name);return r?'/public-files/'+r.sha256+'/'+encodeURIComponent(name):null;};
 const grants=()=>[...byName.values()].map(r=>({name:r.name,sha256:r.sha256,category:r.category,publicDirectory:r.relativePath.split('/').slice(0,-1).join('/'),url:urlFor(r.name)}));
 const available=r=>{try{return fs.realpathSync(r.file)===r.file&&signature(fs.statSync(r.file))===r.signature;}catch{return false;}};
 async function serve(req,res){
  const url=new URL(req.url,'http://localhost'),match=/^\/public-files\/([a-f0-9]{64})\/([^/]+)$/.exec(url.pathname);
  let name;try{name=match&&decodeURIComponent(match[2]);}catch{}
  const r=name&&byName.get(name);
  if(!r||r.sha256!==match[1]){res.writeHead(404);res.end();return;}
  if(!available(r)){res.writeHead(409);res.end();return;}
  const ext=path.extname(r.file).toLowerCase(),type=({'.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.png':'image/png','.jpg':'image/jpeg'})[ext]||'application/octet-stream';
  const inline=type!=='application/octet-stream'&&url.searchParams.get('download')!=='1';
  const headers={'Content-Type':type,'Content-Disposition':(inline?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(path.basename(r.file)),'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=0, must-revalidate',ETag:'"'+r.sha256+'"'};
  let start=0,end=r.size-1,partial=false;
  if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
   if(!m||!m[1]&&!m[2]){res.writeHead(416,{'Content-Range':'bytes */'+r.size});res.end();return;}
   if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),end);}else start=Math.max(0,r.size-Number(m[2]));
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=r.size){res.writeHead(416,{'Content-Range':'bytes */'+r.size});res.end();return;}partial=true;
  }
  headers['Content-Length']=end-start+1;if(partial)headers['Content-Range']=`bytes ${start}-${end}/${r.size}`;
  res.writeHead(partial?206:200,headers);if(req.method==='HEAD'){res.end();return;}
  const stream=fs.createReadStream(r.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }
 let snapshotAt=0,snapshot=[];
 const availableGrants=()=>{if(Date.now()-snapshotAt>250){snapshot=grants().filter(r=>available(byName.get(r.name)));snapshotAt=Date.now();}return snapshot;};
 return {urlFor,grants,serve,rows:()=>rows.map(r=>({...r})),availableGrants};
}
module.exports={createLocalPublicRelease};
