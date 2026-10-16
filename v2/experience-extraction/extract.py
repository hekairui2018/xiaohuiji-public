"""Bounded offline prototype. Keep whole record spans and unknowns, not FAQ answers."""
import collections,hashlib,json,re,time
from pathlib import Path
from source import ROOT,WORK,save

LABELS=re.compile(r'(问题现象|问题描述|问题情况|现场情况|现场信息|模组信息|芯片信息|问题原因|原因分析|排查结论|原因|解决方案|解决方法|解决办法|解决方式|解决问题方法|调试方法|调试思路|处理问题思路|问题排查思路|排查动作|排查步骤|排查|分析方法|检查步骤|调试的方向点|结论及解决方案|结论|备注|注意|注)\s*[:：]')
ROLES={'问题现象':'phenomenon','问题描述':'phenomenon','问题情况':'phenomenon','现场情况':'conditions','现场信息':'conditions','模组信息':'conditions','芯片信息':'conditions','问题原因':'causes','原因分析':'causes','排查结论':'causes','原因':'causes','解决方案':'actions','解决方法':'actions','解决办法':'actions','解决方式':'actions','解决问题方法':'actions','调试方法':'actions','调试思路':'actions','处理问题思路':'checks','问题排查思路':'checks','排查动作':'checks','排查步骤':'checks','排查':'checks','分析方法':'checks','检查步骤':'checks','调试的方向点':'actions','结论及解决方案':'mixed','结论':'causes','备注':'warnings','注意':'warnings','注':'warnings'}
FAULT=re.compile(r'故障|异常|不亮|黑屏|花屏|闪屏|闪烁|闪点|偏色|偏暗|色块|鬼影|不识别|识别不到|找不到|不正常|失败|无法|无反应|没反应|卡死|暗线|竖线|横线|横条|耦合|水波纹|油画|重影|显示不全|过曝|卡顿|误码|不一致')
ACTION=re.compile(r'升级|降级|线刷|刷入|修改|更换|调整|调节|设置|重启|复位|关闭|开启|打开|降低|提高|导入|发送|安装|拔掉|拔出|断电|接入|替换|选择|勾选|取消|返厂|返卡|删除')
CHECK=re.compile(r'检查|核对|确认|查看|检测|排查|回读|交叉验证|测试|探测')
CAUSE=re.compile(r'原因|由于|因为|导致|怀疑|疑似|初步判断|可能|说明为|最终发现|发现.*不对')
OUTCOME=re.compile(r'问题消失|故障消失|恢复正常|显示正常|升级成功|发送成功|黑边消失|色块消除|解决了这个问题|不再出现|不在出现|现象正常|画面正常|显示正常了')
MISSING=['independent-hardware-validation','conditions-not-stated-are-not-universal']

def known_models():
 folder=ROOT/'v2/data/knowledge-next';m=json.loads((folder/'candidate-manifest.json').read_text(encoding='utf8'));raw=json.loads((folder/m['versionId']/'index.json').read_text(encoding='utf8'))
 return {re.sub(r'^HD-','',p['modelId']) for p in raw['products'] if p.get('modelId')}
KNOWN=known_models()
def models(text):
 # Whole identifier only: no model-prefix expansion or suffix folding.
 values=re.findall(r'(?<![A-Za-z0-9])(?:HD[-_ ]?)?([A-Za-z]{1,6}\d+[A-Za-z0-9]*(?:-[A-Za-z0-9]+)*|\d+[A-Za-z][A-Za-z0-9]*)(?![A-Za-z0-9])',text)
 return sorted({v.upper() for v in values if v.upper() in KNOWN})
def ref(u,start=0,end=None,role='literal'):
 return {'evidenceId':u['evidenceId'],'start':start,'end':len(u['text']) if end is None else end,'provenance':'explicit-source-text','role':role}
