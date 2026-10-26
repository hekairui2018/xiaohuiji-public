'use strict';
// Explicitly provisions ONLY the dedicated GrayDesk table. No existing table mutations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {FIELDS,createFeishuClient}=require('../external-services/graydesk-errors.cjs');
async function provision(directory){
 const file=path.join(directory,'graydesk.private.json');
 let cfg;
 if(fs.existsSync(file))cfg=JSON.parse(fs.readFileSync(file,'utf8'));
 else{
  const env=Object.fromEntries(fs.readFileSync(path.join(directory,'feishu.env'),'utf8').split(/\r?\n/).map(s=>/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(s)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
  cfg={appId:env.FEISHU_APP_ID,appSecret:env.FEISHU_APP_SECRET,uploadKey:crypto.randomBytes(32).toString('base64url')};
  fs.writeFileSync(file,JSON.stringify(cfg,null,2),{mode:0o600});
 }
 const {api}=createFeishuClient(cfg);const save=()=>fs.writeFileSync(file,JSON.stringify(cfg,null,2),{mode:0o600});
 if(!cfg.appToken){const data=await api('POST','bitable/v1/apps',{name:'灰desk异常日志',time_zone:'Asia/Shanghai'});cfg.appToken=data.app.app_token;cfg.url=data.app.url;save();}
 // Restrict the new base before storing even synthetic error content.
 await api('PATCH','drive/v1/permissions/'+cfg.appToken+'/public?type=bitable',{external_access:false,link_share_entity:'closed'});
 const permission=(await api('GET','drive/v1/permissions/'+cfg.appToken+'/public?type=bitable')).permission_public;
 if(!permission||permission.external_access!==false||permission.link_share_entity!=='closed')throw Error('graydesk-base-privacy-not-confirmed');
 const base='bitable/v1/apps/'+cfg.appToken;
 if(!cfg.tableId){const tables=await api('GET',base+'/tables?page_size=100');const existing=(tables.items||[]).find(t=>t.name==='灰desk异常日志');cfg.tableId=existing?.table_id||(await api('POST',base+'/tables',{table:{name:'灰desk异常日志',default_view_name:'全部异常',fields:Object.entries(FIELDS).map(([field_name,type])=>({field_name,type}))}})).table_id;save();}
 const schema=await api('GET',base+'/tables/'+cfg.tableId+'/fields?page_size=100');
 for(const [name,type]of Object.entries(FIELDS))if(!schema.items?.some(f=>f.field_name===name&&f.type===type))throw Error('graydesk-schema-mismatch');
 console.log(JSON.stringify({configured:true,tableName:'灰desk异常日志',fieldCount:Object.keys(FIELDS).length,url:(cfg.url||'https://feishu.cn/base/'+cfg.appToken)+'?table='+cfg.tableId,configFile:file}));
}
if(require.main===module)provision(path.resolve(process.argv[2]||'tmp/v2-offline-runtime')).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={provision};
