'use strict';
const {isSignedDocument,selectDocumentVersions}=require('./document-versions.cjs');
const operationGuide=d=>/操作指南|\boperation\s+guide/i.test(d.name||d.file||'');
// Local presentation only: keep original role, identity, model and version evidence.
function selectQuickDocuments(documents,{local=false,websiteOnly=true,includeHistory=false,historyOnly=false}={}){
 const rows=documents.filter(d=>!websiteOnly||includeHistory||historyOnly||(!/\.docx$/i.test(d.name||d.file||'')&&(local||!operationGuide(d))))
  .map(d=>local&&(isSignedDocument(d)||operationGuide(d))?{...d,originalKind:d.originalKind||d.kind,kind:'other',presentationBasis:isSignedDocument(d)?'local-signed-edition-in-other':'local-operation-guide-in-other'}:d);
 return selectDocumentVersions(rows,{includeHistory:includeHistory||historyOnly,includeSigned:local});
}
module.exports={selectQuickDocuments};
