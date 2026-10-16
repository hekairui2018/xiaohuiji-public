"""Evidence-facing comparison and independent-review bundle, never active knowledge."""
import collections,csv,hashlib,html,io,json,re,time,zipfile
from xml.etree import ElementTree as ET
from pathlib import Path
from bonsai import STAGE,get
from source import ROOT,WORK,NS,W,sha,text,decode,save
from evaluate_bonsai import load,evaluate,coverage
from export_review import build as export

def verify_sources():
 checks=[];total=0
 for d in load('source-evidence.json'):
  for l in d['locations']:
   actual=sha(l['path']);assert actual==d['sha256'];checks.append({'documentId':d['documentId'],'path':l['path'],'sha256':actual,'unchanged':True})
  p=Path(d['locations'][0]['path'])
  if p.suffix=='.csv':
   rows=list(csv.reader(io.StringIO(decode(p.read_bytes()))));reader=lambda u:' | '.join(rows[u['locator']['row']-1])
   for u in d['units']:assert reader(u)==u['text'];total+=1
  else:
   with zipfile.ZipFile(p) as z:
    roots={}
    for u in d['units']:
     part=u['locator']['part']
     if part not in roots:roots[part]=ET.fromstring(z.read(part))
     root=roots[part]
     if p.suffix=='.pptx':
      if u.get('textProjectionVersion')=='paragraphs-v2-not-formatting-runs':
       from ppt_projection import paragraphs
       actual='\n'.join(paragraphs(root))
      else:actual='\n'.join(n.text or '' for n in root.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}t'))
     else:
      n=root.find(u['locator']['xpath'],NS);assert n is not None
      if n.tag=='{'+W+'}tr':
       cells=[text(c) for c in n.findall('w:tc',NS)];actual=' | '.join(cells) if any(cells) else ''
      else:actual=text(n)
     assert actual==u['text'],u['evidenceId'];total+=1
 baseline=json.loads((WORK/'safety-checks.json').read_text(encoding='utf8'));state=[]
 for r in baseline:
  actual=sha(ROOT/r['path']);assert actual==r['sha256'];state.append({'path':r['path'],'sha256':actual,'unchanged':True})
 result={'sourceLocations':checks,'rereadUnits':total,'stateFiles':state,'errors':0};save(STAGE/'original-readback-and-safety.json',result);return result

def resources():
 receipts=[json.loads(p.read_text(encoding='utf8')) for p in sorted((STAGE/'calls').glob('*.json'))]
 gpu=[]
 for r in receipts:
  for s in r.get('gpuSamples',[]):
   if 'sample' in s:
    try:gpu.append([float(x.strip()) for x in s['sample'].split(',')])
    except ValueError:pass
 props=get('/props');save(STAGE/'model-after.json',props);before=load('model-identity.json')['props']
 invariant={k:props[k]==before[k] for k in ['model_alias','model_path','model_ftype','total_slots']};assert all(invariant.values())
 actual={'model':'bonsai','parameters':26895998464,'quantization':props['model_ftype'],'configuredContext':props['default_generation_settings']['n_ctx'],'slots':props['total_slots'],'endpoint':'http://127.0.0.1:8080',
  'experimentCalls':len(receipts),'retries':0,'transportFailures':sum(bool(r.get('error')) for r in receipts),'promptTokens':sum(r.get('response',{}).get('usage',{}).get('prompt_tokens',0) for r in receipts),'completionTokens':sum(r.get('response',{}).get('usage',{}).get('completion_tokens',0) for r in receipts),
  'modelCallWallSeconds':round(sum(r['seconds'] for r in receipts),3),'experimentElapsedSeconds':round(max(r['startedUnix']+r['seconds'] for r in receipts)-min(r['startedUnix'] for r in receipts),3),'gpuSampleCount':len(gpu),'gpuMemoryMiBMin':min((g[0] for g in gpu),default=None),'gpuMemoryMiBMax':max((g[0] for g in gpu),default=None),'gpuUtilizationPercentMax':max((g[1] for g in gpu),default=None),
  'serverIdentityUnchanged':invariant,'configurationChanges':'none; temperature/seed/thinking/grammar are request-local','thinking':False,'cloudApiCalls':0,'uploads':0,'agentTokens':'not exposed, not estimated','initialConnectivityProbesOutsideReceipts':{'calls':2,'promptTokens':82,'completionTokens':38,'source':'observed terminal results; first short probe ended in reasoning before answer; second returned ready JSON'},
  'usageScope':'experimentCalls include preserved v1/v2 pilot failures, final v3 and limited image read; pilots are prompt revisions, not hidden transport retries; GPU memory is total server/device load sampled every five seconds, not extraction-only allocations'}
 actual['promptTokensIncludingConnectivityProbes']=actual['promptTokens']+82;actual['completionTokensIncludingConnectivityProbes']=actual['completionTokens']+38
 save(STAGE/'model-resources.json',actual);return actual

