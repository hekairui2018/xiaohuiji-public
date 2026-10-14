'use strict';
const {modelId}=require('./model-id.cjs');
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function mentionsModel(text,id){
 const bare=modelId(id)?.replace(/^HD-/, '');if(!bare)return false;
 const variant=bare.match(/^(.*?)(PRO|PLUS|MAX|MINI|LITE)$/);
 const pattern=variant?escape(variant[1]).replace(/-/g,'[-_ ]?')+'[ _-]*'+variant[2]:escape(bare).replace(/-/g,'[-_ ]?');
 return new RegExp('(?<![A-Z0-9+])(?:HD[-_ ]?)?'+pattern+'(?![A-Z0-9+])(?![ _-]+(?:PRO|PLUS|MAX|MINI|LITE)\\b)','i').test(String(text||''));
}
function documentBelongs(file,id){let name=String(file).split(/[\\/]/).pop();try{name=decodeURIComponent(name);}catch{}return mentionsModel(name,id);}
module.exports={mentionsModel,documentBelongs};
