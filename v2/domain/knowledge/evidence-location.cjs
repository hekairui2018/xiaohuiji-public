'use strict';
// Resolve a quotation back to the actual read block, rather than citing the
// first page of a multi-page chapter. Whitespace normalization keeps line wraps.
function quotationLocation(evidence,quote){
 if(evidence.answerOnly)return undefined;
 const supported=require('./quote-support.cjs');
 const first=supported.supportsQuote(evidence.text,quote)&&/(?:\.{3}|…)/.test(quote)?supported.quoteFragments(quote)[0]:quote;
 const wanted=String(first||'').normalize('NFKC').replace(/\s/g,'');
 if(!wanted)return evidence.locator;
 let normalized='',positions=[];
 for(let at=0;at<evidence.text.length;at++)for(const c of evidence.text[at].normalize('NFKC'))if(!/\s/.test(c)){normalized+=c;positions.push(at);}
 const match=normalized.indexOf(wanted);if(match<0)return evidence.locator;
 const at=positions[match];let cursor=0;
 for(const part of evidence.contextParts||[]){
  const start=Number.isInteger(part.textStart)?part.textStart:cursor;
  const end=Number.isInteger(part.textEnd)?part.textEnd:start+Math.max(0,part.charEnd-part.charStart);
  cursor=end+1;
  if(at<start||at>=end||!part.locator)continue;
  const loc={...part.locator};
  // Old chapter titles can span unrelated task subsections. Keep their precise
  // page/paragraph while using a section title only when the quote contains it.
  if(loc.section&&!wanted.includes(String(loc.section).normalize('NFKC').replace(/\s/g,'')))delete loc.section;
  return loc;
 }
 return evidence.locator;
}
module.exports={quotationLocation};
