'use strict';
const key=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
function quoteFragments(quote){return String(quote).split(/\.{3,}|…+/).map(p=>p.replace(/^[\s，,。；;：:]+|[\s，,。；;：:]+$/g,'')).filter(Boolean);}
function supportsQuote(text,quote){
 const source=key(text),wanted=key(quote);if(!wanted)return false;if(source.includes(wanted))return true;
 if(!/(?:\.{3}|…)/.test(String(quote)))return false;
 const parts=quoteFragments(quote);
 if(parts.length<2||parts.length>4)return false;
 let at=0;for(const part of parts){const needle=key(part);if(needle.length<4)return false;const next=source.indexOf(needle,at);if(next<0)return false;at=next+needle.length;}return true;
}
module.exports={supportsQuote,quoteFragments};
