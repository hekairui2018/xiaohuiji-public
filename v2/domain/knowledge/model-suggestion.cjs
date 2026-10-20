'use strict';
// Optional one-edit model hints, exclusively from registered product identities.
function suggestModels(text,products){
 const norm=s=>String(s||'').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s+/g,'');
 const known=[...new Set(products.map(p=>norm(p.modelId||p.displayName)).filter(Boolean))];
 const tokens=String(text||'').toUpperCase().match(/(?:HD[-_ ]?)?[A-Z]{1,6}\d+[A-Z0-9]{0,6}/g)||[];
 const oneEdit=(a,b)=>{if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,n=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;}else{if(++n>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}}return n+(a.length-i)+(b.length-j)===1;};
 for(const token of tokens){const value=norm(token);if(known.includes(value))continue;const candidates=known.filter(k=>/^[A-Z]+/.exec(k)?.[0]===/^[A-Z]+/.exec(value)?.[0]&&oneEdit(value,k));if(candidates.length===1)return {input:token,model:candidates[0],message:'是不是想问 '+candidates[0]+'？'};}
 return null;
}
module.exports={suggestModels};
