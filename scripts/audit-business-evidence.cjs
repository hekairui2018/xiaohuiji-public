'use strict';
// Local-only, read-only business evidence audit. --freeze never overwrites an existing baseline.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
process.env.LLM_API_KEY = '';
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i=args.indexOf(name); if(i<0)return fallback; if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+name); return args[i+1]; };
const target = path.resolve(root, option('--output', 'tmp/business-evidence-20261013'));
const phase = args.includes('--freeze') ? 'before' : option('--phase', 'after');
if (!['before', 'after', 'after-status'].includes(phase)) throw new Error('Invalid audit phase');
const load = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const canonical = s => String(s || '').toUpperCase().replace(/^HD[-_\s]?/, '').replace(/[^A-Z0-9]/g, '');
const modelTokens = text => [...new Set((String(text || '').toUpperCase().match(/\b(?:HD[-_])?(?:VPX?\d{2,4}[A-Z]?|KVX?\d{2,4}[A-Z]?|R\d{2,4}[A-Z]?|A\d{1,4}L?|[BCDHW]\d{1,3}[A-Z]?)\b/g) || []).map(canonical))];
const identity = c => JSON.stringify([c.sourceFile, c.originalId, c.source?.locator || '']);
function shuffle(list, seed) { const a = [...list]; for(let i=a.length-1;i>0;i--) {seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=Math.floor(seed/4294967296*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a; }
const snapshotFile = path.join(target, 'frozen-inputs.json');
if (args.includes('--freeze')) {
  if (fs.existsSync(target)) throw new Error('Baseline directory exists; choose a new directory, never overwrite');
  fs.mkdirSync(target, { recursive: true });
  const dataset = load('data/aftersales/aftersales-cases.json');
  const sourceFiles = fs.readdirSync(path.join(root,'data/aftersales/sources')).filter(f=>f.endsWith('.json')).sort();
  const sources = Object.fromEntries(sourceFiles.map(f=>[f,load('data/aftersales/sources/'+f)]));
  const eligible = dataset.cases.filter(c=>c.recordType==='case'&&dataset.activeDomains.includes(c.domain)&&c.customerWording&&c.sourceExcerpt);
  const priorFile = path.join(root,'tmp/aftersales-100-audit.json');
  const fixedIds = fs.existsSync(priorFile) ? load('tmp/aftersales-100-audit.json').rows.map(r=>r.caseId) : eligible.slice(0,100).map(c=>c.id);
  const fixed = fixedIds.map(id=>dataset.cases.find(c=>c.id===id)).filter(Boolean);
  const random = shuffle(eligible.filter(c=>!fixedIds.includes(c.id)),20261014).slice(0,100);
  const samples=[...fixed.map(c=>({set:'fixed',id:c.id,query:c.customerWording})),...random.map(c=>({set:'random',id:c.id,query:c.customerWording}))];
  const modelFixtures=[['A3','A3L'],['A3L','A3'],['VP620','VP620A'],['R512','R512T'],['C16','C16L'],['A3','A3'],['HD-A3','A3'],['VP620A','VP620A']];
  const orderingQueries=['1920x1080 P3 室内 全彩 同步','P2.5 宽6米高3米 室内 同步','P10 宽16米高0.96米 户外 异步','P3 10宽8高 帮我出个拓扑图','P2 8宽2高 室内 全彩','宽14高15，14张716卡，620帮忙画个接线图','P2 64x64 32S HUB75 全彩 宽10块高10块','P3','宽6高3','P3 1920x1080 R712 同步'];
  const inputs={dataset,sources,samples,modelFixtures,orderingQueries,products:load('data/product-index.json'),specs:load('data/product-specs-index.json'),firmware:load('data/firmware-manifest.json'),official:load('reference/official-selection-tool/official-device-full.json'),devices:load('backend/ordering/data/ordering-device-catalog.json'),verified:load('backend/ordering/data/09_配单选型知识库_已验证带载档案.json')};
  fs.writeFileSync(snapshotFile,JSON.stringify(inputs));
  const tracked=['data/product-index.json','data/product-specs-index.json','data/aftersales/aftersales-cases.json',...sourceFiles.map(f=>'data/aftersales/sources/'+f),...fs.readdirSync(path.join(root,'backend/ordering/data')).filter(f=>f.endsWith('.json')).map(f=>'backend/ordering/data/'+f)];
  fs.writeFileSync(path.join(target,'baseline-manifest.json'),JSON.stringify({date:'2026-10-13',node:process.version,commit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),seed:20261014,inputSHA256:sha(fs.readFileSync(snapshotFile)),dataHashes:Object.fromEntries(tracked.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]))},null,2));
}
const input=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(target,'baseline-manifest.json'),'utf8'));
if(sha(fs.readFileSync(snapshotFile))!==manifest.inputSHA256)throw Error('Frozen evidence changed');
for(const [f,hash] of Object.entries(manifest.dataHashes))if(sha(fs.readFileSync(path.join(root,f)))!==hash)throw Error('Business data changed: '+f);
const outputFile=path.join(target,phase+'-results.json');
if(fs.existsSync(outputFile))throw Error('Results exist; no overwriting');
const sp=require('../backend/specialist/aftersales-specialist.js'), engine=require('../backend/ordering/ordering-engine.cjs');
function rawRows(file){const d=input.sources[file];return Array.isArray(d)?d:d?.cases||d?.rows||[];}
function sourceFor(c){const matches=rawRows(c.sourceFile).filter(r=>String(r.id)===String(c.originalId));return matches.find(r=>String(r.source?.locator||'')===String(c.source?.locator||''))||(matches.length===1?matches[0]:null);}
const rows=[];
for(const sample of input.samples){
 const c=input.dataset.cases.find(c=>c.id===sample.id), raw=sourceFor(c);let result,error='';try{result=sp.handle(sample.query,[]);}catch(e){error=e.message;}
 const top=[result?.bestId,...(result?.candidates||[]).map(r=>r.id)].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).slice(0,3);
 const queryModels=modelTokens(sample.query);const queryChips=String(sample.query).toUpperCase().match(/\b(?:FM|ICN|ICND|SM|DP|LS|RUL|MBI)\d{3,5}[A-Z]*\b/g)||[];
 const assessment=top.map(id=>{const picked=input.dataset.cases.find(x=>x.id===id);const source=picked&&sourceFor(picked);if(!picked||!source)return {id,evidence:'unknown'};const models=(source.deviceInfo?.products||[]).map(canonical);const sourceModels=[...new Set([...models,...modelTokens([source.title,source.customerWording,source.phenomenon].join(' '))])];const exact=queryModels.filter(x=>sourceModels.includes(x));const chips=(source.deviceInfo?.chips||[]).map(canonical);const chipMatches=queryChips.filter(x=>chips.includes(canonical(x)));const suffixConflict=queryModels.length>0&&!exact.length&&!chipMatches.length&&queryModels.some(q=>sourceModels.some(m=>q!==m&&(q.startsWith(m)||m.startsWith(q))));return {id,sourceLocator:source.source?.locator||'',models:sourceModels,exactModelMatches:exact,chipMatches,suffixConflict,evidence:'extracted-source',solutionConsistent:String(picked.solution||'').replace(/\s/g,'')===String(source.solution||'').replace(/\s/g,''),unresolved:/未填写|未明确|暂无|待验证|跟踪中|未解决/.test(String(source.solution||'')),excerptAvailable:Boolean(source.sourceExcerpt)};});
 const picked=input.dataset.cases.find(x=>x.id===result?.bestId);
 rows.push({set:sample.set,caseId:c.id,query:sample.query,sourceIdentity:identity(c),originalSourceAvailable:Boolean(raw),reference:{domain:c.domain,rawDomain:raw?.domain||null,models:raw?.deviceInfo?.products||[],phenomenon:raw?.phenomenon||'',solution:raw?.solution||'',applicability:raw?.applicability||'',sourceExcerpt:raw?.sourceExcerpt||''},output:result||null,error,top3:assessment,firstSameSource:result?.bestId===c.id,top3SameSource:top.includes(c.id),domainAgreement:picked?picked.domain===c.domain:null,firstExplicitSuffixConflict:assessment[0]?.suffixConflict||false,grade:'unknown-engineering-success',conditionAndStepVerification:'source text available for inspection; no independent hardware-success evidence'});
}
const metrics={};for(const set of ['fixed','random']){const a=rows.filter(r=>r.set===set);metrics[set]={count:a.length,exceptions:a.filter(r=>r.error).length,originalSourceAvailable:a.filter(r=>r.originalSourceAvailable).length,firstSameSource:a.filter(r=>r.firstSameSource).length,top3SameSource:a.filter(r=>r.top3SameSource).length,domainAgreement:a.filter(r=>r.domainAgreement===true).length,domainUnknown:a.filter(r=>r.domainAgreement===null).length,explicitSuffixConflict:a.filter(r=>r.firstExplicitSuffixConflict).length,sourceSolutionConsistent:a.filter(r=>r.top3[0]?.solutionConsistent).length,unresolvedSourceSelected:a.filter(r=>r.top3[0]?.unresolved).length,engineeringOutcomeUnknown:a.length};}
const modelChecks=input.modelFixtures.map(([query,model])=>{const c={products:[model],chips:[],title:model+'花屏'};const sit={products:[canonical(query),'R712'],chips:[]};return {query,caseModel:model,expectedCoverage:canonical(query)===canonical(model)?0.5:0,actualCoverage:sp.hwCoverage(c,sit)};});
const ordering=input.orderingQueries.map(query=>{const a=engine.answerWithContext([query]),r=a.result?.ok?a.result:a.result?.provisional;const issues=[],unknown=[];if(r?.ok){const ports=r.plan?.ports||[];const cells=ports.flatMap(p=>p.cells||[]);if(r.screenW*r.screenH!==r.totalPx)issues.push('screen-area');if(cells.length&&cells.length!==r.receiverQuantity)issues.push('receiver-count');if(ports.length!==r.physicalPortCount)issues.push('port-count');if(ports.some(p=>(p.points||p.boundingPoints)>655360))issues.push('gigabit-port-limit');if(cells.length&&cells.reduce((s,c)=>s+c.pxW*c.pxH,0)!==r.totalPx)issues.push('topology-area');const actualProcessor=r.processor||r.syncProcessor||r.asyncProcessor;const official=input.official.find(x=>canonical(x.model)===canonical(actualProcessor?.name));if(official){if(r.physicalPortCount>official.ports)issues.push('official-output-ports');if(r.totalPx>official.points)issues.push('official-controller-points');}else unknown.push('official-controller-evidence');if(a.input.modulePixelsAssumed||a.input.presetAssumed){if(r.resultState==='formal')issues.push('assumed-input-marked-formal');unknown.push('module-assumption');}const verified=input.verified.profiles.filter(v=>['official','verified'].includes(v.status)&&Number(v.match.pitch)===Number(a.input.pitch)&&JSON.stringify(v.match.modulePixels)===JSON.stringify(a.input.modulePixels)&&String(v.match.scan||'')===String(a.input.scan||''));if(!verified.length)unknown.push('verified-exact-module-profile');}else unknown.push('no-confirmed-result');return {query,input:a.input,result:a.result,topologySvg:a.topologySvg,issues,unknown};});
const aliases=new Map();for(const p of input.products.products)for(const alias of [p.product,...(p.aliases||[])]){const k=canonical(alias);const s=aliases.get(k)||new Set;s.add(p.product);aliases.set(k,s);}
const sourceDuplicateGroups=new Map;for(const c of input.dataset.cases){const key=c.sourceFile+'|'+c.originalId;const ids=sourceDuplicateGroups.get(key)||[];ids.push(c.id);sourceDuplicateGroups.set(key,ids);}
const products={productCount:input.products.products.length,specCount:input.specs.products.length,ambiguousAliases:[...aliases].filter(([k,v])=>v.size>1).map(([alias,v])=>({alias,owners:[...v]})),sourceOriginalIdCollisions:[...sourceDuplicateGroups].filter(([k,v])=>v.length>1).map(([key,ids])=>({key,ids})),specMissing:input.products.products.filter(p=>!input.specs.products.some(s=>canonical(s.product||s.displayName)===canonical(p.product))).map(p=>p.product),firmwareRows:input.firmware.items.length,rawPDFValidation:'not performed; indexed parameters and extracted source text do not substitute for original specification bytes'};
const report={phase,inputSHA256:manifest.inputSHA256,metrics,modelChecks,productStructure:products,orderingSummary:{count:ordering.length,issues:ordering.filter(x=>x.issues.length).map(x=>({query:x.query,issues:x.issues})),unknown:ordering.filter(x=>x.unknown.length).length},rows,ordering};
fs.writeFileSync(outputFile,JSON.stringify(report,null,2));console.log(JSON.stringify({phase,metrics,modelChecks,productStructure:products,orderingSummary:report.orderingSummary},null,2));
