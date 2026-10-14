'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createDataset}=require('../../domain/data/dataset.cjs');
function loadDataset(root=path.resolve(__dirname,'../../data')){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'active-manifest.json'),'utf8'));
 if(manifest.schemaVersion!==1||!/^[a-z0-9-]+$/.test(manifest.versionId)||!/^[a-f0-9]{64}$/.test(manifest.contentSHA256))throw Error('Invalid data manifest');
 const file=path.resolve(root,'versions',manifest.versionId,'source.json');
 if(!file.startsWith(path.resolve(root)+path.sep))throw Error('Unsafe version path');
 const bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 if(hash!==manifest.contentSHA256)throw Error('Dataset checksum mismatch');
 return createDataset(JSON.parse(bytes.toString('utf8')),manifest.versionId);
}
module.exports={loadDataset};
