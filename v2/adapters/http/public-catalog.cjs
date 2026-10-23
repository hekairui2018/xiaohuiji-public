'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
// Only an explicit, locally approved cloud-object list is publishable. Never expose G-drive IDs.
function createPublicCatalog({configFile,allowlistFile,now=Date.now,localRelease=null}={}){
 const cfg=localRelease?{AccessKeyId:'unused',AccessKeySecret:'unused',Region:'oss-local',Bucket:'local'}:JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));
 if(!cfg.AccessKeyId||!cfg.AccessKeySecret||!/^oss-[a-z0-9-]+$/.test(cfg.Region)||!/^[a-z0-9-]+$/.test(cfg.Bucket))throw Error('Public cloud configuration unavailable');
 const list=localRelease?{schemaVersion:'v2-public-cloud-1',objects:localRelease.grants().map(r=>({name:r.name,key:'official-files/'+r.name}))}:JSON.parse(fs.readFileSync(allowlistFile,'utf8'));
 if(list.schemaVersion!=='v2-public-cloud-1'||!Array.isArray(list.objects))throw Error('Invalid public cloud allowlist');
 const approved=new Map();for(const item of list.objects){if(typeof item.name!=='string'||item.key!=='official-files/'+item.name||/[\\/\0]/.test(item.name))throw Error('Invalid approved object identity');approved.set(item.name,item.key);}
 function sign(name){if(localRelease)return localRelease.urlFor(name);const key=approved.get(name);if(!key)return null;const expires=Math.floor(now()/1000)+300;
  const signature=crypto.createHmac('sha1',cfg.AccessKeySecret).update('GET\n\n\n'+expires+'\n/'+cfg.Bucket+'/'+key).digest('base64');
  return 'https://'+cfg.Bucket+'.'+cfg.Region+'.aliyuncs.com/'+key.split('/').map(encodeURIComponent).join('/')+'?'+new URLSearchParams({OSSAccessKeyId:cfg.AccessKeyId,Expires:String(expires),Signature:signature});
 }
 const hidden=new Set(['catalogSourceLabel','sourceGroup','documentMetadata','parameterEvidence','source','relations','sourceDirectory','matchedLocations','candidatePassages','locator','scopeEvidence','classificationBasis','classificationConflict','sha256','originalSha256','blockId','sourceReference','sourceReferences','sourceExcerpt','originalPath','alternativeOriginalPaths','localPath','path','file','record','identityEvidence','rawEvidence','toolTrace','classificationEvidence','resourceId','resourceVersionId','versionId','fileId','sourceLocationId']);
 const urlName=v=>{try{return decodeURIComponent(new URL(v,'http://localhost').pathname.split('/').pop());}catch{return '';}};
 const publicLinks=new Set(['https://www.led-cloud.cn','https://www.led-cloud.com','https://app.xiaohuiyun.com']);
 hidden.add('alternativeUrls');hidden.add('materialPropertyBasis');hidden.add('videoAccessChecked');
 hidden.add('sourceDirectories');hidden.add('sourceAssociations');hidden.add('accessBasis');
 function transform(value){
  if(Array.isArray(value))return value.map(transform);
  if(value&&typeof value==='object'){
   const out={};for(const [key,v]of Object.entries(value)){if(hidden.has(key))continue;
    if(key==='imageUrl'&&localRelease&&v==='/v2/software-access/screen-control.png'){out[key]='/img/software-screen-control.png';continue;}
    if(['url','publicUrl','downloadUrl','manualUrl','download','readUrl','original'].includes(key)&&typeof v==='string'){out[key]=value.accessRestricted||!localRelease&&/\.(mp4|webm|mov)$/i.test(value.name||'')&&!value.videoAccessChecked?null:localRelease&&publicLinks.has(v)?v:sign(approved.has(value.file)?value.file:approved.has(value.name)?value.name:localRelease?urlName(v):value.clean||'');continue;}
    out[key]=transform(v);
   }
   if(typeof value.name==='string'&&(/\.(pdf|docx)$/i.test(value.name)||value.kind==='spec'||value.kind==='manual')){
    out.url=value.accessRestricted?null:sign(value.name);out.available=!!out.url;out.unavailableReason=out.url?null:'not-approved-for-public-access';out.unavailableMessage=out.url?null:'此资料尚未开通公网访问';
   }
   if(Array.isArray(value.specFiles))out.specLinks=value.specFiles.map(sign);
   return out;
  }
  return typeof value==='string'?value.replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n|<>"']+|\\\\[^\r\n|<>"']+/g,'[内部位置]'):value;
 }
 // Scope the provider BEFORE quick retrieval. Public tools never receive the
 // internal index, cases, local resolver or source paths.
 function scopeApp(app){
  const approvedDocument=d=>approved.has(d.name||d.file||'')&&!require('../../domain/knowledge/resource-access.cjs').accessInfo(d,[d]).accessRestricted;
  const products=app.quickBrowse().map(p=>({...p,
   documents:(p.documents||[]).filter(d=>['spec','manual'].includes(d.kind)&&approvedDocument(d)),
   firmware:(p.firmware||[]).filter(approvedDocument),
   claims:(p.claims||[]).filter(c=>(c.sourceReferences||[c.sourceReference]).some(r=>r&&approved.has(r.originalName)))}));
  const videoSource=app.resourceMedia?.videoCategory?.('')||{groups:[]};
  const publicVideoGroups=(videoSource.topicGroups||videoSource.groups||[]).map(g=>({...g,videos:(g.videos||[]).filter(approvedDocument)})).filter(g=>g.videos.length);
  const publicSoftware=(app.resourceMedia?.softwareItems?.('')||[]).filter(s=>approvedDocument(s)||localRelease&&(approved.has(urlName(s.downloadUrl))||(s.manuals||[]).some(m=>approved.has(m.file))))
   .map(s=>({...s,manuals:(s.manuals||[]).filter(m=>approved.has(m.file||m.name)),videos:{primary:null,more:[]}}));
  const norm=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
  return {...app,quickBrowse:()=>products,quickSearch:q=>({records:products.filter(p=>!q||[p.modelId,p.displayName,...p.aliases||[]].some(m=>norm(m).includes(norm(q))))}),
   quickResources:()=>({}),chipLookup:()=>null,
   resourceMedia:{softwareItems:q=>publicSoftware.filter(s=>!q||norm(s.name).includes(norm(q))),videoCategory:q=>{
    const groups=publicVideoGroups.map(g=>({...g,videos:g.videos.filter(v=>!q||norm(v.name).includes(norm(q)))})).filter(g=>g.videos.length).map(g=>({...g,count:g.videos.length}));
    return {groups,topicGroups:groups,total:groups.reduce((n,g)=>n+g.count,0)};
   }},
   resourceLookup:q=>({items:publicVideoGroups.flatMap(g=>g.videos).filter(v=>!q||norm(v.name).includes(norm(q)))})};
 }
 // Future customer-AI adapter: only explicitly approved content identities are
 // offered. This does not authorize an internal expert/search route.
 const approvedResources=()=>[...approved].map(([name,key])=>({name,cloudObject:key,authorization:'explicit-public-allowlist',url:sign(name)}));
 const resourceRows=localRelease?localRelease.rows().map((r,i)=>({name:r.name,sha256:r.sha256,sizeBytes:r.size,resourceId:'sha256:'+r.sha256,versionId:'sha256:'+r.sha256,locationId:i+1,
  resourceType:r.category==='firmware'?'firmware':r.category==='video'?'video':r.category==='software'?'software':'document',availabilityState:'present',folders:r.relativePath.split('/').slice(0,-1),sourceDrive:'G:',url:sign(r.name)})):null;
 return {transform,scopeApp,approvedResources,approvedCount:approved.size,localRelease,resourceRows:()=>resourceRows};
}
module.exports={createPublicCatalog};
