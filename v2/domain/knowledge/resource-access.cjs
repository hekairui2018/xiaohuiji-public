'use strict';
// Access is independent from document role, signature, manufacturer and age.
function accessInfo(item,copies=[]){
 const source=copies.map(r=>(r.folders||[]).join('/')).join('\n');
 const restricted=item.accessRestricted===true||item.accessLevel==='internal'||copies.some(r=>r.accessLevel==='internal'||r.accessRestricted===true)||/私密|保密|内部受限|内部资料|仅供内部|内部培训|入职培训/.test(source);
 return {accessRestricted:restricted,accessBasis:restricted?'explicit-internal-source-or-access-metadata':'no-explicit-internal-restriction-found'};
}
function resourceCopies(item,resources=[]){
 const hash=item.sha256||item.originalSha256;
 if(hash){const rows=resources.filter(r=>r.sha256===hash);if(rows.length)return rows;}
 const version=item.resourceVersionId||item.versionId;if(version){const rows=resources.filter(r=>r.versionId===version);if(rows.length)return rows;}
 let id=item.sourceLocationId||item.locationId;try{id=id||new URL(item.url||item.download||'','http://local').searchParams.get('id');}catch{}
 if(id){const rows=resources.filter(r=>String(r.locationId)===String(id));if(rows.length)return rows;}
 return resources.filter(r=>r.name===(item.name||item.file||item.originalName));
}
module.exports={accessInfo,resourceCopies};
