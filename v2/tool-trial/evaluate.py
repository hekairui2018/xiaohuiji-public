"""Deterministic diagnostics, not model self-grading or an engineering success rate."""
import collections,json,math,statistics
from common import WORK,load,save

def stats(values):
 values=sorted(v for v in values if v is not None)
 return {'n':len(values),'mean':round(statistics.mean(values),3) if values else None,'p95':round(values[max(0,math.ceil(len(values)*.95)-1)],3) if values else None,'unit':'seconds; nearest-rank p95'}

def evidence(row):
 items=[]
 for t in row.get('tools',[]):items+=t.get('result',{}).get('results',[])+t.get('result',{}).get('blocks',[])
 return items

def check(q,items,answer=''):
 expectedids={r['blockId'] for r in q['expectedEvidence']};expectedresources={r['resourceId'] for r in q['expectedEvidence']}
 policy=load('access-policy.json')['resources'];expectedresources|={policy[k]['resourceId'] for k in q['expectedResourceKeys']}
 ids={r.get('blockId') for r in items};rids={r.get('resourceId') for r in items}
 return {'expectedSourceHit':bool(ids&expectedids) if expectedids else bool(rids&expectedresources) if expectedresources else None,
  'conceptGroupsSatisfied':all(any(s.casefold() in answer.casefold() for s in group) for group in q['requiredConceptGroups']),
  'literalForbiddenClaimPresent':[s for s in q['forbiddenClaims'] if s in answer],
  'clarificationLanguagePresent':any(s in answer for s in ['请提供','请确认','无法确认','不能确定','不足','具体型号','未查到','未找到','需要确认']),
  'interpretation':'literal diagnostics only; source hit is not answer correctness; manual evidence review required'}

def evaluate():
 records=[json.loads(p.read_text(encoding='utf8')) for p in sorted((WORK/'results').glob('*.json'))];rows=[]
 for r in records:
  q=r['question'];d=r['direct'];h=r['hybrid'];b=r['bare'];di=d['search']['results']+(d['context'] or {}).get('blocks',[]);hi=h.get('directResults',{}).get('results',[])+evidence(h)
  rows.append({'id':q['id'],'group':q['group'],'question':q['question'],'direct':check(q,di,'\n'.join(i.get('text','') for i in di)),
    'hybrid':check(q,hi,h.get('answer',''))|{'error':h.get('error'),'answerRejected':h.get('answerRejected'),'citations':h.get('citations',[]),'unknownCitations':h.get('unknownCitations',[])},
    'bare':check(q,[],b.get('answer',''))|{'error':b.get('error'),'answerRejected':b.get('answerRejected')}})
 timings={}
 for kind,predicate in [('files',lambda r:r['question']['group']=='files'),('complex',lambda r:r['question']['group']!='files')]:
  selected=[r for r in records if predicate(r)];timings[kind]={arm:stats([r[arm].get('seconds') for r in selected]) for arm in ['direct','hybrid','bare']}
  timings[kind]['hybridFirstAnswerToken']=stats([r['hybrid'].get('firstAnswerTokenSeconds') for r in selected]);timings[kind]['bareFirstAnswerToken']=stats([r['bare'].get('firstAnswerTokenSeconds') for r in selected])
 usage={}
 for arm in ['hybrid','bare']:
  calls=[c for r in records for c in r[arm].get('modelCalls',[])];usage[arm]={'modelCalls':len(calls),'promptTokens':sum((c.get('usage') or {}).get('prompt_tokens',0) for c in calls),'completionTokens':sum((c.get('usage') or {}).get('completion_tokens',0) for c in calls),'maxActualPromptTokens':max(((c.get('usage') or {}).get('prompt_tokens',0) for c in calls),default=0),'modelCallFailures':sum(bool(c.get('error')) for c in calls)}
 actual=[json.loads(p.read_text(encoding='utf8')) for p in (WORK/'calls').glob('*.json')];gpu=[]
 for c in actual:
  for sample in c.get('gpuSamples',[]):
   try:gpu.append(float(sample['sample'].split(',')[0]))
   except (KeyError,ValueError):pass
 summary={'completedQuestions':len(records),'groups':dict(collections.Counter(r['group'] for r in rows)),'timings':timings,'usage':usage,'gpuPeakSampledMiB':max(gpu,default=None),'gpuMeaning':'total device memory including existing model, sampled every 5 seconds','nativeToolCounts':dict(collections.Counter(t['name'] for r in records for t in r['hybrid'].get('tools',[]))),
  'hybridQuestionsWithTools':sum(bool(r['hybrid'].get('tools')) for r in records),'hybridQuestionsWithRepeatedToolCalls':sum(len(r['hybrid'].get('tools',[]))>=2 for r in records),'protocolFailures':[{'id':r['id'],'error':r['hybrid']['error'] or r['hybrid']['answerRejected']} for r in rows if r['hybrid']['error'] or r['hybrid']['answerRejected']],
  'directSourceHit':{'evaluated':sum(r['direct']['expectedSourceHit'] is not None for r in rows),'hits':sum(r['direct']['expectedSourceHit'] is True for r in rows)},'hybridSourceHit':{'evaluated':sum(r['hybrid']['expectedSourceHit'] is not None for r in rows),'hits':sum(r['hybrid']['expectedSourceHit'] is True for r in rows)},'notAnAnswerAccuracyEstimate':True,'scope':'files bypass AI in hybrid; complex questions use real native tools; raw model has no retrieval; model is not its own judge'}
 summary['toolArgumentValidationErrors']=[{'id':r['questionId'],'name':t['name'],'error':t['error']} for r in records for t in r['hybrid'].get('tools',[]) if t.get('error')]
 summary['toolArgumentValidationErrorCount']=len(summary['toolArgumentValidationErrors'])
 summary['generationLengthLimits']=[{'id':r['questionId'],'arm':a,'callId':c['callId']} for r in records for a in ['hybrid','bare'] for c in r[a].get('modelCalls',[]) if c.get('finishReason')=='length']
 summary['benchmarkTransportFailuresOnly']=True
 save(WORK/'automatic-diagnostics.json',rows);save(WORK/'performance-summary.json',summary);print(json.dumps(summary,ensure_ascii=False));return summary

if __name__=='__main__':evaluate()
