'use strict';
// Read the proven HDSet standard-grid dialect, never evaluate XML or device code.
function decode(value){if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('Invalid base64');return Buffer.from(value,'base64').toString('utf8');}
function gridEnvelope(xml){
 if(typeof xml!=='string'||xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsafe SSM XML');
 const pages=[...xml.matchAll(/<SendCardPage\b[^>]*\bValue="([A-Za-z0-9+/=]+)"[^>]*\/?\s*>/g)];if(pages.length!==1)throw Error('Expected one SendCardPage');
 const outer=decode(pages[0][1]),grids=[...outer.matchAll(/<SdandarModeBase64>([A-Za-z0-9+/=]+)<\/SdandarModeBase64>/g)];
 if(grids.length!==1)throw Error('Expected one standard-mode grid');
 return {page:pages[0][1],outer,gridValue:grids[0][1],gridXml:decode(grids[0][1])};
}
function attributes(tag,names){const values={};for(const name of names){const matches=[...tag.matchAll(new RegExp('\\b'+name+'="([^"]*)"','g'))];if(matches.length!==1||!/^\d+$/.test(matches[0][1]))throw Error('Invalid grid attribute '+name);const n=Number(matches[0][1]);if(!Number.isSafeInteger(n)||n>65535)throw Error('Grid field outside supported range');values[name]=n;}return values;}
function parseGrid(xml){
 if(/<!|&/.test(xml.replace(/<\?xml[^>]*>/,'')))throw Error('Unsupported grid entities');
 const row=xml.match(/<rowCount\b[^>]*\/>/g),column=xml.match(/<columnCount\b[^>]*\/>/g);if(row?.length!==1||column?.length!==1)throw Error('Missing grid dimensions');
 const rows=attributes(row[0],['value']).value,columns=attributes(column[0],['value']).value;
 const ports=[];for(const match of xml.matchAll(/<port\b([^>]*?)(?:\/>|>([\s\S]*?)<\/port>)/g)){
  const p=attributes(match[1],['port','x','y']),cells=[...(match[2]||'').matchAll(/<cell\b[^>]*\/>/g)].map(m=>attributes(m[0],['column','height','row','width','x','y']));ports.push({...p,cells});
 }
 if(!rows||!columns||!ports.length||new Set(ports.map(p=>p.port)).size!==ports.length)throw Error('Invalid grid topology');
 return {rows,columns,ports};
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function packetAudit(xml){const packets=[...xml.matchAll(/<Packet\b[^>]*\bValue="([A-Za-z0-9+/=]+)"[^>]*>/g)].map(m=>m[1]);if(!packets.length)throw Error('SSM has no packets');
 for(const value of packets){const bytes=Buffer.from(value,'base64');if(bytes.length<13||!bytes.subarray(0,8).equals(Buffer.from([85,85,85,85,85,85,85,213]))||crc32(bytes.subarray(8,-4))!==bytes.readUInt32LE(bytes.length-4))throw Error('SSM packet integrity failed');}return packets;
}
module.exports={gridEnvelope,parseGrid,packetAudit,crc32};
