'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createDataset}=require('../domain/data/dataset.cjs');
function importSource(sourceFile,dataRoot=path.resolve(__dirname,'../data')){
 const bytes=fs.readFileSync(sourceFile),hash=crypto.createHash('sha256').update(bytes).digest('hex'),raw=JSON.parse(bytes.toString('utf8'));
 if(!/^[a-f0-9]{64}$/.test(raw.source?.sha256||''))throw Error('Missing original JS checksum');
 const versionId='official-js-'+raw.source.sha256.slice(0,12)+'-'+hash.slice(0,8);
 const dataset=createDataset(raw,versionId);const folder=path.join(dataRoot,'versions',versionId);
 if(fs.existsSync(folder))throw Error('Version already exists; do not overwrite');
 fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'source.json'),bytes,{flag:'wx'});
 const manifest={schemaVersion:1,versionId,contentSHA256:hash,originSHA256:raw.source.sha256,counts:dataset.counts};
 fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 // Import cannot silently replace an active version; switching is a separate action.
 if(!fs.existsSync(path.join(dataRoot,'active-manifest.json')))fs.writeFileSync(path.join(dataRoot,'active-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 return manifest;
}
if(require.main===module){if(!process.argv[2])throw Error('Supply a validated source JSON');console.log(JSON.stringify(importSource(path.resolve(process.argv[2]))));}
module.exports={importSource};
