'use strict';
// Preserve the existing filename/slot comparison; this is not device approval.
function describeFirmware(item){
 const name=item.file||item.name||'',m=/(?<![A-Za-z0-9])V(\d+(?:[._]\d+)+)/i.exec(name)||/_FPGA_(\d+(?:_\d+){3})/i.exec(name);
 if(!m)return null;
 const nums=m[1].split(/[._]/).map(Number),slot=nums.length>=4;
 return {key:name.replace(m[0],'{version'+(slot?'-slot-'+nums.at(-1):'')+'}').toUpperCase(),numbers:slot?nums.slice(0,-1):nums,version:m[1].replaceAll('_','.')};
}
function selectFirmwareVersions(items){
 const compare=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d;}return 0;},max=new Map();
 for(const item of items){const r=describeFirmware(item);if(r&&(!max.has(r.key)||compare(r.numbers,max.get(r.key))>0))max.set(r.key,r.numbers);}
 const selected=[],withheld=[],pending=[];
 for(const item of items){const r=describeFirmware(item),old=r&&compare(r.numbers,max.get(r.key))<0,record={...item,kind:'firmware',documentVersion:r?.version||null,versionBasis:r?'explicit-firmware-filename-and-slot':'not-established',versionSelection:old?'historical':r?'firmware-filename-latest-not-compatibility':'version-unknown'};
  (old?withheld:!r&&item.status==='local-indexed'?pending:selected).push(record);
 }
 return {selected,withheld,pending};
}
module.exports={selectFirmwareVersions};
