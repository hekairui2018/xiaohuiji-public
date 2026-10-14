'use strict';
const fs=require('node:fs');
const {createApp}=require('../app/bootstrap.cjs');
async function main(){const [mode,file]=process.argv.slice(2);if(!['quick','dialogue'].includes(mode)||!file)throw Error('Usage: run-request.cjs quick|dialogue request.json');
 const app=createApp(),input=JSON.parse(fs.readFileSync(file,'utf8'));
 console.log(JSON.stringify(mode==='quick'?app.quickLookup(input):await app.dialogue(input),null,2));}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
