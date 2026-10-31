'use strict';
// A customer's component pair is a retrieval constraint, not a registered
// identity alias. Numeric shorthand never silently supplies a vendor prefix.
function componentPairs(value){
 const text=String(value).normalize('NFKC'),pairs=[];
 const re=/(?<![a-z0-9])([a-z]{0,5}\d{4,5}[a-z]{0,4})\s*\+\s*([a-z]{0,5}\d{4,5}[a-z]{0,4})(?![a-z0-9])/gi;
 for(const m of text.matchAll(re))pairs.push({text:m[0],start:m.index,end:m.index+m[0].length,components:[m[1],m[2]].map(raw=>({raw,number:raw.match(/\d+/)[0]}))});
 // Chip combinations are lists of entities; a plus sign is only one way to
 // write the relation. Keep all declared identities together across separators.
 const tokens=[...text.matchAll(/(?<![a-z0-9])([a-z]{0,5}\d{4,5}[a-z]{0,4})(?![a-z0-9])/gi)];
 for(let i=0;i<tokens.length-1;i++){
  const a=tokens[i],b=tokens[i+1],between=text.slice(a.index+a[0].length,b.index);
  if(!/[a-z]/i.test(a[0]+b[0])||!/^\s*(?:[,，、/;+]|and|with|和|与|配|搭配)?\s*$/i.test(between))continue;
  if(pairs.some(p=>p.start===a.index&&p.end===b.index+b[0].length))continue;
  pairs.push({text:text.slice(a.index,b.index+b[0].length),start:a.index,end:b.index+b[0].length,components:[a[1],b[1]].map(raw=>({raw,number:raw.match(/\d+/)[0]}))});
 }
 return pairs;
}
function coversComponentPair(text,pairs){
 if(!pairs.length)return true;
 // A numeric-family match permits a conditional reference only; exact chip
 // suffix/hardware applicability still has to be checked by the source contract.
 return pairs.every(pair=>pair.components.every(({number})=>new RegExp('(?<!\\d)'+number+'(?!\\d)').test(String(text))));
}
module.exports={componentPairs,coversComponentPair};
