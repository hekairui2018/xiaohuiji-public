'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function loadResourceEvidence(root=path.resolve(__dirname,'../../..')){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'v2/data/resource-evidence-manifest.json'),'utf8')),allowed=new Set(['data/chip-model-index.json','data/firmware-display-rules.json','data/receiver-card-firmware-suffixes.json']),records={};
 if(manifest.schemaVersion!==1||manifest.sources.length!==3)throw Error('Invalid resource evidence manifest');
 for(const ref of manifest.sources){if(!allowed.delete(ref.file))throw Error('Unexpected resource evidence source');const bytes=fs.readFileSync(path.join(root,ref.file));if(crypto.createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw Error('Resource evidence checksum mismatch');records[ref.file]={data:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),sourceReference:ref};}
 return {chips:records['data/chip-model-index.json'],display:records['data/firmware-display-rules.json'],suffixes:records['data/receiver-card-firmware-suffixes.json']};
}
module.exports={loadResourceEvidence};
