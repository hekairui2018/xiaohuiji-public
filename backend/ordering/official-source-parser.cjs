'use strict';
// Restricted data-literal parser. Never executes the downloaded JavaScript bundle.
function parseLiteral(source,start=0){
 let i=start;
 const skip=()=>{while(/\s/.test(source[i]||'')&&i<source.length)i++;};
 function string(){const quote=source[i++];let out='';while(i<source.length){const c=source[i++];if(c===quote)return out;if(c==='\\'){const e=source[i++];if(e==='u'){const h=source.slice(i,i+4);if(!/^[0-9a-f]{4}$/i.test(h))throw Error('Bad unicode');out+=String.fromCharCode(parseInt(h,16));i+=4;}else if(e==='x'){const h=source.slice(i,i+2);if(!/^[0-9a-f]{2}$/i.test(h))throw Error('Bad hex');out+=String.fromCharCode(parseInt(h,16));i+=2;}else out+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[e]??e);}else out+=c;}throw Error('Unclosed string');}
 function identifier(){const m=source.slice(i).match(/^[A-Za-z_$][\w$]*/);if(!m)throw Error('Expected key at '+i);i+=m[0].length;return m[0];}
 function value(){skip();let result;const c=source[i];
  if(c==='"'||c==="'")result=string();
  else if(c==='['){i++;result=[];skip();while(source[i]!==']'){result.push(value());skip();if(source[i]===','){i++;skip();}else if(source[i]!==']')throw Error('Array separator at '+i);}i++;}
  else if(c==='{'){i++;result={};skip();while(source[i]!=='}'){const key=source[i]==='"'||source[i]==="'"?string():identifier();if(['__proto__','constructor','prototype'].includes(key))throw Error('Unsafe key');skip();if(source[i++]!==':')throw Error('Object separator');result[key]=value();skip();if(source[i]===','){i++;skip();}else if(source[i]!=='}')throw Error('Object separator at '+i);}i++;}
  else if(source.startsWith('!0',i)||source.startsWith('!1',i)){result=source[i+1]==='0';i+=2;}
  else if(c==='-'||/\d/.test(c||'')){const m=source.slice(i).match(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);if(!m)throw Error('Bad number');result=Number(m[0]);i+=m[0].length;}
  else{const name=identifier();if(name==='true'||name==='false')result=name==='true';else if(name==='null')result=null;
   else if(name==='E'){skip();if(source[i++]!=='(')throw Error('Translator call');skip();if(!['"',"'"].includes(source[i]))throw Error('Literal translation key only');const key=string();skip();if(source[i++]!==')')throw Error('Translator close');result='{'+key+'}';}
   else throw Error('Unsupported executable expression '+name+' at '+i);}
  skip();while(source[i]==='+'){if(typeof result!=='string')throw Error('Only literal string concatenation allowed');i++;const next=value();if(typeof next!=='string')throw Error('String concatenation only');result+=next;skip();}return result;
 }
 const result=value();return {value:result,end:i};
}
function extractArrays(source){
 const result={};for(const symbol of ['Dy','Ly','Fy','By','Hy','Ay','My']){
  const match=new RegExp('\\b'+symbol+'=\\[').exec(source);if(!match)throw Error('Missing official symbol '+symbol);
  result[symbol]=parseLiteral(source,match.index+symbol.length+1).value;
 }return result;
}
module.exports={parseLiteral,extractArrays};
