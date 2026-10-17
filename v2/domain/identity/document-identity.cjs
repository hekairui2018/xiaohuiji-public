'use strict';
const {modelId}=require('./model-id.cjs');
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const modelPatterns=new Map();
function mentionsModel(text,id){
 const bare=modelId(id)?.replace(/^HD-/, '');if(!bare)return false;
 let matcher=modelPatterns.get(bare);
 if(!matcher){
 const variant=bare.match(/^(.*?)(PRO|PLUS|MAX|MINI|LITE)$/);
 const pattern=variant?escape(variant[1]).replace(/-/g,'[-_ ]?')+'[ _-]*'+variant[2]:escape(bare).replace(/-/g,'[-_ ]?');
 matcher=new RegExp('(?<![A-Z0-9+])(?:HD[-_ ]?)?'+pattern+'(?![A-Z0-9+])(?![ _-]+(?:PRO|PLUS|MAX|MINI|LITE)\\b)','i');
 modelPatterns.set(bare,matcher);if(modelPatterns.size>1024)modelPatterns.delete(modelPatterns.keys().next().value);
 }
 return matcher.test(String(text||''));
}
function documentBelongs(file,id){let name=String(file).split(/[\\/]/).pop();try{name=decodeURIComponent(name);}catch{}return mentionsModel(name,id);}
module.exports={mentionsModel,documentBelongs};
