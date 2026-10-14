'use strict';
const {modelId}=require('./model-id.cjs');
// Identity extraction only: safe to share with quick without invoking dialogue intent routing.
function extractKnownModels(text,lookup){return [...new Set((String(text).match(/\b(?:HD[-_ ]?)?(?:[A-Z]{1,6}\d[A-Z0-9_+-]*|\d+[A-Z][A-Z0-9_+-]*)(?:[ \t]+(?:PRO|PLUS|MAX|MINI|LITE))?(?![A-Z0-9_+-])/gi)||[]).map(modelId).filter(id=>id&&lookup.findProducts(id).length))];}
module.exports={extractKnownModels};
