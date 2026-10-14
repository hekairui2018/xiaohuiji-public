'use strict';
const {modelId}=require('../identity/model-id.cjs');
const {documentBelongs,mentionsModel}=require('../identity/document-identity.cjs');
const cache=new WeakMap(),identityCache=new WeakMap();
function sourceRows(knowledge){if(!cache.has(knowledge))cache.set(knowledge,knowledge.evidenceDocuments?.()||[]);return cache.get(knowledge);}
function consumeProduct(product,knowledge,{documentVersion}={}){
 if(!identityCache.has(knowledge))identityCache.set(knowledge,new Set(knowledge.products().map(p=>p.modelId)));
 const p=structuredClone(product),known=identityCache.get(knowledge);
 p.documents=(p.documents||[]).map(d=>{const ref=(d.sourceReferences||[d.sourceReference]).find(r=>r?.originalSha256&&sourceRows(knowledge).some(e=>e.document.sha256===r.originalSha256));return ref&&!d.url?{...d,url:'/v2/resources/original/'+ref.originalSha256}:d;});
 const foreign=text=>{const ids=(String(text).match(/(?:HD[-\s]?)?[A-Z]+\d+[A-Z0-9]*(?:\s+(?:Pro|Plus))?/gi)||[]).map(modelId).filter(id=>known.has(id));return ids.length&&!ids.includes(p.modelId);};
 p.withheldClaims=(p.claims||[]).filter(c=>foreign(c.text)).map(c=>({claimId:c.claimId,reason:'foreign-model-without-owner-identity',sourceReference:c.sourceReference}));
 p.claims=(p.claims||[]).filter(c=>!foreign(c.text));
 for(const [field,value] of Object.entries(p.parameters||{}))if(typeof value==='string')p.parameters[field]=value.split('?').filter(s=>!foreign(s)).join('?');
 const rows=sourceRows(knowledge).filter(({document:d})=>d.sourceType==='official'&&d.verificationStatus==='verified'&&/规格书|Specification/i.test(d.name)&&documentBelongs(d.name,p.modelId)&&mentionsModel(d.pages[0]?.text,p.modelId));
 const bindings=[];
 for(const {document:d,source} of rows){const version=/\bV\d+(?:\.\d+)+/i.exec(d.name)?.[0].toUpperCase();if(!version||!d.pages[0].text.replace(/\s+/g,'').toUpperCase().includes(version))continue;
  for(const page of d.pages){const text=page.text.replace(/\s+/g,' ');const excerpt=/最大控制范围[^；。]{1,250}垂直最大支持\s*[\d,]+\s*像素[；。]?/.exec(text)?.[0]||/The maximum control range[^.]{1,300}maximum vertical support is\s*[\d,]+\s*pixels/i.exec(text)?.[0];if(!excerpt)continue;
   const width=/水平最大[^\d]{0,25}([\d,]+)\s*像素|maximum horizontal[^\d]{0,25}([\d,]+)\s*pixels/i.exec(excerpt),height=/垂直最大支持\s*([\d,]+)|maximum vertical support is\s*([\d,]+)/i.exec(excerpt);if(!width||!height)continue;
   const ref={file:source.file,sha256:source.sha256,originalSha256:d.sha256,originalPath:d.originalPath,originalName:d.name,url:'/v2/resources/original/'+d.sha256,page:page.page,locator:page.locator||null,documentVersion:version,sourceType:'official',verificationStatus:'verified',excerpt,conditions:[]};
   bindings.push({version,width:Number((width[1]||width[2]).replace(/,/g,'')),height:Number((height[1]||height[2]).replace(/,/g,'')),text:excerpt,sourceReference:ref});
  }
 }
 p.parameterVersions=bindings;p.parameterEvidence={};
 const identity=rows.find(({document:d})=>/接收卡|Receiving Card/i.test(d.pages[0]?.text));
 if(identity){const {document:d,source}=identity,role=/接收卡/.test(d.pages[0].text)?'接收卡':/Receiving Card/i.exec(d.pages[0].text)[0];p.withheldParameters={productSeries:p.parameters.productSeries};p.parameters.productSeries=role;p.parameterEvidence.productSeries=[{file:source.file,sha256:source.sha256,originalSha256:d.sha256,originalName:d.name,page:d.pages[0].page,url:'/v2/resources/original/'+d.sha256,sourceType:'official',verificationStatus:'verified',excerpt:role}];}
 const selected=documentVersion?bindings.filter(b=>b.version===documentVersion.toUpperCase()):bindings;
 const distinct=new Set(selected.map(b=>b.width+'x'+b.height));
 if(documentVersion&&(!selected.length||distinct.size>1)||!documentVersion&&distinct.size>1){
  p.parameterStatus=documentVersion&&!selected.length?'document-version-not-supported':'document-version-conflict';
  p.parameters.load='';p.parameters.resolution='';p.claims=p.claims.filter(c=>c.field!=='load'&&!/宽\/高|maximum control range|垂直最大/i.test(c.text));
  if(documentVersion){p.parameters={};p.claims=[];}
 }else if(selected.length){
  p.parameterStatus='document-scoped';p.selectedDocumentVersion=documentVersion||null;
  if(documentVersion){p.parameters={};p.claims=p.claims.filter(c=>(c.sourceReferences||[c.sourceReference]).some(r=>r?.documentVersion===documentVersion&&r.sourceType==='official'&&r.verificationStatus==='verified'));}
  else p.claims=p.claims.filter(c=>!['load','resolution'].includes(c.field));
  for(const b of selected){p.claims.push({claimId:'document-load-'+b.sourceReference.originalSha256+'-'+b.sourceReference.page,field:'load',text:b.text,sourceType:'official',verificationStatus:'verified',sourceReference:b.sourceReference,sourceReferences:[b.sourceReference]});}
  p.parameters.load=selected.map(b=>b.text).join('\n');p.parameters.resolution=selected[0].width+' / '+selected[0].height;
  p.parameterEvidence={...p.parameterEvidence,load:selected.map(b=>b.sourceReference),resolution:selected.map(b=>b.sourceReference)};
 }else if(documentVersion){p.parameterStatus='document-version-not-supported';p.parameters={};p.claims=[];}
 return p;
}
module.exports={consumeProduct};
