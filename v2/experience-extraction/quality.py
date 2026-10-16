"""Read-only original evidence audit; source annotation is not hardware acceptance."""
import collections,csv,html,io,json,time,zipfile
from xml.etree import ElementTree as ET
from source import WORK,ROOT,NS,W,sha,text,decode,save

def load(name):return json.loads((WORK/name).read_text(encoding='utf8'))

def verify_originals(docs):
 rows=[]
 for d in docs:
  for loc in d['locations']:
   actual=sha(loc['path']);assert actual==d['sha256'];rows.append({'documentId':d['documentId'],'path':loc['path'],'sha256':actual,'status':'same-content'})
  p=d['locations'][0]['path']
  if d['name'].endswith('.csv'):
   with open(p,'rb') as f:raw=list(csv.reader(io.StringIO(decode(f.read()))))
   reader=lambda u:' | '.join(raw[u['locator']['row']-1])
  else:
   with zipfile.ZipFile(p) as z:root=ET.fromstring(z.read('word/document.xml'))
   def reader(u):
    n=root.find(u['locator']['xpath'],NS);assert n is not None
    if n.tag=='{'+W+'}tr':
     cells=[text(c) for c in n.findall('w:tc',NS)];return ' | '.join(cells) if any(cells) else ''
    return text(n)
  for u in d['units']:assert reader(u)==u['text'],u['evidenceId']
 return rows

def audit():
 started=time.perf_counter();docs=load('source-evidence.json');originals=verify_originals(docs)
 units={u['evidenceId']:u for d in docs for u in d['units']};auto=load('independent-record-candidates.json');review=load('agent-reviewed-records.json');groups=load('agent-organized-combined-experiences.json')
 comparisons=[];fieldrows=[];readback=0
 mapping={'conditions':'conditions','outcome':'sourceOutcomeClaims','failedAttempts':None,'sourceClaim':None,'artifactReferences':None}
 for r in review:
  required={i for i in r['completeSupportEvidenceIds'] if units[i]['text'].strip()};overlap=[a for a in auto if a['caseId'] in r['overlappingAutomaticCandidates']]
  containers=[a for a in overlap if required.issubset(a['sourceUnitIds'])]
  boundary='complete-span-contained' if containers else 'split-or-incomplete'
  # Containment alone does not prove independent boundaries: check other reviewed records.
  foreign=[]
  for a in containers:
   for other in review:
    if other['reviewId']!=r['reviewId'] and other['documentId']==r['documentId'] and set(other['completeSupportEvidenceIds'])&set(a['sourceUnitIds']):foreign.append(other['reviewId'])
  if foreign:boundary='overmerged-reviewed-experiences'
  if r['reviewId']=='R14':
   # Source ordinal 1854 starts an independent P4 fault. It is retained in the
   # prototype's preceding JXI5020 span: a known failure, not a hidden pass.
   next_fault=docs[0]['units'][1854]['evidenceId']
   if any(next_fault in a['sourceUnitIds'] for a in containers):boundary='overmerged-next-source-fault'
  expected=[]
  for role,values in r['fields'].items():
   for val in values:
    for ref in val['evidence']:
     u=units[ref['evidenceId']];assert u['text'][ref['start']:ref['end']]==val['text'];readback+=1
     assert ref['evidenceId'] in r['completeSupportEvidenceIds']+r['contextEvidenceIds']
     key=mapping.get(role,role)
     candidates=[]
     for a in overlap:
      items=a['scope']['conditionStatements'] if key=='conditions' else a.get(key,[]) if key else []
      candidates.extend(items)
     correct=any(any(x.get('evidenceId')==ref['evidenceId'] and x.get('start',0)<=ref['start'] and x.get('end',0)>=ref['end'] for x in v.get('evidence',[])) for v in candidates)
     result='same-role-span-present' if correct else 'missing-or-role-not-separated'
     expected.append({'field':role,'evidenceId':ref['evidenceId'],'result':result})
     fieldrows.append({'reviewId':r['reviewId'],'field':role,'text':val['text'],'resourceId':r['resourceId'],'resourceVersionId':r['resourceVersionId'],'evidenceId':ref['evidenceId'],'locator':json.dumps(u['locator'],ensure_ascii=False),'sourceText':u['text'],'start':ref['start'],'end':ref['end'],'automaticComparison':result,'reviewNote':r['quality']['note']})
  comparisons.append({'reviewId':r['reviewId'],'boundary':boundary,'overmergedReviewIds':sorted(set(foreign)),'automaticCaseIds':[a['caseId'] for a in overlap],'fields':expected,'sourceReview':r['quality']})
 for g in groups:
  assert len(set(g['supportingCaseIds']))>=2
  assert set(g['supportingCaseIds']).issubset({r['caseId'] for r in review})
  assert not g['inferredDecisionRules'] and g['uniqueCorrectCause'] is None
 structure=load('document-structure.json');coverage=[]
 for d,s in zip(docs,structure):
  assigned={i for a in auto if a['documentId']==d['documentId'] for i in a['sourceUnitIds']}
  outline={h['unit'] for h in s['outline']};unassigned=set(s['unassignedEvidenceIds']);all_ids={u['evidenceId'] for u in d['units']}
  missing=all_ids-assigned-outline-unassigned
  # CSV header is metadata, not a candidate case.
  if d['name'].endswith('.csv'):missing.discard(d['units'][0]['evidenceId'])
  assert not missing,(d['documentId'],missing)
  coverage.append({'documentId':d['documentId'],'units':len(all_ids),'candidateRecords':sum(a['documentId']==d['documentId'] for a in auto),'assignedUnits':len(assigned),'outlineUnits':len(outline),'unassignedUnits':len(unassigned),'untrackedUnits':len(missing),'imageReferences':len(d['images']),'tables':len(d['tables'])})
 facts={'method':'fixed-purpose Agent-authored literal source annotations compared against deterministic prototype; not random, not independent human acceptance',
  'reviewedSourceRecords':len(review),'distinctExperienceReferences':len(review)-2,'duplicatePairs':2,'reviewedComparativeGroups':len(groups),
  'sourceReviewOutcomes':dict(collections.Counter(r['quality']['outcome'] for r in review)),
  'automaticBoundaryComparison':dict(collections.Counter(r['boundary'] for r in comparisons)),
  'boundaryMetricCaveat':'containment only; reviewed adjacent P4 boundary fails at R14; other unannotated neighbours may still be merged',
  'automaticFieldComparison':dict(collections.Counter(x['result'] for r in comparisons for x in r['fields'])),
  'originalEvidenceUnitsReread':len(units),'literalFieldSpansReread':readback,'originalLocationsHashed':len(originals),'readbackErrors':0,
  'coverage':coverage,'seconds':round(time.perf_counter()-started,3),'humanEngineeringAcceptance':'not-performed','readyForUnsupervisedBulkExtraction':False,
  'limitations':['literal matching proves source positioning, not engineering truth','comparison set is purposive, not a population accuracy estimate','pictures and attachments not semantically read','unreviewed provisional records are not verified cases','no hardware field tests','source wording can be uncertain or conflicting']}
 save(WORK/'quality-metrics.json',facts);save(WORK/'automatic-vs-source-review.json',comparisons);save(WORK/'original-readback-checks.json',originals)
 with (WORK/'source-field-comparison.csv').open('w',encoding='utf-8-sig',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=list(fieldrows[0]));writer.writeheader();writer.writerows(fieldrows)
 # Future retrieval tool data, not installed in any customer-facing endpoint.
 sample=next(r for r in review if r['reviewId']=='R11');ids=sample['contextEvidenceIds']+sample['completeSupportEvidenceIds']
 save(WORK/'evidence-tool-response-example.json',{'schemaVersion':1,'status':'candidate-only','case':sample,'evidence':[units[i] for i in ids],'readMore':{'resourceId':sample['resourceId'],'resourceVersionId':sample['resourceVersionId'],'evidenceIds':ids},'guardrails':['do not infer latest firmware number','do not execute upgrade without applicability and image review','source report is not independent hardware verification']})
 return facts

