'use strict';
// Presentation-only selection. No original, knowledge snapshot or firmware is changed.
function describeDocument(document){
 const name=document.name||document.file||'';
 // Preserve everything except the explicit document version and file extension:
 // language, model suffix, hardware tags and signed/unsigned identity stay separate.
 const stem=name.replace(/\.[a-z0-9]+$/i,''),matches=[...stem.matchAll(/(?<![A-Za-z0-9])V(\d+(?:\.\d+)+)(?![A-Za-z0-9.])/ig)],named=matches.length===1?matches[0]:null,meta=document.documentMetadata||{};
 const original=/^V\d+(?:\.\d+)+$/i.test(meta.version||'')?meta.version.toUpperCase():null;
 const conflict=original&&named&&original!==named[0].toUpperCase();
 const version=conflict?null:named|| (original?Object.assign([original,original.slice(1)],{index:-1}):null);
 const nameConditions=stem.match(/(?<![A-Za-z0-9])(?:E\d+|HW[-_ ]?[A-Za-z0-9.]+|REV[-_ ]?[A-Za-z0-9.]+|Android\s*\d+(?:\.\d+)?|安卓\d+(?:\.\d+)?|BOX|TP)(?![A-Za-z0-9])/ig)||[];
 const scope=JSON.stringify({models:meta.coverModels||[],conditions:meta.scopeEvidence||[],nameConditions:nameConditions.map(x=>x.toUpperCase()),hardware:document.hardwareVersion||null,applicability:document.applicability||null});
 const title=meta.title?.replace(/V\d+(?:\.\d+)+/ig,'').trim();
 const familyStem=meta.familyId&&meta.classificationStatus==='manual-review'?'reviewed-family:'+meta.familyId:title&&meta.coverModels?.length?meta.coverModels.join('|')+'|'+title:version&&version.index!==-1?stem.replace(version[0],'{version}'):stem;
 return {version:version?.[0].toUpperCase()||null,numbers:version?version[1].split('.').map(Number):null,
  family:familyStem.replace(/^HD[-_ ]?/i,'').replace(/\bspecifications\b/ig,'Specification').replace(/\s*&\s*/g,' ').replace(/_/g,' ').replace(/\s+/g,' ').trim().toUpperCase()+'|'+(/[\u4e00-\u9fff]/.test(stem)?'zh':'en')+'|'+scope+(isSignedDocument(document)?'|signed':'')+(document.presentationBasis==='local-operation-guide-in-other'?'|operation-guide':''),
  versionBasis:conflict?'filename-cover-version-conflict':original?'original-cover-version':named?'explicit-filename-version':'not-established',
  formatFamily:stem.replace(/^HD[-_ ]?/i,'').replace(/\bspecifications\b/ig,'Specification').replace(/_/g,' ').replace(/\s+/g,' ').trim().toUpperCase(),
  language:/[\u4e00-\u9fff]/.test(stem)?'zh':'unspecified-or-en',format:/\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase()||null};
}
function compare(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return Math.sign(d);}return 0;}
function isSignedDocument(document){
 const name=(document.name||document.file||'').replace(/未签章|未盖章|未签字|unsigned/ig,'');
 return document.documentEdition==='signed'||/签章|盖章|签字|(?:^|[\\/\s_.(-])signed(?:[\\/\s_.)-]|$)/i.test(name);
}
function selectDocumentVersions(documents,{includeHistory=false,includeSigned=false}={}){
 const excludedSigned=includeHistory||includeSigned?[]:documents.filter(isSignedDocument).map(d=>({...d,versionSelection:'signed-copy-hidden'}));
 const rows=documents.filter(d=>includeHistory||includeSigned||!isSignedDocument(d)).map(d=>({document:d,identity:describeDocument(d)})),max=new Map();
 for(const r of rows)if(r.identity.numbers){const old=max.get(r.identity.family);if(!old||compare(r.identity.numbers,old)>0)max.set(r.identity.family,r.identity.numbers);}
 const selected=[],withheld=[],formatAlternatives=[];
 for(const {document,identity}of rows){
  const historical=identity.numbers&&compare(identity.numbers,max.get(identity.family))<0;
  const record={...document,documentVersion:identity.version,versionBasis:identity.versionBasis,documentLanguage:identity.language,versionSelection:historical?'historical':identity.version?'latest-in-explicit-document-family':'version-unknown',versionFamily:identity.family};
  (historical&&!includeHistory?withheld:selected).push(record);
 }
 if(!includeHistory){
  const pdfs=selected.filter(d=>describeDocument(d).format==='pdf');
  for(let i=selected.length-1;i>=0;i--){const d=selected[i],identity=describeDocument(d);const equivalent=pdfs.some(p=>p.versionFamily===d.versionFamily&&p.documentVersion===d.documentVersion||describeDocument(p).formatFamily===identity.formatFamily&&(!p.documentMetadata||!d.documentMetadata));if(identity.format==='docx'&&equivalent){formatAlternatives.unshift({...d,versionSelection:'same-version-pdf-preferred'});selected.splice(i,1);}}
 }
 const duplicateAlternatives=[];
 if(!includeHistory){const seen=new Set();for(let i=0;i<selected.length;i++){const d=selected[i];if(!/^[a-f0-9]{64}$/i.test(d.sha256||''))continue;const key=d.sha256+'|'+d.documentLanguage+'|'+(d.kind||'');if(seen.has(key)){duplicateAlternatives.push({...d,versionSelection:'identical-content-alternative'});selected.splice(i--,1);}else seen.add(key);}}
 return {selected,withheld,formatAlternatives,excludedSigned,duplicateAlternatives};
}
module.exports={describeDocument,selectDocumentVersions,isSignedDocument};
