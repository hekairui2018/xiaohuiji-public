'use strict';
// Typed field/action aliases shared across languages. Device identities are
// resolved by the product registry, never translated by this vocabulary.
const fields=[
 ['width',['width','wide','horizontal pixels'],['宽度','带载']],['height',['height','tall','vertical pixels'],['高度','带载']],
 ['load',['load capacity','loading capacity','pixel capacity','maximum load'],['带载']],
 ['size',['dimensions','physical size'],['尺寸']],['resolution',['resolution'],['分辨率']],
 ['grayscale',['grayscale','grey scale','gray scale'],['灰阶']],
 ['power-input',['input voltage','supply voltage','power supply'],['输入电压']],
 ['memory',['ram','memory'],['运行内存']],['storage',['storage','rom'],['存储']],
 ['ports',['ports','interfaces','connectors'],['接口']],['battery',['battery'],['电池']],
 ['refresh',['refresh rate','frame rate'],['刷新率']],
 ['brightness',['brightness'],['亮度']],['weight',['weight'],['重量']],
 ['temperature',['operating temperature'],['工作温度']]
];
const actionAliases=[
 ['configure',['configure','configuration','set up','setup','calibrate'],['调试']],
 ['reset',['factory reset','reset to factory settings','reset'],['恢复出厂设置']],
 ['connect',['connect','connection'],['连接']],['install',['install','installation'],['安装']],
 ['upgrade',['upgrade','update'],['升级']],['export',['export'],['导出']],
 ['import',['import'],['导入']],['save',['save'],['保存']],['read',['read'],['读取']],
 ['publish',['publish','send'],['发送']],['play',['play','playback'],['播放']],['display',['display','generate','select'],['显示']]
];
const documentAliases=[['manual',['user guide','user manual','manual'],['说明书']],['spec',['datasheet','specification','specifications'],['规格书']],['video',['video tutorial','tutorial video','tutorial','video'],['视频']],['firmware',['firmware'],['固件']]];
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const hit=(text,words)=>new RegExp('\\b(?:'+words.map(escape).join('|')+')\\b','i').exec(text);
function queryLanguage(value){
 const text=String(value).normalize('NFKC');
 const matches=fields.flatMap(([id,aliases,terms])=>{const m=hit(text,aliases);return m?[{id,text:m[0],start:m.index,end:m.index+m[0].length,retrievalTerms:terms}]:[];});
 const actions=actionAliases.flatMap(([id,aliases,terms])=>{const m=hit(text,aliases);return m?[{id,text:m[0],start:m.index,end:m.index+m[0].length,retrievalTerms:terms}]:[];});
 const documents=documentAliases.flatMap(([id,aliases,terms])=>{const m=hit(text,aliases);return m?[{id,text:m[0],start:m.index,end:m.index+m[0].length,retrievalTerms:terms}]:[];});
 const operation=/(?:(?:how\s+(?:to|do\s+i|can\s+i)|steps?\s+to)\s+[^.!?;]{0,22})?\b(?:set|configure|adjust|calibrate|connect|install|reset|recover|export|import|save|read|send|publish|upgrade|update|display|generate|select|play)\b/i.exec(text);
 const how=operation&&/\bhow\b|steps?\s+to|\b(?:please|help)\b|^\s*(?:set|configure|reset|export|import|save|read|send|publish|upgrade|update)\b/i.test(text)?operation:null;
 const file=hit(text,documentAliases.filter(([id])=>id!=='firmware').flatMap(([,aliases])=>aliases));
 const download=hit(text,['download','send me','give me','installation package','installer']);
 const selection=/\b(?:which|what)\s+(?:software|app)|\b(?:software|app)\s+(?:for|to\s+configure)/i.exec(text);
 const compatible=/\bcompatib(?:le|ility)\b|\bcan\s+i\s+(?:use|replace|upgrade|install)\b/i.exec(text);
 const capability=/\b(?:does|do|can|will)\b[^.!?;]{0,45}\b(?:support|detect|handle|display|play)\b|\bsupports?\b[^.!?;]{0,35}[?？]/i.exec(text);
 return {fields:matches,actions,documents,how,file,download,selection,compatible,capability,retrievalTerms:[...new Set([...matches,...actions,...documents].flatMap(m=>m.retrievalTerms))]};
}
// A retrieval projection, never a replacement for customer text or identity
// extraction. Only declared vocabulary is translated; unknown words survive.
function retrievalProjection(value){
 let text=String(value).normalize('NFKC');
 const aliases=[...fields,...actionAliases,...documentAliases].flatMap(([,words,terms])=>words.map(word=>({word,term:terms[0]}))).sort((a,b)=>b.word.length-a.word.length);
 for(const {word,term} of aliases)text=text.replace(new RegExp('\\b'+escape(word)+'\\b','gi'),' '+term+' ');
 return text.replace(/\b(?:what|which|how|where|please|could|would|can|do|does|is|are|the|a|an|for|of|to|and|with|my|me|i|you|your|it|its|tell|give|show|max|maximum|minimum|limit|limits|download|installer)\b/gi,' ').replace(/\s+/g,' ').trim();
}
function toolQuery(args){
 const original=String(args.query||''),literalFile=['files','resources','firmware'].includes(args.kind)&&/\.(?:pdf|docx?|pptx?|xlsx?|mp4|mov|bin|ssr|ssm)\b/i.test(original);
 const query=literalFile?original:retrievalProjection(original)||original;
 return {...args,query,...(Array.isArray(args.concepts)?{concepts:args.concepts.map(value=>retrievalProjection(value)||value)}:{})};
}
module.exports={queryLanguage,fields,retrievalProjection,toolQuery};
