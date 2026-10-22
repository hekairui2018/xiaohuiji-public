'use strict';
// Read existing registered CSV rows through the original preview API. No new
// corpus, generated answers, model calls, disk scans or alternative RAG store.
const key=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s，,。！？!?；;]/g,'');
function createRegisteredFaq({findFiles,readPage,authorize,normalize,clean=s=>s}){
 let files=null,expires=0,pending=null;const cache=new Map();
 async function sources(){
  if(files&&Date.now()<expires)return files;
  if(pending)return pending;
  pending=(async()=>{
   const found=await findFiles(),unique=new Map();
   for(const f of found)if(/\.csv$/i.test(f.name)&&/FAQ|FQA|常见问题|问答/i.test(f.name)&&f.sha256){let id=f.locationId||f.locations?.[0]?.id;try{id=id||Number(new URL(f.download||f.url||'','http://local').searchParams.get('id'));}catch{}if(Number.isInteger(id)&&id>0)unique.set(f.sha256,{...f,locationId:id});}
   if(unique.size>32)throw Error('faq-source-bound-exceeded');
   files=[...unique.values()];expires=Date.now()+30000;
   for(const hash of cache.keys())if(!unique.has(hash))cache.delete(hash);
   return files;
  })();
  try{return await pending;}finally{pending=null;}
 }
 async function rows(file){
  if(cache.has(file.sha256))return cache.get(file.sha256);
  const load=(async()=>{
   const out=[];let offset=0,header=null;
   do{
    const page=await readPage(file.locationId,offset);
    if(page.sha256!==file.sha256||page.name!==file.name)throw Error('faq-original-identity-mismatch');
    for(const block of page.blocks||[]){
     const cells=block.locator?.cells;if(!Array.isArray(cells))continue;
     if(block.locator.row===1){header=cells;continue;}
     const questionColumn=header?.findIndex(c=>/问题描述|问题现象|客户问题|问题$/.test(c)),answerColumn=header?.findIndex(c=>/解决|答案|处理方法/.test(c));
     if(questionColumn<0||answerColumn<0||questionColumn===undefined||answerColumn===undefined)continue;
     const question=String(cells[questionColumn]||'').replace(/\\n/g,'\n').replace(/\\t/g,'\t').trim(),answer=String(cells[answerColumn]||'').replace(/\\n/g,'\n').replace(/\\t/g,'\t').trim();
     if(!question||!answer)continue;
     const normalized=normalize({...file,blockId:block.id,text:question+'\n'+answer,locator:{row:block.locator.row},locations:file.locations||[{id:file.locationId}]});
     out.push({...normalized,sourceDirectory:file.sourceDirectory||normalized.sourceDirectory,source:{...normalized.source,sourceDirectory:file.sourceDirectory||normalized.sourceDirectory},type:'faq',standardQuestion:clean(question),standardAnswer:clean(answer),questionKey:key(question),faqExact:true,evidenceId:'faq-'+file.sha256+'-row-'+block.locator.row});
    }
    if(page.nextOffset!==null&&(!Number.isInteger(page.nextOffset)||page.nextOffset<=offset))throw Error('faq-pagination-invalid');
    offset=page.nextOffset;
    if(out.length>5000||offset>5000)throw Error('faq-record-bound-exceeded');
   }while(offset!==null);
   return out;
  })();cache.set(file.sha256,load);
  try{return await load;}catch(e){cache.delete(file.sha256);throw e;}
 }
 async function lookup(question){
  const wanted=key(question);if(!wanted)return [];
  const found=[];
  // Permission is checked every request, including warm-cache lookups. Metadata
  // denial never returns cached row content from a previous authorized request.
  for(const file of await sources()){
   const cached=cache.get(file.sha256);
   if(cached){
    const matched=(await cached).filter(r=>r.questionKey===wanted);
    if(matched.length&&await authorize(file.locationId,file))found.push(...matched);
   }else if(await authorize(file.locationId,file))found.push(...(await rows(file)).filter(r=>r.questionKey===wanted));
  }
  return found.map(({questionKey,...r})=>r);
 }
 // FTS decides which original rows are candidates. Restore only those exact
 // hash/row identities from the registered CSV, not a second fuzzy FAQ index.
 lookup.hydrate=async function(candidates){
  const sourceFiles=await sources(),out=[];
  for(const candidate of candidates){
   const file=sourceFiles.find(f=>f.sha256===candidate.sha256);
   if(!file){out.push(candidate);continue;}
   if(!await authorize(file.locationId,file))continue;
   const row=(await rows(file)).find(r=>Number(r.locator.row)===Number(candidate.locator?.row));
   if(row)out.push({...candidate,...row,faqExact:false});
  }
  return out;
 };
 return lookup;
}
module.exports={createRegisteredFaq,faqQuestionKey:key};
