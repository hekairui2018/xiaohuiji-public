'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {extractArrays}=require('../backend/ordering/official-source-parser.cjs');
const root=path.resolve(__dirname,'..'),sourceDir=path.join(root,'reference/selection-sources/official-js-analysis-20261013');
const jsPath=path.join(sourceDir,'official-index-26d75d63.js'),bytes=fs.readFileSync(jsPath),hash=crypto.createHash('sha256').update(bytes).digest('hex');
const arrays=extractArrays(bytes.toString('utf8'));
const supplied=JSON.parse(fs.readFileSync(path.join(sourceDir,'02_设备模组与接收卡结构化数据库.json'),'utf8'));
const groups={Dy:'单双色控制卡',Ly:'异步控制卡',Fy:'同步异步播放盒',By:'二合一视频处理器',Hy:'视频拼接处理器'};
const differences=[];
for(const [symbol,group] of Object.entries(groups)){
 assert.equal(arrays[symbol].length,supplied.categories[group].length,group);
 arrays[symbol].forEach((record,index)=>{const comparison={...supplied.categories[group][index]};delete comparison.source_line;delete comparison.selection_eligible_by_status_filter;
  try{assert.deepEqual(record,comparison);}catch{differences.push({group,index,model:record.model,original:record,analysis:comparison});}});
}
assert.deepEqual(arrays.Ay,supplied.module_catalog,'Raw module table versus supplied analysis');
assert.deepEqual(arrays.My,supplied.receiving_card_interfaces,'Raw receiver interfaces versus supplied analysis');
const result={schemaVersion:2,source:{url:'https://data.huidu.cn/selection-tool/static/index-26d75d63.js',sha256:hash,scope:'Official JS data literals; no full runtime parity claim'},
 devices:Object.entries(groups).flatMap(([symbol,category])=>arrays[symbol].map((device,index)=>({...device,category,source:{symbol,index,sha256:hash}}))),
 modules:arrays.Ay.map((module,index)=>({...module,source:{symbol:'Ay',index,sha256:hash}})),receivers:arrays.My,
 analysisDifferences:differences};
const output=path.join(sourceDir,'official-selection-v2.json');if(fs.existsSync(output))throw Error('Preserve prior generated snapshot');
fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({sourceSHA256:hash,devices:result.devices.length,modules:result.modules.length,receivers:result.receivers.length,analysisDifferences:differences.length}));
