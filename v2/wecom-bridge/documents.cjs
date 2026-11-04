'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
function createDocuments({manifestFile,manifestFiles=[],rootDirectory,maxFiles=12}={}){
 async function prepare(results){
  if(!manifestFile&&!manifestFiles.length||!rootDirectory)return [];
  const root=await fs.realpath(rootDirectory),items=[];
  for(const file of [...new Set([manifestFile,...manifestFiles].filter(Boolean))]){const m=JSON.parse(await fs.readFile(file,'utf8'));if(!['xhj-curated-documents-1','xhj-curated-videos-1','xhj-curated-firmware-1'].includes(m.schemaVersion))throw Error('unapproved-document-manifest');items.push(...m.items);}
  const files=[],seen=new Set();
  for(const r of results||[]){
   if(files.length>=maxFiles)break;
   if(r.accessRestricted||r.classificationConflict||!/^[a-f0-9]{64}$/.test(r.sha256||'')||seen.has(r.sha256))continue;
   const item=items.find(i=>i.name===r.name&&i.sha256===r.sha256);
   if(!item||!Number.isSafeInteger(item.size)||item.size<=0||item.size>20*1024*1024||/[\\/\0\r\n]/.test(item.name))continue;
   try{
    const file=await fs.realpath(path.resolve(root,item.relativePath)),relative=path.relative(root,file);
    if(relative.startsWith('..')||path.isAbsolute(relative))continue;
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size!==item.size)continue;
    const buffer=await fs.readFile(file);if(buffer.length!==item.size||createHash('sha256').update(buffer).digest('hex')!==item.sha256)continue;
    seen.add(item.sha256);files.push({name:item.name,sha256:item.sha256,brand:item.brand||r.brand||'',language:item.language||r.documentLanguage||'',buffer});
   }catch{}
  }
  return files;
 }
 return {prepare};
}
function fileReply(data,files,render){
 const names=new Set(files.map(f=>f.name));
 const reply=String(data.reply||'').split('\n').filter(line=>!names.has(line.trim())&&!line.includes('同名文件包含不同版别')).join('\n').trim();
 return render({...data,reply,results:[]})+'\n\n'+files.map((f,i)=>(i+1)+'. '+[f.brand,f.language].filter(Boolean).join(' · ')+'｜'+f.name).join('\n')+'\n\n原文件按以上顺序附在下方，可直接打开或保存。';
}
module.exports={createDocuments,fileReply};
