(function(root){
 'use strict';
 function create({load,ttl=60000,maxEntries=256,now=Date.now}){
  const pages=new Map(),pending=new Map();let version;
  const copy=value=>structuredClone(value);
  async function get(options={}){
   const args={directory:options.directory||'root',offset:options.offset||0,query:options.query||'',sort:options.sort||'name'},key=JSON.stringify(args),cached=pages.get(key);
   if(cached&&now()-cached.time<ttl)return copy(cached.page);
   if(pending.has(key))return copy(await pending.get(key));
   const request=Promise.resolve().then(()=>load(args)).then(page=>{
    if(args.directory==='root'&&!args.query&&page.catalogVersion){if(version&&version!==page.catalogVersion)pages.clear();version=page.catalogVersion;}
    if(!page.catalogVersion||!version||page.catalogVersion===version){pages.delete(key);pages.set(key,{page:copy(page),time:now()});while(pages.size>maxEntries)pages.delete(pages.keys().next().value);}
    return page;
   }).finally(()=>pending.delete(key));
   pending.set(key,request);return copy(await request);
  }
  return {get};
 }
 const api={create};if(typeof module!=='undefined')module.exports=api;root.DirectoryPageCache=api;
})(typeof window!=='undefined'?window:globalThis);
