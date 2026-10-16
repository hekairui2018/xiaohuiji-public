'use strict';
// Explicit candidate injection only. No manifest or original evidence bundle is rewritten.
const path=require('node:path');
function withResourceLocations(knowledge,overlay){
 if(overlay.schemaVersion!=='resource-location-overlay-1'||!Array.isArray(overlay.roots))throw Error('Invalid resource location overlay');
 const roots=overlay.roots.map(p=>path.resolve(p));
 const inside=p=>roots.some(root=>{const rel=path.relative(root,path.resolve(p));return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);});
 for(const [sha,locations]of Object.entries(overlay.bySha256||{}))if(!/^[a-f0-9]{64}$/.test(sha)||!Array.isArray(locations)||locations.some(p=>typeof p!=='string'||!inside(p)))throw Error('Unsafe resource location');
 return Object.freeze({...knowledge,evidenceDocuments:()=>knowledge.evidenceDocuments().map(row=>{
  const locations=overlay.bySha256?.[row.document.sha256];return locations?.length?{...row,document:{...row.document,originalPath:locations[0],alternativeOriginalPaths:[...locations],locationBasis:'candidate-sha256-relocation'}}:row;
 })});
}
module.exports={withResourceLocations};