def finish():
 for rev in [1,2,3]:evaluate(rev)
 metrics=load('v3-metrics.json');legacy=load('legacy-aligned-metrics.json');cases=load('v3-cases.json');bycase={c['caseId']:c for c in cases};targets=load('frozen-gold-stage2.json')+load('frozen-blind-gold.json');matches=load('v3-target-matches.json');bymatch={m['reviewId']:m for m in matches};docs=load('source-evidence.json');units={u['evidenceId']:u for d in docs for u in d['units']};bydoc={d['documentId']:d for d in docs}
 # Citation-level precision is not semantic role accuracy. Grade only facts
 # whose source characters have an existing frozen role annotation.
 precision=[];role_errors=[];assignment=collections.defaultdict(list)
 for target in targets:
  for cid in bymatch[target['reviewId']]['caseIds']:
   assignment[cid].append(target['reviewId']);c=bycase[cid]
   expected=[(role,x) for role,vs in target['fields'].items() for x in vs]
   for role,vs in c['fields'].items():
    if role in ['models','versions','artifactReferences']:continue
    for v in vs:
     e=v['evidence'][0];otherroles={k for k,x in expected if coverage([x],e)==e['end']-e['start']}
     status='same-frozen-role' if role in otherroles else 'different-frozen-role' if otherroles else 'unscored-extra-source-text'
     row={'reviewId':target['reviewId'],'caseId':cid,'role':role,'quote':v['text'],'frozenRoles':sorted(otherroles),'result':status,'evidence':v['evidence']};precision.append(row)
     if status=='different-frozen-role':role_errors.append(row)
 shared=[{'caseId':c,'targetIds':ids,'status':'possible-independent-record-merge-needs-source-review'} for c,ids in assignment.items() if len(ids)>1]
 save(STAGE/'field-role-diagnostics.json',precision);save(STAGE/'role-errors.json',role_errors);save(STAGE/'boundary-sharing.json',shared)
 # No inferred universal remedy: retained comparisons contain only cited
 # source statements. Missing model facts remain missing.
 groups=[]
 originals=json.loads((WORK/'agent-organized-combined-experiences.json').read_text(encoding='utf8'))
 for g in originals:
  ids=g['supportingReviewIds'];memberids=[cid for rid in ids for cid in bymatch[rid]['caseIds']]
  groups.append({'experienceId':g['experienceId'],'theme':g['theme'],'sourceRelation':g['relationshipInterpretation'],'supportingOriginalReviewIds':ids,'modelCaseIds':memberids,'members':[bycase[cid] for cid in memberids],
   'sourceReferences':g['sourceReferences'],'inferredDecisionRules':[],'uniqueCause':None,'uniqueRemedy':None,'status':'candidate-comparison-not-accepted-diagnostic-knowledge'})
 save(STAGE/'combined-experiences.json',groups)
 proof=verify_sources();usage=resources()
 qualification={'result':'NOT-PASSED-for-unattended-bulk-extraction','reason':['remaining semantic role confusion','cross-section case fragmentation/omissions','scope and version claims not independently verified','benchmark short-quote ambiguity requires review','local vision reading is not independent engineering proof'],
  'fixed25':{'legacy':legacy['fixed25'],'bonsai':metrics['fixed25'],'goldFieldSpans':136},'blind12':{'legacy':legacy['blind12'],'bonsai':metrics['blind12'],'goldFieldSpans':71,'ambiguousOriginalAnnotation':load('benchmark-ambiguities.json')},
  'rolePrecisionOnAnnotatedCharacters':dict(collections.Counter(r['result'] for r in precision)),'possibleMergedTargets':shared,'modelErrors':metrics['errorTypes'],'goldUnchanged':True,'humanEngineeringReview':False,'automaticPublication':False}
 save(STAGE/'qualification.json',qualification)
 qualification['inputProjectionLimitations']={'PPT':'frozen pilot reader inserted newlines at formatting runs; corrected candidate projection saved, holdout scores not rerun or promoted','CSV':'frozen windows contain raw row text without column labels; keyword tags must not be treated as observed results. Future window builder now labels original columns; frozen model tests unchanged.'}
 save(STAGE/'qualification.json',qualification)
 # Full raw field, evidence text and locator are included for independent review.
 source_rows=[]
 for c in cases:
  for role,vs in c['fields'].items():
   for v in vs:
    e=v['evidence'][0];u=units[e['evidenceId']];source_rows.append({'caseId':c['caseId'],'role':role,'quote':v['text'],'assertionType':v['assertionType'],'resourceId':c['resourceId'],'resourceVersionId':c['resourceVersionId'],'evidenceId':e['evidenceId'],'start':e['start'],'end':e['end'],'locator':json.dumps(u['locator'],ensure_ascii=False),'sourceText':u['text']})
 with (STAGE/'model-fields-and-source.csv').open('w',encoding='utf-8-sig',newline='') as f:
  wr=csv.DictWriter(f,fieldnames=list(source_rows[0]));wr.writeheader();wr.writerows(source_rows)
 lines=['<!doctype html><meta charset="utf-8"><title>Bonsai 27B工程经验提炼审查</title><style>body{font:16px/1.6 system-ui;margin:30px auto;max-width:1200px;padding:20px}pre{white-space:pre-wrap;background:#f4f6f9;padding:12px}article{border-top:2px solid #888;margin:28px 0}input{padding:12px;width:90%}</style><h1>Bonsai 27B：原文与新旧提炼对照</h1><p>未通过无人批量加工验收；程序测试成功不代表知识正确。固定25条、盲测12条，原始模型请求和响应全部保留。不能把字面支持当技术事实确认。</p><input id="q" placeholder="筛选记录、型号或故障"><pre>'+html.escape(json.dumps(qualification,ensure_ascii=False,indent=2))+'</pre>']
 oldrows=load('legacy-aligned-comparison.json');newrows=load('v3-comparison.json')
 for t in targets:
  rid=t['reviewId'];cs=[bycase[c] for c in bymatch[rid]['caseIds']];lines.append('<article><h2>'+rid+'</h2><h3>原文标注字段</h3><pre>'+html.escape(json.dumps(t['fields'],ensure_ascii=False,indent=2))+'</pre><h3>旧程序逐字段对照</h3><pre>'+html.escape(json.dumps([r for r in oldrows if r['reviewId']==rid],ensure_ascii=False,indent=2))+'</pre><h3>27B实际结构化输出</h3><pre>'+html.escape(json.dumps(cs,ensure_ascii=False,indent=2))+'</pre><h3>27B逐字段对照</h3><pre>'+html.escape(json.dumps([r for r in newrows if r['reviewId']==rid],ensure_ascii=False,indent=2))+'</pre><details><summary>完整原文窗口（不是输出自证）</summary>')
  used=set()
  for c in cs:
   w=next(w for w in load('frozen-inputs.json') if w['windowId']==c['windowId'])
   for u in w['units']:
    if u['evidenceId'] not in used:lines.append('<pre>'+html.escape(json.dumps(u,ensure_ascii=False,indent=2))+'</pre>');used.add(u['evidenceId'])
  lines.append('</details></article>')
 lines.append('<script>document.querySelector("#q").oninput=e=>document.querySelectorAll("article").forEach(a=>a.hidden=!a.textContent.toLowerCase().includes(e.target.value.toLowerCase()))</script>')
 (STAGE/'独立质量审查.html').write_text(''.join(lines),encoding='utf8')
 report=f'''# Bonsai 27B第三阶段实际验收

## 结论
未达到无人值守批量提炼质量要求。不切active，不发布517候选，不扩大1091份资料处理。未进行独立人工工程师或现场硬件验收。

## 实验与可复现证据
本机8080的既有bonsai，26,895,998,464参数，PTQ1_0三值量化，配置上下文131072，单槽顺序请求。未重新加载权重，不改变服务配置，仅控制单次请求温度0、seed42、关闭思考和JSON语法。初次短探测因思考耗尽额度而没有答案，如实记录。

先冻结25条第二阶段原文标注和12条盲测（6份其他来源、DOCX/CSV/PPTX结构）；以章节/相邻故障窗口提供上下文，不把gold字段传给模型，不一次输入整篇长文档。5个主案例试验后，通用字段定义和请求级JSON语法稳定下来。v1/v2失败全部保留，没有修补缺括号JSON。v3使用同一冻结输入和提示跑全部窗口，不依据盲测调整。

## 新旧对照
严格同证据、同角色、完整引用跨度覆盖。分拆成多个短引文可取覆盖并集，但不拼接不同模型案例来冒充完整理解。
```json
{json.dumps(qualification,ensure_ascii=False,indent=2)}
```
full-same-role是完整字段跨度覆盖；partial是部分覆盖；other-role是引用同原文但角色不同；missing是未提炼。它们不是硬件解决成功率，也不是全库准确率。
原固定基线仍45/136完整同角色、91未完整分离；原文件未改。盲测B08“正常”在原行出现不止一次，首次冻结标注的短引用有歧义，单列benchmark-ambiguities，不删除、不改成有利答案；该字段不可用来确定真实语义得分。
字段精度诊断只覆盖gold标注过的字符，额外有依据文字不自动算错；模型新增models/versions元数据不和原未标注字段强行比较。字面存在不等于角色正确，需看role-errors与逐条原文。

本轮PPT盲测还受到读取原型的格式问题影响：错误地在每个字体格式片段之间换行，原有第一阶段解析器本来按段落拼接。已对新原型通用读取修正，并单独生成正确段落投影对照；冻结输入、原模型输出及盲测分数不改、不重跑。CSV原始行缺列标签，模型可误把关键词当观察结果；新窗口构建已补源列标签，但未重刷本轮成绩。因此引用错误不能全归因于模型工程事实编造，也不能把已引用关键词视为真实现场观察。

## 明确仍存在的风险
3566S原句中的失败、更差、调整措施和成功结果仍可能被混在actions；527相反操作必须按记录隔离；VP620A+Y1的分阶段版本和无信号限制不能只留升级动作；K08最后回读正常卡参数跨段不能漏。非8倍数画布长记录被拆成不同小节时，不能以各节分别正确代替完整流程理解。标题、版本名及固件文件名不证明兼容性，VP630/VP830原文冲突继续待核。

## 图片
仅对D3中rId11关键图片进行本地视觉试读（详见limited-image-reading及calls/image-D3-rId11），不全盘OCR。原件内路径、锚点及图片SHA保留。视觉输出仍需独立核对，不回填gold、不影响正文新旧分数，也不提升成正式配置指导。

## 证据、安全与资源
原文回读{proof['rereadUnits']}单元，错误0；原件位置哈希、第一阶段资源DB、active和共享候选清单与基线相同。每个被接纳字段都有原始evidenceId、resourceId/versionId和原文字符范围，伪造/歧义引用列入拒绝，不静默纠正。
```json
{json.dumps(usage,ensure_ascii=False,indent=2)}
```
calls中是实际完整请求与响应，包括tokens、timings、GPU采样、失败。无付费API，无外部上传。Agent消耗不暴露，不估计；GPU是五秒采样的设备总使用量，不称为本原型独占峰值。

## 文件关系
frozen-*：实验前证据、标注与提示，manifest核验未变。legacy-aligned-*：旧程序对照；v3-*：最终模型候选、拒绝与字段对照；pilot-v1/v2保留失败；combined-experiences：3组仅检索对照，不是唯一根因；model-fields-and-source.csv：每字段原文和定位；独立质量审查.html：37条对照入口。完整内部成果与review-redacted分离，脱敏包不含完整原件、图片像素、资源DB或可调用密钥。

下一步应先改善长案例边界与语义角色的可靠性，并补足独立语义复核；不继续扩大资料数量或为型号编写特例。等待验收。
'''
 (STAGE/'实际验收报告.md').write_text(report,encoding='utf8');print(json.dumps({'qualification':qualification,'resources':usage},ensure_ascii=False))
 return qualification