def item(u,start,end,role,**extra):return {'text':u['text'][start:end],'evidence':[ref(u,start,end,role)],**extra}
def has_action(units):return any(LABELS.search(u['text']) and any(m[1] in {'解决方案','解决方法','解决办法','调试方法'} for m in LABELS.finditer(u['text'])) for u in units)

def boundary(doc):
 """Structural candidates with explicit coverage ledger; never a paragraph=case rule."""
 records=[];structure=[];context=[];current=None;unassigned=[]
 def flush():
  nonlocal current
  if current and any(u['text'].strip() for u in current['units']):records.append(current)
  current=None
 def start(u,reason):
  nonlocal current
  flush();current={'title':u['text'],'context':list(context),'units':[u],'boundaryBasis':reason,'boundaryStatus':'candidate-needs-review'}
 if doc['name'].endswith('.csv'):
  for u in doc['units'][1:]:
   cells=u['cells']
   if len(cells)>2 and (cells[1].strip() or cells[2].strip()):records.append({'title':cells[1],'context':[],'units':[u],'boundaryBasis':'original-csv-record-row','boundaryStatus':'source-record-boundary'})
   else:unassigned.append(u['evidenceId'])
  return records,structure,unassigned
 for u in doc['units']:
  t=u['text'].strip();level=u.get('headingLevelCandidate')
  chapter=bool(re.match(r'^第[一二三四五六七八九十百\d]+章',t))
  field=bool(re.match(r'^(?:\d+[、.． ]*)?(?:模组信息|问题现象|问题描述|现场信息|解决方案|解决方法|解决办法|调试方法|原因|注)[:：]',t))
  pure_model=bool(re.fullmatch(r'(?:HD[- ]?)?[A-Za-z]*\d+[A-Za-z0-9]*(?:系列)?(?:\([^)]*\))?',t))
  generic=bool(re.search(r'通用问题|系列$|^第[一二三四五六七八九十百\d]+章',t))
  deeper_detail=bool(current and level and current.get('headingDepth') and level>current['headingDepth'])
  if deeper_detail:current['units'].append(u);continue
  topic_heading=bool(t and level and not field and not pure_model and not generic and (FAULT.search(t) or re.search('问题|现象|调试|注意事项|操作方法|说明|线材|规则|兼容|限制|步骤|功能|拼接',t)))
  is_context=chapter or (t and level and not topic_heading and not field and len(t)<100)
  if is_context:
   flush();depth=1 if chapter else level
   context=[c for c in context if c['depth']<depth]
   context.append({'depth':depth,'text':t,'evidenceId':u['evidenceId'],'basis':'literal-chapter' if chapter else 'numeric-style-context-candidate'})
   structure.append({'unit':u['evidenceId'],'ordinal':u['ordinal'],'text':t,'role':'context','depth':depth,'hierarchyVerified':chapter})
   continue
  if topic_heading:
   start(u,'topic-heading-style-and-literal-text');current['headingDepth']=level;structure.append({'unit':u['evidenceId'],'ordinal':u['ordinal'],'text':t,'role':'record-topic','depth':level,'hierarchyVerified':False});continue
  problem_label=bool(re.match(r'^(?:\d+[、.． ]*)?(?:问题现象|问题描述|现场问题|现场信息|问题|现象)\s*[:：]',t)) or bool(re.fullmatch(r'问题\d+',t))
  if problem_label and (current is None or has_action(current['units'])):start(u,'explicit-problem-label-after-record-or-context');continue
  if current is None:
   if t and (FAULT.search(t) or CHECK.search(t) or ACTION.search(t)):start(u,'unheaded-technical-span-review-required')
   else:unassigned.append(u['evidenceId'])
  else:current['units'].append(u)
 flush();return records,structure,unassigned

