'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createApp}=require('../app/bootstrap.cjs');
async function main(){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: export-ssm.cjs demand.json workspace-output.ssm');
 const root=path.resolve(__dirname,'../..'),target=path.resolve(output);if(!target.startsWith(root+path.sep)||path.extname(target)!=='.ssm')throw Error('Export target must be a workspace SSM file');
 const result=await createApp().exportSsm(JSON.parse(fs.readFileSync(input,'utf8')));if(result.status!=='ready')throw Error(JSON.stringify(result));
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,result.xml,{flag:'wx'});fs.writeFileSync(target+'.grid.xml',result.gridXml,{flag:'wx'});fs.writeFileSync(target+'.metadata.json',JSON.stringify(result.metadata,null,2),{flag:'wx'});console.log(target);
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
