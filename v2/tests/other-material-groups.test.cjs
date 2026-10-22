'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {materialInfo,groupOtherMaterials}=require('../domain/knowledge/other-material-groups.cjs');
const {accessInfo}=require('../domain/knowledge/resource-access.cjs');
test('Signing preserves original specification type and never implies private access',()=>{
 const resource={name:'HD-Z9规格书_已签章.pdf',folders:['产品资料','规格书','盖章规格书'],documentMetadata:{kind:'spec',classificationStatus:'original-title-confirmed'}};
 const info=materialInfo(resource,[resource]);assert.equal(info.materialProperty,'signed');assert.equal(info.baseDocumentKind,'spec');assert.equal(info.accessRestricted,false);
});
test('Third party test laboratory is not competitor; explicit competitor directory stays separate',()=>{
 const certificate={name:'本公司CNAS报告.pdf',folders:['控标文件和认证证书','第三方CNAS报告']};assert.equal(materialInfo(certificate,[certificate]).materialProperty,'certificate');
 const compare={name:'竞品对比.pdf',folders:['产品资料','竞品对比表']};assert.equal(materialInfo(compare,[compare]).materialProperty,'external');
});
test('Year and old filename alone never establish obsolete lifecycle',()=>{
 const resource={name:'电池一览表（旧）2021.xlsx',folders:['品质资料','产品型号电池一览表']};const result=materialInfo(resource,[resource]);assert.equal(result.materialProperty,'general');assert.equal(result.historyStatus,'not-established');
 const archive={...resource,folders:['认证证书','历史报告']};assert.equal(materialInfo(archive,[archive]).materialProperty,'history');assert.equal(materialInfo(archive,[archive]).historyStatus,'archived-not-automatically-invalid');
});
test('Conflicts and unknown evidence remain pending; root mixed directory is not a certificate proof',()=>{
 const r={name:'不明资料.pdf',folders:['普通目录']};assert.equal(materialInfo(r,[r]).materialProperty,'pending');
 const c={...r,classificationConflict:'original-role-conflict'};assert.equal(materialInfo(c,[{...r,folders:['认证证书']}]).materialProperty,'pending');
 const mixed={name:'不明参考.pdf',folders:['24、控标文件和认证证书']};assert(!materialInfo(mixed,[mixed]).materialProperties.includes('certificate'));
});
test('Same original has one download record while models and source associations remain available',()=>{
 const sha='a'.repeat(64),one={name:'共享参考.pdf',sha256:sha,fileId:'sha256:'+sha,associatedModels:['Z1'],url:'/file?id=1'},two={...one,associatedModels:['Z2']};
 const groups=[{label:'接收卡',products:[{model:'Z1',items:[one]},{model:'Z2',items:[two]}]}],result=groupOtherMaterials(groups,[{name:one.name,sha256:sha,folders:['培训资料']}]);
 assert.equal(result.total,1);assert.equal(result.sourceAssociationCount,2);const row=result.groups[0].products[0].items[0];assert.deepEqual(row.associatedModels,['Z1','Z2']);assert.equal(row.sourceAssociations.length,2);
 const distinct={...two,sha256:'b'.repeat(64),fileId:'sha256:'+'b'.repeat(64)};groups[0].products[1].items=[distinct];assert.equal(groupOtherMaterials(groups,[]).total,2);
});
test('Source permission is independent from signature and cannot be waived by name aliases',()=>{
 const resources=[{name:'正常名称.pdf',sha256:'a'.repeat(64),folders:['私密','签章资料']}];assert.equal(accessInfo({name:'alias.pdf'},resources).accessRestricted,true);
 assert.equal(accessInfo({name:'签章.pdf'},[{folders:['签章文件']}]).accessRestricted,false);
});
test('Backend protects private documents and retained video permissions across list/search/read/file routes',async()=>{
 const resources=[{name:'受限资料.pdf',locationId:1,sha256:'a'.repeat(64),folders:['操作视频','私密'],sourceDrive:'G:',availabilityState:'present'},
  {name:'普通资料.pdf',locationId:2,folders:['操作视频'],sourceDrive:'G:',availabilityState:'present'}];let streamed=0;
 const index=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');const u=new URL(req.url,'http://x');
  if(u.pathname==='/catalog')return res.end(JSON.stringify({resources}));
  if(u.pathname==='/resource-info')return res.end(JSON.stringify({isVideo:false,resources:[resources[Number(u.searchParams.get('id'))-1]]}));
  if(u.pathname==='/read')return res.end(JSON.stringify({sha256:resources[0].sha256,locations:[{name:resources[0].name}],blocks:[{text:'private'}]}));
  if(u.pathname==='/search')return res.end(JSON.stringify({results:resources.map(r=>({...r,locationId:r.locationId,locations:[{id:r.locationId}]}))}));
  if(u.pathname==='/resource'){streamed++;res.end('synthetic-bytes');return;}res.end('{}');
 });await new Promise(r=>index.listen(0,'127.0.0.1',r));
 const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
 const api=createOfflineKnowledge({resourceBase:'http://127.0.0.1:'+index.address().port,authorizeRestrictedVideo:req=>req.verifiedTestPrincipal==='staff'});
 const server=http.createServer((req,res)=>{if(req.url.startsWith('/staff/')){req.verifiedTestPrincipal='staff';req.url=req.url.slice(6);}api.handle(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const list={cat:'other',docs:{groups:[{products:[{model:'测试',items:resources.map(r=>({...r,url:'/v2/offline/file?id='+r.locationId}))}]}]}};
  assert.equal((await api.authorizeResources(list)).docs.total,1);
  assert.equal((await api.authorizeResources(list,{verifiedTestPrincipal:'staff'})).docs.total,2);
  assert.equal((await api.authorizeResources(list,{v2Public:true,verifiedTestPrincipal:'staff'})).docs.total,1);
  for(const route of ['/v2/offline/file?id=1','/v2/offline/file?id=1&download=1','/v2/offline/preview?id=1','/v2/offline/read?block=1'])assert.equal((await fetch(base+route,{headers:{Range:'bytes=0-1','x-role':'staff'}})).status,403);
  assert.equal(streamed,0);const s=await fetch(base+'/v2/offline/search?q=R712');assert.equal((await s.json()).results.length,1);
  assert.equal((await fetch(base+'/staff/v2/offline/file?id=1')).status,200);assert.equal(streamed,1);
 }finally{server.closeAllConnections();index.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>index.close(r))]);}
});