def split_fragments(u):
 text=u['text'];labels=list(LABELS.finditer(text));result=[]
 if text.strip().rstrip('：:') in ROLES:return [(ROLES[text.strip().rstrip('：:')],len(text),len(text))]
 if not labels:return [(None,0,len(text))] if text.strip() else []
 if labels[0].start():result.append((None,0,labels[0].start()))
 for i,m in enumerate(labels):
  end=labels[i+1].start() if i+1<len(labels) else len(text)
  result.append((ROLES[m[1]],m.end(),end))
 return result

def classify_record(q,answer):
 corpus=q+' '+answer
 if re.search(r'(哪里|在哪|发.*给|提供|要一份).{0,15}(规格书|说明书|安装包|固件文件)',q):return 'resource-request'
 if FAULT.search(corpus):return 'fault-experience-candidate'
 if re.search(r'最大|多少|区别|支持|不支持|带载|限制',q):return 'parameter-or-capability-candidate'
 if ACTION.search(answer) or re.search('怎么|如何|操作',q):return 'operation-knowledge-candidate'
 return 'engineering-reference-needs-classification'

def extract_record(doc,record):
 units=record['units'];first=units[0];cid='exp-'+hashlib.sha256((doc['resourceId']+'|'+json.dumps(first['locator'],sort_keys=True)).encode()).hexdigest()[:24]
 result={'caseId':cid,'documentId':doc['documentId'],'resourceId':doc['resourceId'],'resourceVersionId':doc['resourceVersionId'],'title':record['title'],'recordKind':'engineering-reference-needs-classification','boundaryBasis':record['boundaryBasis'],'boundaryStatus':record['boundaryStatus'],'inheritedContext':record['context'],
   'scope':{'literalModelMentions':[],'inheritedModelMentions':[],'versionStatements':[],'conditionStatements':[],'familyLabels':[c['text'] for c in record['context']]},
   'phenomenon':[],'checks':[],'observations':[],'causes':[],'actions':[],'warnings':[],'sourceOutcomeClaims':[],'unclassifiedStatements':[],'mixedStatements':[],
   'sourceUnitIds':[u['evidenceId'] for u in units],'imageIds':[im for u in units for im in u.get('imageIds',[])],'resolutionStatus':'not-established','allowedUse':'retrieval-reference-only-not-executable-guidance','missingInformation':list(MISSING)}
 corpus='\n'.join(u['text'] for u in units);result['scope']['literalModelMentions']=models(corpus)
 result['scope']['inheritedModelMentions']=sorted({m for c in record['context'] for m in models(c['text'])})
 if not result['scope']['literalModelMentions'] and result['scope']['inheritedModelMentions']:result['scope']['modelScopeStatus']='inherited-literal-heading-needs-applicability-review'
 else:result['scope']['modelScopeStatus']='literal-mention-not-automatic-compatibility'
 if any(u.get('cells') for u in units) and doc['name'].endswith('.csv'):
  u=units[0];q=u['cells'][1];answer=u['cells'][2];result['recordKind']=classify_record(q,answer)
  qs=u['text'].find(q);result['phenomenon'].append(item(u,qs,qs+len(q),'original-question'))
  start=u['text'].find(answer,qs+len(q));segments=[]
  if start>=0:
   # Field boundaries are preserved before semantic decomposition.
   proxy={**u,'text':u['text'][start:start+len(answer)]}
   segments=[(role,a+start,b+start) for role,a,b in split_fragments(proxy)]
  work=[(u,role,a,b) for role,a,b in segments]
 else:
  result['recordKind']=classify_record(record['title'],corpus);work=[]
  for u in units:work.extend((u,role,a,b) for role,a,b in split_fragments(u))
 current_role=None
 for u,label,a,b in work:
  raw=u['text'][a:b]
  if label:current_role=label
  if not raw.strip():continue
  role=label or current_role
  statement=item(u,a,b,role or 'unclassified',modality='source-instruction-not-proven-executed')
  if re.search(r'\b(?:V\d|FPGA|MCU|TV|HDSet|HDset|MagicPlayer|magicplayer|LCDPlayer|lcdplayer|安卓\d)',raw):result['scope']['versionStatements'].append(statement)
  # Keep all conditions in the record, including qualifiers inside action paragraphs.
  if role=='conditions' or re.search('如果|若|前提|仅|只有|需要先|首先|适用|当.*时|不能|不支持|版本|扫描|芯片|模组|接口',raw):result['scope']['conditionStatements'].append(statement)
  has_cause=bool(CAUSE.search(raw));has_action=bool(ACTION.search(raw));has_check=bool(CHECK.search(raw))
  if has_cause and has_action:
   result['mixedStatements'].append({**statement,'reason':'cause-and-action-share-span-semantics-not-yet-split'});continue
  if role=='phenomenon':result['phenomenon'].append(statement)
  elif role=='conditions':pass
  elif role=='warnings':result['warnings'].append(statement)
  elif role=='causes' or has_cause:
   result['causes'].append({**statement,'epistemicStatus':'tentative-source-judgment' if re.search('怀疑|疑似|可能|初步|应该|暂时|未知',raw) else 'engineer-stated-judgment-not-independent-proof'})
  elif has_check or role=='checks':result['checks'].append(statement)
  elif has_action and role in {'actions','mixed'}:result['actions'].append(statement)
  else:result['unclassifiedStatements'].append(statement)
  if OUTCOME.search(raw):result['sourceOutcomeClaims'].append({**statement,'status':'requires-tense-and-scope-review-not-confirmed-success'})
  if re.search('无效|无用|无反应|现象不变|没有改善|未能|更严重|不能解决',raw):result['observations'].append({**statement,'observationKind':'failed-attempt-or-negative-statement-needs-context'})
 if not result['phenomenon']:
  result['phenomenon']=[item(first,0,len(first['text']),'topic-not-full-phenomenon')];result['missingInformation'].append('phenomenon-needs-boundary-review')
 risks=sorted({word for word,pattern in [('firmware-change',r'升级|降级|固件|线刷'),('hardware-change',r'拆|焊|剪|硬件|更换电池|改电阻'),('configuration-change',r'寄存器|配置|复位|恢复出厂|屏参|时钟|频率'),('database-or-credential-operation',r'mysql|数据库|password|密码')] if re.search(pattern,corpus,re.I)})
 result['riskFlags']=risks
 if result['imageIds'] or re.search('如图|下图|图片|截图|图示|图中|如下页|上图',corpus):result['missingInformation'].append('image-or-attachment-context-not-read')
 if result['mixedStatements']:result['missingInformation'].append('mixed-cause-action-needs-semantic-review')
 result['reviewStatus']='needs-agent-review';return result

