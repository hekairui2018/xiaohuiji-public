'use strict';
// Optional one-edit model hints, exclusively from registered product identities.
function suggestModels(text,products){
 const norm=s=>String(s||'').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s+/g,'');
 const known=[...new Set(products.map(p=>norm(p.modelId||p.displayName)).filter(Boolean))];
 const numeric=String(text||'').normalize('NFKC').match(/(?<![A-Za-z0-9.])\d{3,5}(?![A-Za-z0-9.]|\s*(?:像素|点|mm|厘米|毫米|米|Hz|赫兹))/gi)||[];
 for(const number of numeric){const candidates=known.filter(k=>k.match(/\d+/g)?.includes(number));if(candidates.length)return {input:number,model:candidates[0],candidates,query:String(text||''),message:'按数字 '+number+' 找到登记型号 '+candidates.join('、')+'，你指的是'+(candidates.length===1?'这个型号':'其中哪一个')+'？'};}
 const tokens=String(text||'').toUpperCase().match(/(?:HD[-_ ]?)?[A-Z]{1,6}\d+[A-Z0-9]{0,6}/g)||[];
 const oneEdit=(a,b)=>{if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,n=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;}else{if(++n>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}}return n+(a.length-i)+(b.length-j)===1;};
 for(const token of tokens){const value=norm(token);if(known.includes(value))continue;const candidates=known.filter(k=>/^[A-Z]+/.exec(k)?.[0]===/^[A-Z]+/.exec(value)?.[0]&&oneEdit(value,k));if(candidates.length===1)return {input:token,model:candidates[0],message:'是不是想问 '+candidates[0]+'？'};}
 return null;
}
// Registered candidates only. Prefix completion is distinct from a spelling
// suggestion; an edit-distance score never proves a device identity.
function rankModelCandidates(input,products,{limit=3}={}){
 const norm=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
 const value=norm(input);if(!value)return [];
 const distance=(a,b)=>{const d=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i?j?0:i:j));for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+Number(a[i-1]!==b[j-1]));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);}return d[a.length][b.length];};
 const parts=s=>/^([A-Z]+)(\d+)([A-Z+]*)$/.exec(s),wanted=parts(value);
 return [...new Set(products.map(p=>p.modelId||p.displayName).filter(Boolean))].filter(m=>{
  const key=norm(m),candidate=parts(key);if(key===value||!wanted||!candidate)return false;
  // A different numeric product line is not a spelling candidate. A single
  // transposition preserves the same digits and still requires confirmation.
  const numeric=wanted[2]===candidate[2]||wanted[2].length===candidate[2].length&&[...wanted[2]].sort().join('')===[...candidate[2]].sort().join('')&&distance(wanted[2],candidate[2])===1;
  return numeric&&distance(wanted[1],candidate[1])<=1&&distance(value,key)<=2;
 }).map(model=>{const key=norm(model),prefix=/^[A-Z]+\d+$/.test(value)&&key.startsWith(value),edits=distance(value,key),sameFamily=/^[A-Z]+/.exec(value)?.[0]===/^[A-Z]+/.exec(key)?.[0];return {model,matchKind:prefix?'prefix':'suggestion',edits,score:(prefix?2:0)+1-edits/Math.max(value.length,key.length)+(sameFamily?.15:0)};}).sort((a,b)=>b.score-a.score||a.edits-b.edits||a.model.localeCompare(b.model,'en',{numeric:true})).slice(0,limit);
}
module.exports={suggestModels,rankModelCandidates};
