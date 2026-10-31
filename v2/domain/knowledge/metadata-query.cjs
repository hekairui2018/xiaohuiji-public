'use strict';
const compact=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s,_，、。;；:：/\\—–\-()（）]/g,'');
// Match literal parts of existing names. Missing fields remain missing; a close
// name is a retrieval candidate, never a statement of hardware compatibility.
function metadataMatch(query,name,context=''){
 const q=compact(query),n=compact(name),full=compact(name+' '+context);if(!q)return {score:0,exact:false,matched:[]};
 if(n===q)return {score:100,exact:true,matched:[query]};
 const pieces=String(query).normalize('NFKC').split(/[\s,_，、。;；:：/\\—–\-()（）]+/).filter(Boolean);
 const units=String(name).normalize('NFKC').replace(/(?<=\d)(?=V\d)/gi,'_').split(/[\s,_，、;；/\\—–\-()（）]+/).map(s=>s.replace(/\.(?:ssr|rcg|bin|exe|mp4|pdf|docx?)$/i,'')).filter(Boolean);
 let rest=q;const matched=[];
 for(const unit of units.sort((a,b)=>b.length-a.length)){const u=compact(unit);if(u.length<2)continue;const position=rest.indexOf(u);if(position<0)continue;const after=rest.slice(position+u.length);const nextPart=pieces.some(piece=>compact(piece)===u)||units.some(next=>compact(next).length>=2&&after.startsWith(compact(next)));if(/[a-z]$/i.test(u)&&/^[a-z]/i.test(after)&&!nextPart)continue;matched.push(unit);rest=rest.slice(0,position)+rest.slice(position+u.length);}
 // Customers may give only the chip's numeric core. Match the complete number,
 // while retaining full chip suffixes in each result.
 if(/^\d{3,}$/.test(q)&&new RegExp('(?<!\\d)'+q+'(?!\\d)').test(n))return {score:70,exact:false,matched:[query]};
 if(matched.length){const coverage=(q.length-rest.length)/q.length;return {score:coverage>=1?95:Math.round(coverage*65),exact:!rest,matched};}
 if(full.includes(q))return {score:55,exact:false,matched:[query]};
 const found=pieces.filter(t=>compact(t).length>=2&&full.includes(compact(t)));
 return {score:found.length?Math.round(found.length/pieces.length*45):0,exact:false,matched:found};
}
function rankMetadata(query,rows,{limit=30}={}){return rows.map(row=>({...row,queryMatch:metadataMatch(query,row.name,(row.folders||[]).join(' '))})).filter(r=>r.queryMatch.score>=25).sort((a,b)=>b.queryMatch.score-a.queryMatch.score||String(a.name).localeCompare(String(b.name),'zh-Hans-CN',{numeric:true})).slice(0,limit);}
module.exports={metadataMatch,rankMetadata};
