'use strict';
// One cached read model for product/spec consumers. Original records remain untouched.
const fs=require('node:fs'),path=require('node:path');
const {normalizeModel,documentBelongs,mentionsModel,conflictingRelative}=require('./model-identity.cjs');
function createProductData(products,specs){
  const names=products.map(p=>p.product||p.displayName);
  const relatives=new Map(names.map(name=>{const key=normalizeModel(name);return [key,names.filter(n=>{const k=normalizeModel(n);return k!==key&&(k.startsWith(key)||key.startsWith(k));})];}));
  const relative=(text,name)=>conflictingRelative(text,name,relatives.get(normalizeModel(name))||[]);
  const issues=[];
  const foreignOnlyModels=new Set(specs.filter(s=>{
    const name=s.product||s.displayName,files=s.specificationFiles||[];
    return files.length&&files.every(f=>!documentBelongs(f,name)&&relative(f,name));
  }).map(s=>normalizeModel(s.product||s.displayName)));
  const clean=(sentence,name,field)=>{
    const other=relative(sentence,name);
    if(other){
      const explicitlyOwn=mentionsModel(sentence,name);
      const exclude=!explicitlyOwn&&foreignOnlyModels.has(normalizeModel(name));
      issues.push({model:name,field,foreignModel:other,text:sentence,action:exclude?'exclude-foreign-statement':'review-shared-statement'});
      return !exclude;
    }
    return true;
  };
  const productRows=products.map(p=>{
    const name=p.product||p.displayName;
    return {...p,facts:(p.facts||[]).filter(s=>clean(s,name,'facts')),
      fields:Object.fromEntries(Object.entries(p.fields||{}).map(([k,v])=>[k,Array.isArray(v)?v.filter(s=>clean(s,name,'fields.'+k)):v]))};
  });
  const specMap=Object.create(null);
  for(const s of specs){
    const name=s.product||s.displayName;
    const files=s.specificationFiles||[],own=files.filter(f=>documentBelongs(f,name));
    // A generic source title lacking a model is not proof that its parameters are foreign.
    const foreignOnly=files.length>0&&own.length===0&&files.every(f=>relative(f,name));
    const keyParameters=Object.fromEntries(Object.entries(s.keyParameters||{}).map(([k,v])=>[k,
      String(v||'').split(/[?？]/).filter(t=>clean(t,name,'keyParameters.'+k))
        .filter(t=>!foreignOnly||mentionsModel(t,name)).join('?')]));
    const guarded={...s,keyParameters,specificationFiles:own,
      officialPdfLinks:(s.officialPdfLinks||[]).filter(f=>documentBelongs(f,name))};
    specMap[name]=guarded;
    if(s.displayName)specMap[s.displayName]=guarded;
    for(const f of files.filter(f=>!own.includes(f)))issues.push({model:name,field:'specificationFiles',file:f,reason:'non-owning-model'});
  }
  const aliases=new Map();
  for(const p of productRows)for(const a of [p.product||p.displayName,...(p.aliases||[])]){
    const key=normalizeModel(a);if(!key)continue;const owners=aliases.get(key)||new Set();owners.add(p.product||p.displayName);aliases.set(key,owners);
  }
  return {products:productRows,specs:specMap,issues,
    resolveModel(value){const owners=aliases.get(normalizeModel(value));return owners?.size===1?[...owners][0]:null;},
    ambiguousAliases:[...aliases].filter(([,v])=>v.size>1).map(([alias,v])=>({alias,owners:[...v]}))};
}
let cached;
function loadProductData(){
  if(cached)return cached;
  const read=file=>JSON.parse(fs.readFileSync(path.join(__dirname,'..','data',file),'utf8').replace(/^\uFEFF/,''));
  cached=createProductData(read('product-index.json').products||[],read('product-specs-index.json').products||[]);
  return cached;
}
module.exports={createProductData,loadProductData};
