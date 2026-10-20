'use strict';
// Versioned source adapter. Keep old files intact and expose their keys for compatibility.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const sourceFile='reference/selection-sources/official-js-analysis-20261013/official-selection-v2.json';
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8').replace(/^\uFEFF/,''));
const modelId=model=>'HD-'+String(model||'').trim().toUpperCase().replace(/^HD[-_\s]?/,'').replace(/\s+/g,'');
const eligible=device=>![3,4,5].includes(device.status);
function adaptCatalog(legacy,snapshot){
 const models=new Map(snapshot.devices.filter(d=>!/[{}]/.test(d.model)).map(d=>[modelId(d.model),d]));
 const devices=legacy.devices.map(old=>{
  const raw=models.get(modelId(old.name));if(!raw)return {...old,officialSourceState:'not-in-selection-snapshot'};
  const modes=Object.fromEntries(Object.entries(old.modes||{}).map(([mode,p])=>[mode,{...p,
   // Static totalPoints/max dimensions are necessary bounds, not a mode-specific success proof.
   maxPixels:Math.min(p.maxPixels||raw.totalPoints,raw.totalPoints),maxW:Math.min(p.maxW||raw.maxWidth,raw.maxWidth),maxH:Math.min(p.maxH||raw.maxHeight,raw.maxHeight)}]));
  return {...old,modes,autoEligible:old.autoEligible===true&&eligible(raw),
   selectionPolicy:eligible(raw)?old.selectionPolicy:'explicit-only',officialStatus:raw.status,
   officialSourceState:'conservative-intersection',officialSource:raw.source,
   officialConditions:{singleNetworkPorts:raw.singleNetworkPorts||null,discount:raw.discount||null,category:raw.category},
   evidence:[...(old.evidence||[]),{sourceId:'official-js-20261013',jsonPath:`${raw.source.symbol}[${raw.source.index}]`,sha256:raw.source.sha256,scope:'status and necessary capacity bounds'}]};
 });
 return {...legacy,schemaVersion:'2.0.0',dataSource:'official-js-20261013',sources:[...legacy.sources,{id:'official-js-20261013',...snapshot.source}],devices,
   sourceInventory:snapshot.devices.map(d=>({id:modelId(d.model),model:d.model,status:d.status,source:d.source,unresolvedLabel:/[{}]/.test(d.model)}))};
}
const iface=s=>String(s||'').toUpperCase().replace(/^HUB75[BE]$/,'HUB75');
function adaptModules(snapshot,legacyRows){
 return snapshot.modules.map(m=>{
  const layouts=Object.fromEntries(m.receiveCard.map(c=>[c.model,{w:c.width,h:c.height}]));
  const card=['R716','R712','R708','R732','R500S'].find(c=>layouts[c]);
  const pitch=Number(m.dotPitch.spacing),color=['R','G','B'].filter(k=>m.color[k]).map(k=>`${m.color[k]}${k}`).join('');
  const keys=legacyRows.filter(r=>r.pitch===pitch&&r.w===m.resolution[0]&&r.h===m.resolution[1]&&iface(r.iface)===iface(m.interface)&&r.scan===m.scanningMethod&&r.mmW===m.size[0]&&r.mmH===m.size[1]).map(r=>r.key);
  const full=m.color.R===1&&m.color.G===1&&m.color.B===1;
  const colorLabel=full?'全彩':(m.color.G?'双色':'单色');
  return {key:'official-module-'+m.id,legacyKeys:keys,pitch,label:`P${pitch} ${m.indoor?'户内':'户外'}${colorLabel}模组 ${m.scanningMethod}`,
   w:m.resolution[0],h:m.resolution[1],mmW:m.size[0],mmH:m.size[1],scan:m.scanningMethod,iface:iface(m.interface),color,
   card,cardW:layouts[card]?.w||1,cardH:layouts[card]?.h||1,cardLayouts:layouts,note:'',sourceLine:null,
   sourceFile:'index-26d75d63.js',sourcePath:`Ay[${m.source.index}]`,sourceIdentity:m.source,
   officialModuleId:m.id,colorComponents:{...m.color},lampBeadsType:m.lampBeadsType,builtIn2Open:m.builtIn2Open};
 });
}
let cached;
function loadOfficialData(){if(!cached)cached=read(sourceFile);return cached;}
function sourceMode(){const mode=process.env.ORDERING_DATA_SOURCE||'official';if(!['official','legacy'].includes(mode))throw Error('Invalid ORDERING_DATA_SOURCE');return mode;}
function loadCatalog(){const old=read('backend/ordering/data/ordering-device-catalog.json');return sourceMode()==='legacy'?old:adaptCatalog(old,loadOfficialData());}
function modulePresets(legacyRows){return sourceMode()==='legacy'?legacyRows:adaptModules(loadOfficialData(),legacyRows);}
module.exports={modelId,eligible,adaptCatalog,adaptModules,loadOfficialData,sourceMode,loadCatalog,modulePresets};