def package():
 docs=load('source-evidence.json');windows=load('frozen-inputs.json');gold=load('frozen-gold-stage2.json');kept_legacy_ids={cid for r in gold for cid in r['overlappingAutomaticCandidates']}
 legacy=[c for c in load('legacy-aligned-cases.json') if c['caseId'] in kept_legacy_ids or c['windowId'].startswith('H')]
 required=set()
 for w in windows:
  required.update(u['evidenceId'] for u in w['units'])
  d=next(d for d in docs if d['documentId']==w['documentId']);required.update(d['units'][h['n']]['evidenceId'] for h in w['outline'])
 for r in gold:required.update(r['completeSupportEvidenceIds']+r['contextEvidenceIds'])
 for c in legacy:
  d=next(d for d in docs if d['documentId']==c['documentId']);required.update(u['evidenceId'] for u in d['units'][c['span'][0]:c['span'][1]+1])
 def subset(name,data):
  if name=='legacy-aligned-cases.json':return legacy
  if name=='source-evidence.json':return [{**d,'units':[u for u in d['units'] if u['evidenceId'] in required],'exportScope':'complete experiment windows plus gold and compared legacy record context; original ordinals retained; full internal source unchanged'} for d in data]
  return data
 readme='''# Bonsai 27B第三阶段：独立脱敏审查

先看实际验收报告.md、独立质量审查.html、qualification.json。当前未通过无人批量加工验收。

- frozen-gold-stage2.json保留原25条标注；frozen-blind-gold.json为模型运行前冻结的12条盲测，原文及错误不改。
- frozen-inputs.json是每次给模型的完整原文窗口；source-evidence.json保留所有实验窗口、gold及对照旧记录的必要原文，原始ordinal不改；未附无关全文。完整内部原文未改。frozen-model-prompt.json为最终固定提示和语法。
- calls/包含实际请求/原始响应、Token、时间、GPU采样。v1/v2失败与最终v3同时保存；图片请求的像素载荷在脱敏副本中以哈希替换。
- legacy-aligned-*与v3-*为新旧逐字段对照；原文位置、角色、缺失和错误全部保留。B08短引用基准歧义单列，不把它当可靠语义得分。
- combined-experiences.json只组织多案例证据，不输出唯一通用原因、兼容规则或正式指导。
- model-fields-and-source.csv逐字段保留原文证据；拒绝引用见v3-errors.json，角色诊断见role-errors.json。
- 原件、active、现网未改。人员/凭证/路径/来源链接及图片载荷脱敏；ID和原始定位保留，偏移指内部原文，脱敏字符串长度不作为偏移依据。
- 无模型自评分、无云API、无外部上传；统计属于固定证据对照，不是全库准确率或现场成功率。
'''
 return export(STAGE,'小灰机二代_第三阶段Bonsai27B_脱敏审查包.zip',readme,extra_redactions=('蓝琴辉',),transform_json=subset)

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--package',action='store_true');a=p.parse_args();package() if a.package else finish()