def relation_groups(records,evidence):
 duplicate=collections.defaultdict(list)
 for c in records:
  for field in ['actions','checks','causes']:
   for item in c[field]:
    key=re.sub(r'\s+','',item['text']).casefold()
    if len(key)>=20:duplicate[(field,key)].append({'caseId':c['caseId'],'documentId':c['documentId'],'evidence':item['evidence']})
 duplicates=[{'field':k[0],'literalText':k[1],'members':v,'relation':'same-literal-statement-not-merged-applicability'} for k,v in duplicate.items() if len({x['caseId'] for x in v})>1]
 themes=[('黑屏不亮',r'黑屏|不亮'),('闪屏闪烁',r'闪屏|闪烁'),('色块',r'色块'),('USB设备识别',r'找不到设备|识别不到设备|设备描述符'),('偏色',r'偏色|偏红|偏绿|颜色异常'),('鬼影',r'鬼影'),('参数和连接图',r'连接图|参数固化'),('U盘播放',r'U盘|优盘')]
 groups=[]
 for title,pattern in themes:
  members=[c for c in records if re.search(pattern,c['title']+' '+''.join(x['text'] for x in c['phenomenon']))]
  if len(members)<2:continue
  groups.append({'experienceId':'group-'+hashlib.sha256(title.encode()).hexdigest()[:16],'theme':title,'caseIds':[c['caseId'] for c in members],
   'relationType':'retrieval-theme-group-not-universal-solution','differentScopes':[{'caseId':c['caseId'],'scope':c['scope']} for c in members],
   'sourceCauses':[{'caseId':c['caseId'],'claim':x} for c in members for x in c['causes']],
   'sourceChecks':[{'caseId':c['caseId'],'claim':x} for c in members for x in c['checks']],
   'sourceActions':[{'caseId':c['caseId'],'claim':x,'prerequisites':'retain-full-case-scope-and-warnings'} for c in members for x in c['actions']],
   'explicitSourceBranches':[{'caseId':c['caseId'],'statement':x} for c in members for x in c['scope']['conditionStatements'] if re.search('如果|若|当.*时',x['text'])],
   'aiInferredBranches':[],'commonCause':None,'commonRemedy':None,'status':'needs-semantic-review-not-finished-synthesis','sourceEvidenceIds':sorted({eid for c in members for eid in c['sourceUnitIds']})})
 return duplicates,groups

