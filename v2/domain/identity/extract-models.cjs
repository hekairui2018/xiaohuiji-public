'use strict';
const {modelId}=require('./model-id.cjs');
function isTechnicalToken(token,context=''){
 const value=String(token).normalize('NFKC');
 // Explicit HD-prefixed registry identities remain eligible. Bare standards
 // and media encodings are objects/attributes, never unknown product claims.
 return /^(?:MP[34]|H26[45]|RS(?:232|422|485)|HDMI\d*|USB\d*|HUB75E?|\d+S)$/i.test(value)||/^\d{1,2}K$/i.test(value)&&/分辨率|视频|信号|HDMI|\bDP\b|支持/i.test(context);
}
// Identity extraction only: safe to share with quick without invoking dialogue intent routing.
function extractModelTokens(text,{numericPrefix=true,lookup}={}){const attributes=require('./model-attribute-boundaries.cjs').separateModelAttributes(text,lookup);const source=lookup?require('./model-port-ranges.cjs').separateModelPortRanges(attributes,lookup):attributes;return (source.match(/\b(?:HD[-_ ]?)?(?:[A-Z]{1,20}\d[A-Z0-9_+-]*|\d+[A-Z][A-Z0-9_+-]*)(?:[ \t]+(?:PRO|PLUS|MAX|MINI|LITE))?(?![A-Z0-9_+-])/gi)||[]).filter(t=>numericPrefix||!/^\d/.test(t));}
function extractKnownModels(text,lookup){const source=String(text);return [...new Set(extractModelTokens(source,{lookup}).filter(token=>!isTechnicalToken(token,source)).map(modelId).filter(id=>id&&lookup.findProducts(id).length))];}
// Numeric shorthand is resolved only against registered identities/aliases. No
// fuzzy suffix matching: 712 cannot become 716 or 712S.
function numericModelCandidates(value,products=[]){
 const number=String(value).normalize('NFKC').trim();if(!/^\d+$/.test(number))return [];
 return products.filter(p=>(p.aliases||[]).some(a=>String(a).trim()===number)||new RegExp('^(?:HD[-_ ]?)?[A-Z]+'+number+'$','i').test(p.modelId||p.displayName||'')).map(p=>({modelId:p.modelId,basis:(p.aliases||[]).some(a=>String(a).trim()===number)?'registered-numeric-alias':'unique-registered-numeric-core-candidate'}));
}
function numericQuestionCandidates(text,products=[]){
 const source=String(text).normalize('NFKC'),found=[];
 for(const m of source.matchAll(/(?<![A-Za-z0-9_.])(\d{3,5})(?![A-Za-z0-9_.])/g)){
  const before=source.slice(0,m.index),after=source.slice(m.index+m[0].length);
  if(/[x×*]\s*$/.test(before)||/^\s*[x×*]/.test(after)||/^\s*(?:像素|点|毫米|厘米|米|mm\b|cm\b|m\b|Hz\b|赫兹|路|个|张|块)/i.test(after)||/(?:版本|版本号|电压|刷新率)\s*$/i.test(before))continue;
  found.push(...numericModelCandidates(m[1],products));
 }
 return [...new Map(found.map(r=>[r.modelId,r])).values()];
}
module.exports={extractModelTokens,extractKnownModels,numericModelCandidates,numericQuestionCandidates,isTechnicalToken};