def report(metrics):
 docs=load('source-evidence.json');review=load('agent-reviewed-records.json');units={u['evidenceId']:u for d in docs for u in d['units']}
 report_text=f'''# 四份工程资料提炼质量审查（候选）

## 结论
**不支持直接扩大无人复核批量加工。** 四份原件已完整读取正文和表格结构，但图片未读，不能称完整理解所有操作。517条只是自动分段候选，不是517条验收成功经验。
Agent逐条原文标注25条，去除2对重复来源后23条不同经验引用；19条字段组织可对照、4条须核实、2条证据不完整。不是人工工程师验收，也不是总体准确率。形成3组有多案例依据的对照经验，另8组仅词面聚类，不作为综合结论。

## 原件与结构
三份DOCX的styles定义为空；数字样式只作为候选层级，不能保证等同原Word大纲。正文、表格行及图像锚点全部留存。
- D1按芯片厂商/型号及故障组织，但有无样式编号新故障、父芯片与具体案例不一致、JX5020/JXI5020原文差异。不得全篇继承父标题条件。
- D2按处理器系列与通用问题组织；固件列表、失败尝试、原因和措施分散在不同段落。非8倍数画布跨五小节，保留先1464再1462及纵向-2的步骤前后依赖；不进入配单规则。
- D3按主板与芯片系列组织，同系列包含多条不同故障/能力说明。3566S两条PWM值不同；527全屏开关方向相反，不合并。
- D4保留全部原始行/单元格及193条问答候选。问答是人工来源，不自动视为现场解决成功；版本、日期和截图引用分别保留。

## 实测结果
```json
{json.dumps(metrics,ensure_ascii=False,indent=2)}
```

## 具体正确与失败
- R08保留检查、失败的换接口/恢复出厂、怀疑原因、底边/右边不同处理；不把怀疑写成确定根因。
- R11保留Y1中间版本顺序及不给信号前提，原文“最新”不猜具体版本。
- R12跨章节处理依赖在整段证据中保留。未将各小节独立当作不同现场。
- R13与R22为同一次K08经验的两种来源，不计作两次硬件复现；跨344/345段的回读正常卡参数动作分别引用。
- R18/R23原始软件及固件版本不同。标注初版错误借用了新版本，被原文精确断言阻断，失败原样保存在first-reviewed-annotation-failure.txt；修正为各自原文，不改源文件或验收预期。
- R20标题VP630而固件前缀VP830，原文真实冲突；保持待核实，不建立兼容关系。
- R07“需要设置成”后依赖图片；R15仅芯片/模组与图片，没有完整步骤/结果，均不补写。
- 自动原型仍存在故障边界拆分/合并及原因、操作、观察混合。详情automatic-vs-source-review.json列出所有失败，不隐藏。字面证据存在不等于语义字段正确。

## FAQ与两轨
保留D16特定模组DCLK限制、R732接口检查、DP3364S的版本条件、K08回读参数经验等。复合能力问答“不支持”须回查规格，不能扩展成每个接口都已核实。资料索取走资源目录。完整类型判定见faq-types.json，仅候选标签，不新建FAQ库。
独立经验保留原文边界和未知项；综合经验仅3组不同案例的条件/措施对照。原文条件链source-explicit-branches.json与Agent组织关联分离，无新增诊断规则。

## 图片、表格与资源
所有图片/截图引用和表格行位置见image-table-context-gaps.json及source-evidence.json。无图片OCR/视觉解读，文本中“如下图”不能当已读取。CSV截图文件名可检索到的仅登记位置，找不到的明确缺失。敏感凭证仅留内部原文；外发副本脱敏。
未连接可用本地模型：本轮本地模型调用0、模型输入/输出Token 0、云调用0；Agent消耗无计量接口，不估算。不是一次本地模型深度语义能力验收。运行时间见prototype-run.json和quality-metrics.json；未测GPU/峰值内存，不编造资源数据。

## 可回退与下一步
所有结果位于独立tmp候选目录，新原型仅v2/experience-extraction。没有写active、没有改一代或检索引擎，未部署/push。删除候选工作目录或回退本轮独立代码提交即可回退，不删除任何G盘原件。
先改进整篇结构边界和条件继承，再针对关键图片补读；逐条语义复核检查/原因/措施，继续保留对照失败。当前只适合有限的、带来源人工/Agent复核候选处理，不适合无人值守全库加工。
'''
 (WORK/'质量审查报告.md').write_text(report_text,encoding='utf8')
 body=['<!doctype html><meta charset="utf-8"><title>四份工程经验候选审查</title><style>body{font:16px/1.6 system-ui;max-width:1180px;margin:30px auto;padding:20px}pre{white-space:pre-wrap;background:#f5f6f8;padding:12px}article{border-top:2px solid #aaa;margin-top:28px}td,th{border:1px solid #ccc;padding:8px;vertical-align:top}table{border-collapse:collapse;width:100%}summary{cursor:pointer}input{padding:12px;width:90%}</style><h1>工程经验：原文—字段审查</h1><p>候选、非现场验收；25条原文标注，19可对照、4待核、2不足。图片未读。517条自动分段不视为成功案例。完整统计见质量审查报告。</p><input id="q" placeholder="筛选型号、故障、编号"><main>']
 for r in review:
  body.append('<article><h2>'+html.escape(r['reviewId']+' '+r['title'])+'</h2><p>'+html.escape(r['quality']['outcome']+'：'+r['quality']['note'])+'</p><table><tr><th>字段</th><th>原文字段内容</th><th>证据位置</th></tr>')
  for key,values in r['fields'].items():
   for v in values:body.append('<tr><td>'+html.escape(key)+'</td><td>'+html.escape(v['text'])+'</td><td>'+html.escape(json.dumps([units[x['evidenceId']]['locator'] for x in v['evidence']],ensure_ascii=False))+'</td></tr>')
  body.append('</table><details open><summary>完整跨段落依据（含上下文）</summary>')
  for i in r['contextEvidenceIds']+r['completeSupportEvidenceIds']:
   u=units[i];body.append('<pre>'+html.escape(str(u['ordinal'])+' '+i+' '+json.dumps(u['locator'],ensure_ascii=False)+'\n'+u['text'])+'</pre>')
  body.append('</details><p>解决状态：'+html.escape(r['resolutionStatus'])+'；图片引用未读：'+str(len(r['imageIds']))+'</p></article>')
 body.append('</main><script>document.querySelector("#q").oninput=e=>document.querySelectorAll("article").forEach(a=>a.hidden=!a.textContent.toLowerCase().includes(e.target.value.toLowerCase()))</script>')
 (WORK/'质量审查.html').write_text(''.join(body),encoding='utf8')

if __name__=='__main__':
 m=audit();report(m);print(json.dumps(m,ensure_ascii=False))
