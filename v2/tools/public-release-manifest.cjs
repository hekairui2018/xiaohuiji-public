'use strict';
// Local management view of the existing approval list. Never approves/uploads originals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const categories=Object.freeze({spec:'规格书',manual:'说明书',software:'软件',video:'视频',firmware:'固件'});
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const csv=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
function plan({allowlistFile,products,visibleNames=null}){
 const bytes=fs.readFileSync(allowlistFile),allow=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
 if(allow.schemaVersion!=='v2-public-cloud-1'||!Array.isArray(allow.objects))throw Error('Unsupported approval list');
 const identities=new Map(),seen=new Set(),rows=[];
 for(const p of products)for(const d of [...p.documents||[],...p.firmware||[]]){
  const name=d.name||d.file,kind=d.kind;if(!name||!Object.hasOwn(categories,kind))continue;
  if(!identities.has(name))identities.set(name,{kinds:new Set(),models:new Set()});
  identities.get(name).kinds.add(kind);identities.get(name).models.add(p.displayName||p.modelId||'');
 }
 for(const object of allow.objects){
  if(typeof object.name!=='string'||object.key!=='official-files/'+object.name||/[\\/\0]/.test(object.name)||seen.has(object.name))throw Error('Invalid or duplicate approved identity');
  seen.add(object.name);const found=identities.get(object.name);
  if(!found||found.kinds.size!==1)throw Error('Missing or conflicting registered category: '+object.name);
  rows.push({name:object.name,category:[...found.kinds][0],models:[...found.models].filter(Boolean).sort(),key:object.key,
   approval:'既有清单已批准',visibility:visibleNames?(visibleNames.has(object.name)?'当前公网列表可见':'当前列表未展示；不等于已失效'):'未核对当前页面'});
 }
 rows.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans-CN',{numeric:true}));
 const counts=Object.fromEntries(Object.keys(categories).map(k=>[k,rows.filter(r=>r.category===k).length]));
 const files={};
 for(const [key,label]of Object.entries(categories)){
  const lines=[['文件名','关联产品（登记关联，不是兼容证明）','批准状态','当前列表状态','云端对象']];
  for(const r of rows.filter(r=>r.category===key))lines.push([r.name,r.models.join('、'),r.approval,r.visibility,r.key]);
  files[label+'/发布清单.csv']='\uFEFF'+lines.map(line=>line.map(csv).join(',')).join('\r\n')+'\r\n';
 }
 files['目录说明.md']='# 公网发布管理\n\n'+
  '目录沿用规格书、说明书、软件、视频、固件。这里只放管理清单，不复制或移动原件。\n\n'+
  '唯一生效的授权清单：'+path.resolve(allowlistFile)+'\n\n'+
  '本目录CSV由该授权清单和现有产品登记生成；编辑CSV、放入新文件不会自动上架。需要发布时先核对原件身份和公开授权，再更新唯一清单。\n\n'+
  '当前共 '+rows.length+' 份已批准独立文件；'+Object.entries(categories).map(([k,v])=>v+' '+counts[k]).join('、')+'。空目录表示尚无已批准文件，不自动将本地全部资料公开。\n\n'+
  '当前列表未展示可能由版次选择或浏览规则造成，不能据此判定旧版已失效。文件名和登记关联不构成兼容性证明。\n\n'+
  '此管理目录仅在本机，不新增HTTP入口。内部资料、全文检索和原件接口仍按后端权限控制；问答入口本轮不作变更。\n';
 return {files,counts,total:rows.length,sourceSha256:digest(bytes)};
}
function write(plan,output,{apply=false}={}){
 const root=path.resolve(output),marker=path.join(root,'.generated.json');
 const previous=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):null;
 // Verify all destinations before any write; preserve manual edits on conflict.
 for(const name of Object.keys(plan.files)){
  const dest=path.join(root,name);if(!fs.existsSync(dest))continue;
  if(!previous?.hashes?.[name]||digest(fs.readFileSync(dest))!==previous.hashes[name])throw Error('Management file changed; refusing overwrite: '+name);
 }
 if(!apply)return {applied:false,total:plan.total,counts:plan.counts,output:root};
 fs.mkdirSync(root,{recursive:true});
 if(previous){const backup=path.join(root,'备份',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(backup,{recursive:true});for(const name of [...Object.keys(plan.files),'.generated.json']){const src=path.join(root,name);if(fs.existsSync(src)){fs.mkdirSync(path.dirname(path.join(backup,name)),{recursive:true});fs.copyFileSync(src,path.join(backup,name));}}}
 for(const [name,body]of Object.entries(plan.files)){const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body,'utf8');}
 fs.writeFileSync(marker,JSON.stringify({schemaVersion:1,sourceSha256:plan.sourceSha256,hashes:Object.fromEntries(Object.entries(plan.files).map(([k,v])=>[k,digest(v)]))},null,2));
 return {applied:true,total:plan.total,counts:plan.counts,output:root};
}
if(require.main===module){
 try{
  const {values}=require('node:util').parseArgs({options:{allowlist:{type:'string'},knowledge:{type:'string'},output:{type:'string'},visibility:{type:'string'},apply:{type:'boolean',default:false}}});
  if(!values.allowlist||!values.knowledge||!values.output)throw Error('Use --allowlist <JSON> --knowledge <directory> --output <management directory> [--visibility <JSON name array>] [--apply]');
  const knowledge=require('../adapters/data/load-knowledge.cjs').loadKnowledge(path.resolve(values.knowledge),{manifestFile:'candidate-manifest.json'});
  const visibleNames=values.visibility?new Set(JSON.parse(fs.readFileSync(values.visibility,'utf8'))):null;
  console.log(JSON.stringify(write(plan({allowlistFile:values.allowlist,products:knowledge.products(),visibleNames}),values.output,{apply:values.apply})));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={plan,write,categories};
