'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
// Only an explicit, locally approved cloud-object list is publishable. Never expose G-drive IDs.
function createPublicCatalog({configFile,allowlistFile,now=Date.now}={}){
 const cfg=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));
 if(!cfg.AccessKeyId||!cfg.AccessKeySecret||!/^oss-[a-z0-9-]+$/.test(cfg.Region)||!/^[a-z0-9-]+$/.test(cfg.Bucket))throw Error('Public cloud configuration unavailable');
 const list=JSON.parse(fs.readFileSync(allowlistFile,'utf8'));
 if(list.schemaVersion!=='v2-public-cloud-1'||!Array.isArray(list.objects))throw Error('Invalid public cloud allowlist');
 const approved=new Map();for(const item of list.objects){if(typeof item.name!=='string'||item.key!=='official-files/'+item.name||/[\\/\0]/.test(item.name))throw Error('Invalid approved object identity');approved.set(item.name,item.key);}
 function sign(name){const key=approved.get(name);if(!key)return null;const expires=Math.floor(now()/1000)+300;
  const signature=crypto.createHmac('sha1',cfg.AccessKeySecret).update('GET\n\n\n'+expires+'\n/'+cfg.Bucket+'/'+key).digest('base64');
  return 'https://'+cfg.Bucket+'.'+cfg.Region+'.aliyuncs.com/'+key.split('/').map(encodeURIComponent).join('/')+'?'+new URLSearchParams({OSSAccessKeyId:cfg.AccessKeyId,Expires:String(expires),Signature:signature});
 }
 const hidden=new Set(['sourceReference','sourceReferences','sourceExcerpt','originalPath','alternativeOriginalPaths','localPath','path','file','record','identityEvidence','rawEvidence','toolTrace','classificationEvidence','resourceId','resourceVersionId','versionId','fileId','sourceLocationId']);
 function transform(value){
  if(Array.isArray(value))return value.map(transform);
  if(value&&typeof value==='object'){
   const out={};for(const [key,v]of Object.entries(value)){if(hidden.has(key))continue;
    if(['url','publicUrl','downloadUrl','manualUrl','download','readUrl','original'].includes(key)&&typeof v==='string'&&v.startsWith('/')){out[key]=sign(value.name||value.clean||'');continue;}
    out[key]=transform(v);
   }
   if(typeof value.name==='string'&&(/\.(pdf|docx)$/i.test(value.name)||value.kind==='spec'||value.kind==='manual')){
    out.url=sign(value.name);out.available=!!out.url;out.unavailableReason=out.url?null:'not-approved-for-public-access';out.unavailableMessage=out.url?null:'此资料尚未开通公网访问';
   }
   if(Array.isArray(value.specFiles))out.specLinks=value.specFiles.map(sign);
   return out;
  }
  return typeof value==='string'?value.replace(/[A-Za-z]:[\\/][^\r\n|<>"']+|\\\\[^\r\n|<>"']+/g,'[内部位置]'):value;
 }
 return {transform,approvedCount:approved.size};
}
module.exports={createPublicCatalog};
