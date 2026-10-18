'use strict';
// Reuse V1 text cleanup, but never V1's model-prefix guesses, global data lookup,
// assumed port counts, or width × height load inference. Input is consumed V2 evidence.
const {displayText:{fieldSentences,stripName,cleanSeries}}=require('../../../backend/product-features.cjs');
const unique=rows=>[...new Set(rows.filter(Boolean))];
function sentences(value){return fieldSentences({value},'value').map(stripName);}
function body(text){return text.replace(/^(?:产品系列|最大控制|最大带载|控制范围|信号输入接口|输入接口|输出接口|接口数量|接口|输出|输入)\s*[:：]\s*/,'').trim();}
function productCardFeatures(product){
 const p=product.parameters||{},claims=product.claims||[];
 const text=unique([...Object.values(p).flatMap(sentences),...claims.flatMap(c=>sentences(c.text))]);
 const explicit=label=>text.filter(t=>new RegExp('^'+label+'\\s*[:：]').test(t));
 const seriesText=[...sentences(p.productSeries),...explicit('产品系列')].find(t=>/^产品系列\s*[:：]/.test(t)&&cleanSeries(t));
 const typeText=sentences(p.productSeries).join(' ');
 const series=seriesText?body(seriesText):typeText.length<=28&&!/连接|网线|步骤|支持|兼容|[，,；;]|connect/i.test(typeText)?cleanSeries(typeText)||'':'';
 const colorText=text.filter(t=>/^(?:产品系列|颜色|色彩)\s*[:：]|(?:is|是一款|为).{0,70}(?:single\s*\/\s*dual\s*color|单双色|全彩)/i.test(t)).join(' ');
 const color=/单色.{0,5}双色|single\s*\/\s*dual\s*color/i.test(colorText)?'单色 / 双色':/全彩/.test(colorText)?'全彩':'';
 const features={series,color,load:unique(sentences(p.load).map(body)).join('；'),resolution:'',inputs:'',outputs:'',interfaces:'',highlights:''};
 if(product.selectedDocumentVersion)features.parameterVersion=product.selectedDocumentVersion;
 const resolution=sentences(p.resolution).filter(t=>/\d+\s*[/／×x*]\s*\d+|最宽|最高|宽度|高度|maximum width|maximum high|分辨率|resolution|^注[:：]/i.test(t)&&!(/\.\.\.$|…$/.test(t)));
 // These are independent limits, never a promise that their product is loadable.
 const pair=resolution.length===1&&/^(?:宽[/／]高\s*[:：]\s*)?(\d+)\s*[/／]\s*(\d+)$/.exec(resolution[0]);
 if(pair){features.resolution=`最宽 ${pair[1]}；最高 ${pair[2]}（独立上限）`;features.resolutionLabel='宽高上限';}
 else if(resolution.length){features.resolution=unique(resolution).join('；');features.resolutionLabel=/最宽|最高|maximum width|maximum high/i.test(features.resolution)?'宽高条件':'参数说明';}
 const portText=unique([...sentences(p.interfaces),...claims.filter(c=>['ports','operation'].includes(c.field)).flatMap(c=>sentences(c.text))]);
 const rows={inputs:[],outputs:[],interfaces:[]};
 for(const t of portText){
  if(/若[用是]|依次设置|连接电脑|连接起来|调试正常之后|通过软件|点[“"「]/.test(t))continue;
  // A field named "ports" often contains unrelated paragraphs in the old index.
  if(!/HDMI|DVI|\bDP\b|USB|HUB\s*\d|网口|Ethernet|network port|TRS|音频|audio output|传感器.*接口|sensor.*interface|^接口.*[:：]/i.test(t))continue;
  if(/^(?:支持|产品系列|选型速查)\s*[:：]/.test(t)||/\.\.\.$|…$/.test(t))continue;
  const input=/信号输入接口|输入接口|\binputs?\b/i.test(t),output=/^输出\s*[:：]|输出接口|输出网口|output network port|audio output|TRS类型：输出/i.test(t);
  const key=input&&!output?'inputs':output&&!input?'outputs':'interfaces';
  let value=body(t);
  // Only compact a statement that explicitly supplies the connector and count.
  const hdmi=/^(one|two|three|four|\d+)\s+HDMI\s*(\d\.\d)?\s+inputs?\b/i.exec(value);
  if(hdmi){const n=({one:1,two:2,three:3,four:4})[hdmi[1].toLowerCase()]||hdmi[1];value=`HDMI${hdmi[2]?' '+hdmi[2]:''}×${n}`;}
  value=value.replace(/^(\d+)\s*网口$/,'网口×$1');
  if(/^接口\s*[:：]?\s*(?:千兆|百兆)$/.test(t))value=body(t)+'（接口类型，数量未注明）';
  rows[key].push(value);
 }
 for(const key of Object.keys(rows))features[key]=unique(rows[key]).join('；');
 // Keep literal capabilities and their qualifiers, rather than keyword-to-selling-point rules.
 features.highlights=unique(text.filter(t=>/^(?:支持|扫描方式|外接传感器|内存|级联)\s*[:：]/.test(t))).join('；');
 if(product.parameterStatus==='document-version-conflict')features.notice='规格书版本的带载/尺寸参数存在差异，请先确认版本。';
 if(product.parameterStatus==='document-version-not-supported')features.notice='尚无此版本的已确认参数。';
 // Retain provenance separately; the original document actions remain available on the card.
 const publicRef=r=>({name:r.originalName||null,page:r.page||null,locator:r.locator||null,url:r.url||null,sha256:r.originalSha256||r.sha256||null,verificationStatus:r.verificationStatus||'indexed-not-content-verified'});
 features.evidence={parameterEvidence:Object.fromEntries(Object.entries(product.parameterEvidence||{}).map(([field,refs])=>[field,refs.map(publicRef)])),claims:claims.map(c=>({claimId:c.claimId,field:c.field,verificationStatus:c.verificationStatus||'indexed-not-content-verified',sourceReferences:(c.sourceReferences||[c.sourceReference].filter(Boolean)).map(publicRef)}))};
 return features;
}
module.exports={productCardFeatures};
