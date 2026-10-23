'use strict';
// Rejoin PDF line wraps while retaining headings, table rows and numbered items.
// A line break inside a paragraph is not the end of a prerequisite or value.
function nativeLines(text){
 const out=[],boundary=s=>/^\s*(?:[一二三四五六七八九十]+[、.]|第.{1,12}[章节]|\d+[、.)）]\s*|[•●]|图\s*\d)/.test(s)||s.includes('|')||/https?:|www\.|深圳市.*公司/.test(s);
 for(const raw of String(text).split(/\r?\n/)){
  const line=raw.trim(),prior=out.at(-1);
  if(!line){out.push('');continue;}
  if(prior&&!boundary(line)&&!prior.includes('|')&&!/[。；;：:]$/.test(prior)&&!/^\s*(?:[一二三四五六七八九十]+[、.]|第.{1,12}[章节])/.test(prior)&&/[\p{L}\p{N}）)]$/u.test(prior))out[out.length-1]+=' '+line;
  else out.push(line);
 }
 return out.filter(Boolean);
}
module.exports={nativeLines};
