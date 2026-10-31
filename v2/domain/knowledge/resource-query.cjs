'use strict';
// One-turn retrieval plan. No session history, inferred equipment or repair path.
const {concepts}=require('./quick-query.cjs');
const {extractModelTokens,isTechnicalToken}=require('../identity/extract-models.cjs');
// Reuse the established media vocabulary. Only actual synonyms are used here;
// the old media group combining WiFi with passwords is not a semantic alias.
const operationSynonyms=require('./media-catalog.cjs').videoQuerySynonyms.filter(group=>group.includes('reset'));
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s_-]/g,'');
function resourceTermMatches(term,text){const t=normalize(term),body=normalize(text);return body.includes(t)||operationSynonyms.some(group=>group.some(w=>normalize(w)===t)&&group.some(w=>body.includes(normalize(w))));}
const softwareNames=['HDPlayer','HDSet','HDShow','HDSign','HD2020','HD2018','LCDPlayer','屏掌控','小灰云','LedArt','C1','C2','立方屏'];
const canonicalSoftwareName=name=>name==='LedArt'?'屏掌控':name;
const softwareAliasesFor=name=>softwareNames.filter(alias=>normalize(canonicalSoftwareName(alias))===normalize(name));
const stop=/请问|麻烦|劳驾|帮(?:我|忙)?|我想(?:知道|了解|看看|看|问|查|找)?|想(?:知道|了解|问)|有没有|是否|能否|能不能|可不可以|怎么样|怎么|怎样|如何|多少|几个|哪些|什么|哪个|哪款|发(?:给)?我|给(?:我)?(?:一份)?|都发我|全部发我|查(?:询|找)?|找一下|一下|谢谢|您好|你好|你们|我们|我这(?:个)?|这个|那个|这款|这台|一款|一种|需要|想要|提供|请|的|是|吗|呢|呀|吧|啊/g;
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
const softwareSelectionPattern=/用.{0,6}(?:哪个|哪款|什么)软件|软件.{0,6}(?:哪个|哪款|什么)|(?:调试|配置|控制)软件/;
const operationPattern=/导出|导入|设置|接线|连接|安装|调试|更新|升级|发送|编辑|找回|忘记|忘了|恢复|解锁|步骤|操作|怎么|如何|怎样|咋/;
const genericTerm=/^(?:我|你|它|他|她|要|有|用|能|在|上|下|这|那|个|等|为|与|及|和|或|也|还|都|已|会|到|让|可|该|此|所有|全部|分别|支持|功能|产品|型号|设备|控制卡|接收卡|发送卡|主控|处理器|播放器|说明|使用|操作|设置|方法|步骤|问题|参数|最大|版本|英文版|中文版|中文|英文|视频|一种|几个|进行|可以|还有|还是|应该|通过|一个|正确|办法|回事|控制|显示|哪里|哪儿|何处)$/;
function literalTerms(text){
 // ICU's dictionary leaves unknown engineering words as adjacent single Han
 // characters. Keep those literal runs instead of silently deleting the word.
 // Stop words and punctuation are boundaries; never join across them or add a
 // term that the customer did not write.
 const terms=[];let run='',end=-1;
 const flush=()=>{if(run)terms.push(run);run='';end=-1;};
 for(const part of segmenter.segment(text)){
  const word=part.segment;
  if(!part.isWordLike||genericTerm.test(word)){flush();continue;}
  if(/^[\u3400-\u9fff]$/.test(word)){
   if(run&&part.index!==end)flush();run+=word;end=part.index+word.length;
  }else{flush();terms.push(word);}
 }
 flush();
 // ICU can also split a registered mixed-script term such as U盘 into U + 盘.
 // Preserve literal matches from the existing vocabulary, without aliases or
 // a new per-question word list.
 for(const word of concepts.flatMap(c=>c.words).filter(w=>/[a-z]/i.test(w)&&/[\u3400-\u9fff]/.test(w))){const match=text.match(new RegExp(word,'i'));if(match)terms.push(match[0]);}
 return [...new Set(terms.filter(t=>!genericTerm.test(t)&&(t.length>1||/^(?:单|双|多|少|长|宽|高|\d+)$/.test(t))))];
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function planResourceQuery(input,{models:registeredModels=[],splitRequests=true,resolveFrame=true}={}){
 if(resolveFrame){
  // Reuse the existing clause roles, rather than treating every noun in a
  // customer utterance as a positive retrieval request. This is strictly
  // intra-utterance: no session or previous messages are consulted.
  const frame=require('../parser/intent-frames.cjs').analyzeFrames(String(input||''));
  if(frame.changed&&frame.clauses.some(c=>c.role==='request'||c.corrected)){
   const constraints=frame.clauses.filter(c=>c.role==='constraint').map(c=>c.text);
   const selected=[frame.focusText,...constraints].join('；');
   let focused=planResourceQuery(selected,{models:registeredModels,splitRequests,resolveFrame:false});
   const positive=frame.clauses.filter(c=>!['negated','reported-ui-command'].includes(c.role)).map(c=>c.text).join('；');
   const available=planResourceQuery(positive,{models:registeredModels,splitRequests:false,resolveFrame:false});
   const owners=[...available.models,...available.software];
   // A unique explicit subject in this input may govern the selected request.
   // A negated subject and multiple possible owners may never supply it.
   if(!focused.models.length&&!focused.software.length&&owners.length===1)
    focused=planResourceQuery(owners[0]+' '+selected,{models:registeredModels,splitRequests,resolveFrame:false});
   // A clause labelled 'background' can still carry a language, identity or
   // physical constraint. Project only when those explicit constraints survive;
   // otherwise keep the complete input instead of silently losing a request.
   const omittedQuestion=frame.clauses.some(c=>c.questioned&&!['negated','reported-ui-command'].includes(c.role)&&!selected.includes(c.text));
   const retained=!omittedQuestion&&available.models.every(v=>focused.models.includes(v))&&available.software.every(v=>focused.software.includes(v))&&available.unknownModels.every(v=>focused.unknownModels.includes(v))&&available.literalIdentifiers.every(v=>focused.literalIdentifiers.includes(v))&&available.platforms.every(v=>focused.platforms.includes(v))&&(!available.language||available.language===focused.language);
   if(retained&&(focused.models.length||focused.software.length)&&focused.terms.length)
    return {...focused,original:String(input||'').trim(),semanticScope:{selectedText:selected,clauses:frame.clauses.map(({text,start,end,role})=>({text,start,end,role})),basis:'current-utterance-clause-roles'},contextUsed:false};
  }
 }
 const original=String(input||'').trim(),models=[];const interpreted=require('../parser/customer-language.cjs').interpretCustomerText(original);let remainder=interpreted.query.normalize('NFKC');
 remainder=require('../identity/model-attribute-boundaries.cjs').separateModelAttributes(remainder,{findProducts:id=>registeredModels.filter(m=>normalize(m)===normalize(id))});
 remainder=require('../identity/model-port-ranges.cjs').separateModelPortRanges(remainder,{findProducts:id=>registeredModels.filter(m=>normalize(m)===normalize(id))});
 for(const model of [...registeredModels].sort((a,b)=>b.length-a.length)){
  const core=model.replace(/^HD-/i,'');const spelling=escape(core).replace(/(PRO|PLUS|MAX|MINI|LITE)$/i,'[ _-]*$1');const pattern=new RegExp('(?<![a-z0-9])(?:HD[-_ ]?)?'+spelling+'(?![a-z0-9+_-])','ig');if(pattern.test(remainder)){models.push(model);remainder=remainder.replace(pattern,' ');}
 }
 if(!models.length){const numeric=/^\s*(\d{3,4})(?=[^\d]|$)/.exec(remainder);if(numeric){const exact=registeredModels.filter(m=>m.replace(/^HD-/i,'').match(/^([A-Z]+)(\d+)(?:[A-Z+]*)$/i)?.[2]===numeric[1]);if(exact.length===1){models.push(exact[0]);remainder=remainder.replace(numeric[1],' ');}}}
 const namedSoftware=softwareNames.filter(s=>{const text=normalize(original),term=normalize(s);return /^C[12]$/.test(s)?new RegExp('(?<![a-z0-9])'+term+'(?!\\d)','i').test(text):text.includes(term)}),software=namedSoftware.map(canonicalSoftwareName);
 const content=original.replace(/视频处理器|视频拼接处理器/g,'处理器');
 const softwareLookupRemainder=remainder.replace(stop,' ').replace(/的|\s/g,'');
 const languagePlan=require('../parser/query-language.cjs').queryLanguage(original);
 const softwareSelection=!!languagePlan.selection||softwareSelectionPattern.test(original)||models.length>0&&!software.length&&/^(?:有|用)?软件$/.test(softwareLookupRemainder);
 const operation=!!languagePlan.how||softwareSelection||operationPattern.test(original);
 const categories=[];
 if(/规格书|specification/i.test(content))categories.push('spec');
 if(/说明书|手册|操作说明|manual/i.test(content))categories.push('manual');
 if(/教程|教学|演示|录像/.test(content)||[...content.matchAll(/视频/g)].some(m=>!/^(?:播放|格式|解码|窗口|转码|输入|输出)/.test(content.slice(m.index+2))&&!/播放$/.test(content.slice(0,m.index))))categories.push('video');
 if(/(?:模组)?配置文件|\.ssr\b|\.rcg\b/i.test(content)&&!/导出|导入|保存|读取|编辑/.test(content))categories.push('module-config');
 if(/固件|升级包|烧录包|\.bin\b/i.test(content)&&(!operation||/升级包|烧录包|\.bin\b/i.test(content)||!/怎么|如何|怎样|步骤|教程|操作/.test(content)))categories.push('firmware');
 for(const doc of languagePlan.documents)if(!categories.includes(doc.id)&&(doc.id!=='firmware'||!operation||languagePlan.download))categories.push(doc.id);
 const resourceSubject=categories.includes('manual')&&(software.length||/软件/.test(original))?'software':models.length?'device':null;
 if(categories.includes('module-config'))remainder=remainder.replace(/模组配置文件|配置文件|芯片|译码|扫描|规格|参数|模组/g,' ');
 else remainder=remainder.replace(/规格书|操作\s*说明书|说明书|使用手册|用户手册|操作手册|手册|视频教程|操作视频|教学视频|使用视频|视频演示|教程|教学|视频(?!处理器)/g,' ');
 if(categories.includes('firmware'))remainder=remainder.replace(/固件|升级包|烧录包/g,' ');
 remainder=remainder.replace(stop,' ').replace(/[，,。?？!！;；、—–:：]+/g,' ').replace(/\s+/g,' ').trim();
 for(const s of namedSoftware){const p=new RegExp([...s].map(escape).join('[\\s_-]*'),'ig');remainder=remainder.replace(p,' ')}
 if(models.length)remainder=remainder.replace(/显示屏|控制卡|接收卡|发送卡|处理器|播放器|盒子|设备|产品|型号|\bLED\b/gi,' ');
 remainder=require('../parser/query-language.cjs').retrievalProjection(remainder);
 // Document categories already bind file type; do not require the catalogue
 // title and every body paragraph to repeat that translated category word.
 for(const category of categories)remainder=remainder.replace(new RegExp(({manual:'说明书',spec:'规格书',video:'视频',firmware:'固件'})[category]||'(?!)','g'),' ');
 const focus=remainder.replace(/\s+/g,' ').trim();
 const capabilityQuestion=!categories.length&&require('../parser/chat-intent.cjs').decideAction(original,{models,software}).answerNeed==='capability-confirmation';
 const terms=literalTerms(focus);
 // Keep a count attached to its written unit: a page number '4' is not a
 // request for '4路'. Preserve source spans for inspection; no count is inferred.
 const quantities=[...focus.matchAll(/\d+(?:\.\d+)?\s*(?:路|个|张|台|面|级|行|口)/g)].map(m=>({text:m[0],value:Number(m[0].match(/[\d.]+/)[0]),unit:m[0].match(/[^\d.\s]+$/)[0],start:m.index,end:m.index+m[0].length}));
 if(capabilityQuestion)for(const quantity of quantities){const numeric=String(quantity.value),at=terms.indexOf(numeric);if(at>=0)terms.splice(at,1);const token=quantity.text.replace(/\s/g,'');if(!terms.includes(token))terms.push(token);}
 // Default/initial is an applicability qualifier, not another independent
 // topic that can outweigh the requested field. Keep it on the original plan;
 // source and answer checks still require an initial/default value.
 const initialValue=/初始|默认/.test(original);
 if(initialValue)for(let i=terms.length-1;i>=0;i--)if(/^(?:初始|默认)$/.test(terms[i]))terms.splice(i,1);
 const actions=[...new Set(original.match(/导出|导入|添加|编辑|发送|更新|升级|安装|恢复|找回|切换|删除|注册|回读|绑定|解锁|锁定|开窗|投屏|分屏/g)||[])];
 // Identifiers have already been removed from focus. Do not manufacture an
 // attribute by joining neighbouring model names (PRO + MS -> ROM), or by
 // matching an English abbreviation inside another word.
 const attributes=concepts.filter(c=>c.type==='attribute'&&!['function','size'].includes(c.id)&&c.words.some(w=>/^[a-z][a-z0-9]*$/i.test(w)?new RegExp('(?<![a-z0-9])'+escape(w)+'(?![a-z0-9])','i').test(focus):normalize(focus).includes(normalize(w)))).map(c=>c.id);
 for(const field of languagePlan.fields){const id=field.id==='resolution'?'load':field.id==='size'?'size':null;if(id&&!attributes.includes(id))attributes.push(id);}
 if(/能带|带多少|带多大/.test(original)&&/分辨率|像素|点/.test(original)&&!attributes.includes('load'))attributes.push('load');
 const topics=concepts.filter(c=>['topic','symptom'].includes(c.type)&&c.words.some(w=>normalize(original).includes(normalize(w)))).map(c=>c.id);
 const termAlternatives=operationSynonyms.filter(group=>group.some(word=>normalize(original).includes(normalize(word))));
 const literalIdentifiers=[...new Set([...original.matchAll(/(?:ICND?|SM|FM|LS|DP|MBI|TC|RUL|RUC)\d{3,5}[A-Z0-9]*|(?<![\w.])\d{3,5}[A-Z]{1,4}(?![\w.])/gi)].map(m=>m[0].toUpperCase()).filter(token=>!/^\d+(?:V|MV|KV|W|MW|KW|MA|A|HZ|KHZ|MHZ|MM|CM|M|GB|MB|KB)$/i.test(token)))];
 if(categories.includes('firmware'))for(const m of original.matchAll(/(?<![a-z0-9_.])\d{4,5}(?![a-z0-9_.])/gi))if(!literalIdentifiers.includes(m[0]))literalIdentifiers.push(m[0]);
 const overview=!categories.length&&/功能|特点|概述|介绍/.test(original);
 if(overview){const index=terms.indexOf('软件');if(index>=0&&software.length)terms.splice(index,1);for(const word of original.match(/功能|特点|概述|介绍/g)||[])if(!terms.includes(word))terms.push(word);}
 const deliveryOnly=terms.length>0&&terms.every(t=>/^(?:下载|链接|资料|提供|发给|给我)$/.test(t));
 const browseResources=!categories.length&&models.length>0&&!attributes.length&&/下载|链接|资料/.test(original)&&(deliveryOnly||!terms.length);
 const broad=browseResources||!softwareSelection&&!overview&&/^(?:使用|操作|调试|说明|参数|设置|方法|步骤|流程|基本|功能|软件|有|用|发节目|\s)*$/.test(focus);
 const parameterOverview=!categories.length&&models.length>0&&!attributes.length&&/参数|规格/.test(original)&&broad;
 const modelFamilies=[...new Set([...original.matchAll(/\b([A-Z]{1,4})\s*系列/gi)].map(m=>m[1].toUpperCase()).filter(p=>registeredModels.some(m=>new RegExp('^HD-'+p+'\\d').test(m))))];
 // Keep a normalized task marker when polite-word removal erased its only
 // trigger ("怎么"). Searching these keywords must not lose the same scope.
 const intentMarker=softwareSelection&&!softwareSelectionPattern.test(focus)?'控制软件':!softwareSelection&&operation&&!categories.length&&!operationPattern.test(focus)?'操作':null;
 const topic=[...new Set([...software,focus,intentMarker].filter(Boolean))].join(' ').trim();
 const query=[...models.map(m=>m.replace(/^HD-/i,'')),topic,...categories.map(c=>({spec:'规格书',manual:'说明书',video:'视频',firmware:'固件','module-config':'模组配置文件'}[c]))].filter(Boolean).join(' ').trim()||original;
 const languageRequest=categories.some(c=>c==='manual'||c==='spec')||/英文版|中文版|英文资料|中文资料/i.test(original);
 const language=!languageRequest||/中英文|中英版|中文.*英文|英文.*中文/i.test(original)?null:/英文|english/i.test(original)?'en':/中文|chinese/i.test(original)?'zh':null;
 const nameLanguage=!categories.length&&software.length&&/英文(?:名称|名)?(?:(?:是|叫|怎么|什么)|$)|英文(?:名称|名)/.test(original)?'en':null;
 const explicitSoftwareEdition=/单色|双色|全彩|标准版|\b(?:Lite|Pro|Plus|Mini)\b/i.test(original);
 const nameAliases=nameLanguage&&!explicitSoftwareEdition?software.flatMap(softwareAliasesFor).filter(alias=>/^[a-z][a-z0-9\s-]+$/i.test(alias)):[];
 const documentDecision=categories.length&&categories.every(c=>c==='manual'||c==='spec')?require('../parser/chat-intent.cjs').decideAction(original,{models,software}):null;
 // A document type can constrain the evidence without making the requested
 // answer a file list. Reuse the shared action decision rather than routing
 // every mention of “manual” away from its actual parameter/operation goal.
 const documentReference=documentDecision?.frames.some(clause=>clause.tokens.some(token=>token.type==='document'&&/^[中里]/.test(original.slice(token.end)))&&clause.tokens.some(token=>token.type==='question'));
 const documentContent=!!documentDecision&&!broad&&!deliveryOnly&&(['guide-operation','query-parameters'].includes(documentDecision.action)||documentReference);
 const metadataQuery=!categories.length&&!models.length&&!software.length&&!operation&&!attributes.length&&!topics.length&&/\d/.test(focus)&&/^[a-z0-9_.+\s-]*$/i.test(focus);
 const answerNeed=metadataQuery?'resource-candidates':documentContent?'document-content':categories.length?'resource':overview?'overview':attributes.length||/多少|几个|是什么|叫什么|哪个|哪款|默认|初始|型号/.test(original)?'fact':operation||termAlternatives.length?'procedure':broad?'browse':'topic';
 const platforms=[...new Set((original.match(/\biOS\b|\bAndroid\b|安卓|苹果|\bWindows\b|\bLinux\b/gi)||[]).map(t=>/安卓|android/i.test(t)?'android':/苹果|ios/i.test(t)?'ios':t.toLowerCase()))];
 const social=/^(?:你好|您好|嗨|hello|hi|谢谢|感谢|多谢|谢了)[!！。\s]*$/i.test(original);
 const unknownModels=extractModelTokens(remainder,{numericPrefix:false}).filter(t=>!isTechnicalToken(t,original)&&!literalIdentifiers.some(id=>normalize(id)===normalize(t))&&!/^P\d|^V\d|^(?:DP|SM|FM|ICN|MBI|LS|TC|HUB|USB|HDMI)\d/i.test(t)&&!softwareNames.some(s=>normalize(s)===normalize(t))&&!models.some(m=>normalize(m.replace(/^HD-/i,''))===normalize(t.replace(/^HD[-_ ]?/i,''))));
 const canonicalQuery=nameLanguage&&!explicitSoftwareEdition&&!unknownModels.length?[...models.map(m=>m.replace(/^HD-/i,'')),...new Set(software),'英文名称'].join(' '):query;
 const requestSpans=[];
 if(splitRequests){const fragments=[...original.matchAll(/[^;；。？?]+/g)].map(m=>({text:m[0].trim(),start:m.index,end:m.index+m[0].length})).filter(m=>m.text);
  if(fragments.length>1&&fragments.length<=4){const parsed=fragments.map(f=>({...f,plan:planResourceQuery(f.text,{models:registeredModels,splitRequests:false})}));
   const isRequest=p=>p.categories.length||p.attributes.length||p.operation||p.overview;
   if(parsed.every(f=>(f.plan.models.length||f.plan.software.length)&&isRequest(f.plan)))requestSpans.push(...parsed.map(({text,start,end,plan})=>({text,start,end,query:plan.query})));
   else if((models.length===1&&!software.length||software.length===1&&!models.length)&&(parsed[0].plan.models.length||parsed[0].plan.software.length)&&parsed.every(f=>isRequest(f.plan)&&!f.plan.unknownModels.length)){
    // A single explicit subject can govern multiple requests *inside this
    // input*. Keep the original clause plus its binding provenance. Multiple
    // subjects, bare feedback, and previous-turn identities are never borrowed.
    const owner=models[0]||software[0];
    for(const {text,start,end,plan:child} of parsed){const named=child.models.length||child.software.length,executionText=named?text:owner+' '+text,scoped=planResourceQuery(executionText,{models:registeredModels,splitRequests:false});
     requestSpans.push({text,start,end,query:scoped.query,executionText,scopeBinding:named?null:{subject:owner,basis:'single-explicit-subject-in-current-input'}});
    }
   }
  }
 }
 return {original,query:requestSpans.length?requestSpans.map(r=>r.query).join('；'):canonicalQuery,focus,terms,quantities,capabilityQuestion,resourceSubject,termAlternatives,actions,topics,literalIdentifiers,models:[...new Set(models)],modelFamilies,unknownModels,software:[...new Set(software)],categories:[...new Set(categories)],attributes,operation,softwareSelection,broad,browseResources,overview,parameterOverview,answerNeed,documentContent,initialValue,language,nameLanguage,nameAliases,platforms,social,requestSpans,corrections:interpreted.corrections,contextUsed:false};
}
module.exports={planResourceQuery,normalize,softwareNames,resourceTermMatches,literalTerms,canonicalSoftwareName,softwareAliasesFor};
