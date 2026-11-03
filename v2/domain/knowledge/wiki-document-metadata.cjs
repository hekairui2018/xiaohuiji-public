'use strict';

// Reuse Wiki's approved catalog by content identity, never by filename alone.
function createWikiDocumentMetadata(manifest) {
 const byHash=new Map();
 for(const item of manifest?.items||[])if(item.sha256){const rows=byHash.get(item.sha256)||[];rows.push(item);byHash.set(item.sha256,rows);}
 return row=>{
  const hash=row.sha256||row.download?.match(/\/v2\/curated-documents\/([a-f0-9]{64})\//i)?.[1];
  const entries=byHash.get(hash)||[],entry=entries.find(e=>e.name===row.name)||entries[0];
  if(!entry)return row;
  const edition=entry.brand==='中性版'?'neutral':entry.brand==='品牌版'?'standard':null;
  return {...row,sha256:hash,brand:entry.brand||row.brand,documentEdition:edition||row.documentEdition,
   documentLanguage:entry.language||row.documentLanguage,documentVersion:entry.version||row.documentVersion,
   sizeBytes:entry.size||row.sizeBytes,versionNote:entry.versionNote||row.versionNote,
   metadataBasis:'wiki-approved-file-identity'};
 };
}
module.exports={createWikiDocumentMetadata};