def run():
 started=time.perf_counter();docs=json.loads((WORK/'source-evidence.json').read_text(encoding='utf8'));cases=[];structures=[]
 for doc in docs:
  raw,outline,unassigned=boundary(doc);items=[extract_record(doc,r) for r in raw];cases.extend(items)
  structures.append({'documentId':doc['documentId'],'name':doc['name'],'resourceId':doc['resourceId'],'resourceVersionId':doc['resourceVersionId'],'locations':doc['locations'],'sha256':doc['sha256'],'outline':outline,'candidateRecords':len(items),'unassignedEvidenceIds':unassigned,'styleDefinitionsPresent':doc.get('styleDefinitionsPresent'),'limitations':['numeric styles without definitions are candidate hierarchy','unread images may change case boundaries; no inferred screenshot steps']})
 evidence={u['evidenceId']:u for d in docs for u in d['units']};duplicates,groups=relation_groups(cases,evidence)
 save(WORK/'document-structure.json',structures);save(WORK/'independent-record-candidates.json',cases);save(WORK/'combined-experience-candidates.json',groups);save(WORK/'duplicate-and-conflict-links.json',{'duplicates':duplicates,'conflictPolicy':'Similar phenomena keep independent cases; no hardware rule is merged.','caseIdsPreserved':True})
 save(WORK/'faq-types.json',[{'caseId':c['caseId'],'kind':c['recordKind'],'sourceUnitIds':c['sourceUnitIds'],'status':'candidate-not-field-verified'} for c in cases if c['documentId']=='D4'])
 save(WORK/'image-table-context-gaps.json',[{'documentId':d['documentId'],'images':d['images'],'tables':d['tables'],'styleDefinitionsPresent':d.get('styleDefinitionsPresent'),'unassignedEvidenceIds':next(s['unassignedEvidenceIds'] for s in structures if s['documentId']==d['documentId'])} for d in docs])
 save(WORK/'prototype-run.json',{'seconds':round(time.perf_counter()-started,3),'localModelCalls':0,'localModelInputTokens':0,'localModelOutputTokens':0,'cloudCalls':0,'agentReviewTokens':'not-exposed-by-runtime-not-estimated','localModelAvailability':'11434 and1234 not connected','records':len(cases),'groups':len(groups),'duplicates':len(duplicates),'generation':'provisional source segmentation and evidence-labelled fields, not verified knowledge'})
 print(json.dumps({'records':len(cases),'byDocument':dict(collections.Counter(c['documentId'] for c in cases)),'groups':len(groups),'duplicates':len(duplicates),'mixed':sum(bool(c['mixedStatements']) for c in cases)},ensure_ascii=False))

if __name__=='__main__':run()
