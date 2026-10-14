'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function loadSsmShell(dir=path.resolve(__dirname,'../../data/ssm')){
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 const bytes=fs.readFileSync(path.join(dir,'standard-shell.ssm'));if(crypto.createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('SSM template checksum mismatch');
 return {xml:bytes.toString('utf8'),manifest};
}
module.exports={loadSsmShell};
