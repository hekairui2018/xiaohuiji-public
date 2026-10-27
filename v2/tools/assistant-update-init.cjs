'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{parseArgs}=require('node:util');
const {keyId,mutate}=require('../external-services/assistant-updates.cjs');
async function main(){
 const {values:v}=parseArgs({options:Object.fromEntries(['directory','private-directory','origin'].map(k=>[k,{type:'string'}]))});
 if(!v.directory||!v['private-directory']||!v.origin)throw Error('directory, private-directory and origin required');
 const directory=path.resolve(v.directory),secret=path.resolve(v['private-directory']);if(secret===directory||secret.startsWith(directory+path.sep))throw Error('signing-key-inside-release-directory');
 const configFile=path.join(secret,'config.json'),keyFile=path.join(secret,'signing-private.pem');if(fs.existsSync(configFile)||fs.existsSync(keyFile))throw Error('already-configured; keys must not be silently replaced');
 fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(secret,{recursive:true,mode:0o700});
 const pair=crypto.generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 fs.writeFileSync(keyFile,pair.privateKey,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(secret,'trusted-public.pem'),pair.publicKey,{flag:'wx'});
 fs.writeFileSync(configFile,JSON.stringify({directory,publicOrigin:v.origin,publicKey:pair.publicKey,testEnabled:false},null,2),{flag:'wx',mode:0o600});
 await mutate(configFile,keyFile,'stable','init',{approveStable:true});await mutate(configFile,keyFile,'test','init');
 console.log(JSON.stringify({initialized:true,configFile,privateKeyFile:keyFile,publicKeyFile:path.join(secret,'trusted-public.pem'),keyId:keyId(pair.publicKey),stableHasRelease:false}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
