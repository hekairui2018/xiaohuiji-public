'use strict';
const {modelId}=require('./model-id.cjs');
function isTechnicalToken(token,context=''){
 const value=String(token).normalize('NFKC');
 // Explicit HD-prefixed registry identities remain eligible. Bare standards
 // and media encodings are objects/attributes, never unknown product claims.
 return /^(?:MP[34]|H26[45]|RS(?:232|422|485)|HDMI\d*|USB\d*|HUB75E?)$/i.test(value)||/^\d{1,2}K$/i.test(value)&&/分辨率|视频|信号|HDMI|\bDP\b|支持/i.test(context);
}
// Identity extraction only: safe to share with quick without invoking dialogue intent routing.
function extractKnownModels(text,lookup){const source=String(text);return [...new Set((source.match(/\b(?:HD[-_ ]?)?(?:[A-Z]{1,6}\d[A-Z0-9_+-]*|\d+[A-Z][A-Z0-9_+-]*)(?:[ \t]+(?:PRO|PLUS|MAX|MINI|LITE))?(?![A-Z0-9_+-])/gi)||[]).filter(token=>!isTechnicalToken(token,source)).map(modelId).filter(id=>id&&lookup.findProducts(id).length))];}
// Numeric shorthand is resolved only against registered identities/aliases. No
// fuzzy suffix matching: 712 cannot become 716 or 712S.
function numericModelCandidates(value,products=[]){
 const number=String(value).normalize('NFKC').trim();if(!/^\d+$/.test(number))return [];
 return products.filter(p=>(p.aliases||[]).some(a=>String(a).trim()===number)||new RegExp('^(?:HD[-_ ]?)?[A-Z]+'+number+'$','i').test(p.modelId||p.displayName||'')).map(p=>({modelId:p.modelId,basis:(p.aliases||[]).some(a=>String(a).trim()===number)?'registered-numeric-alias':'unique-registered-numeric-core-candidate'}));
}
module.exports={extractKnownModels,numericModelCandidates,isTechnicalToken};
