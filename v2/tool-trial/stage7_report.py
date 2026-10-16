"""Local audit/report from frozen records and separate source-review annotations.

No grading by the answering model. Never publishes the private evidence folder.
"""
import argparse,collections,hashlib,html,json,math,statistics
from pathlib import Path
import common
from tools import Tools
from conversation import citation_check


def p95(values):return sorted(values)[max(0,math.ceil(len(values)*.95)-1)] if values else None
def blocks(value):
 if isinstance(value,dict):
  if value.get('evidenceId') and 'text' in value and 'blockId' in value:yield value
  for v in value.values():yield from blocks(v)
 elif isinstance(value,list):
  for v in value:yield from blocks(v)


def main():
 p=argparse.ArgumentParser();p.add_argument('--work',required=True);a=p.parse_args();w=Path(a.work).resolve()
 if not w.is_relative_to(common.ROOT/'tmp'):raise ValueError('isolated output required')
 common.WORK=w;t=Tools();fixed=json.loads((w/'fixed.json').read_text(encoding='utf8'))
 review=json.loads((w/'agent-review.json').read_text(encoding='utf8'))['records'];frozen=json.loads((w/'frozen.json').read_text(encoding='utf8'))
 assert all(common.sha(w/n)==sha for n,sha in frozen['files'].items())
 db=common.engine.connect(common.INDEX,True);readbacks={};rows=[];metrics={}
 for group,folder,arm in [('before-A','before','A'),('after-A','release-candidate','A'),('before-B','before','B'),('after-B','release-candidate','B'),('bare-C','before','C')]:
  selected=[]
  for c in fixed:
   tr=json.loads((w/folder/'results'/(c['id']+'-'+arm+'.json')).read_text(encoding='utf8'))
   result=tr.get('directResults',{});hits=[b.get('evidenceId') for b in result.get('results',[])]
   assessment={'grade':'correct' if hits and hits[0] in c['acceptableSourceIds'] else 'wrong','issues':[],'reason':'specified-source Top1, not natural-language answer correctness'} if arm=='A' else review[c['id']][group]
   row={'id':c['id'],'group':group,'question':tr.get('question'),'answer':tr.get('answer'),'assessment':assessment,'seconds':tr.get('seconds'),
    'answerCharacters':len(tr.get('answer','')),'tools':len(tr.get('tools',[])),'modelCalls':len(tr.get('modelCalls',[])),
    'inputTokens':sum((x.get('usage') or {}).get('prompt_tokens',0) for x in tr.get('modelCalls',[])),
    'outputTokens':sum((x.get('usage') or {}).get('completion_tokens',0) for x in tr.get('modelCalls',[])),
    'firstAnswerTokenSeconds':tr.get('firstAnswerTokenSeconds'),'unknownCitations':tr.get('unknownCitations',[])}
   rows.append(row);selected.append(row)
   for b in blocks(tr):
    key=(b['evidenceId'],b.get('offset',0),len(b['text']))
    if key in readbacks:continue
    raw=db.execute('select * from blocks where id=?',(b['blockId'],)).fetchone();assert raw is not None
    projected=t.block(dict(raw),b.get('offset',0),len(b['text']));assert projected['text']==b['text'],key
    assert projected['evidenceId']==b['evidenceId']
    readbacks[key]={'evidenceId':b['evidenceId'],'blockId':b['blockId'],'locator':b['locator'],'originalProjectionMatches':True,'text':b['text']}
  times=[r['seconds'] for r in selected]
  metrics[group]={'n':len(selected),'grades':dict(collections.Counter(r['assessment']['grade'] for r in selected)),
   'averageSeconds':round(statistics.mean(times),3),'p95Seconds':p95(times),
   'meanAnswerCharacters':round(statistics.mean(r['answerCharacters'] for r in selected),1),
   'mechanicalHeadingAnswers':sum('【原文明确写出】' in (r['answer'] or '') for r in selected),
   'modelCallRatio':sum(r['modelCalls']>0 for r in selected)/len(selected),'toolCalls':sum(r['tools'] for r in selected),
   'inputTokens':sum(r['inputTokens'] for r in selected),'outputTokens':sum(r['outputTokens'] for r in selected),
   'issues':dict(collections.Counter(i for r in selected for i in r['assessment']['issues']))}
 safety={p:{'unchanged':common.sha(common.ROOT/p)==sha,'sha256':common.sha(common.ROOT/p)} for p,sha in frozen['sourceSafety'].items()};assert all(r['unchanged'] for r in safety.values())
 calls=[]
 for d in ['before','after','after-v2','final','release-candidate']:
  calls.extend(json.loads(p.read_text(encoding='utf8')) for p in (w/d/'calls').glob('*.json'))
 gpu=[]
 for c in calls:
  for sample in c.get('gpuSamples',[]):
   for line in sample['sample'].splitlines():
    try:gpu.append(int(line.split(',')[0]))
    except ValueError:pass
 summary={'fixed':metrics,'improvedToCorrect':['F04','F08'],'regressedFromCorrect':['F01','F02','F03'],
  'blind':{'n':0,'status':'not-run-fixed-set-regressions; no defensible stage pass threshold; no surrogate blind score'},
  'actualCallsAllRetainedRounds':len(calls),'allRoundsInputTokens':sum((c.get('usage') or {}).get('prompt_tokens',0) for c in calls),
  'allRoundsOutputTokens':sum((c.get('usage') or {}).get('completion_tokens',0) for c in calls),
  'sampledPeakGPUMiB':max(gpu,default=None),'modelTransportFailures':[{'callId':c['callId'],'error':c['error']} for c in calls if c.get('error')],
  'evidenceReadbackCount':len(readbacks),'stagePassed':False,'allowNextStage':False,
  'grading':'Agent source review, not independent human engineering acceptance; A measures source retrieval only',
  'limitations':frozen['limitations'],'recordContributorCorrection':json.loads((w/'provenance-corrections.json').read_text(encoding='utf8'))['correctedDistinctContributors']}
 common.save(w/'metrics.json',summary);common.save(w/'per-question-review.json',rows);common.save(w/'evidence-readback.json',list(readbacks.values()));common.save(w/'safety-after.json',safety)
 common.save(w/'learning-candidates.json',[{'id':c['id'],'split':'development-regression-only','question':c['originalQuestion'],'questionOrigin':c['questionOrigin'],'correctEvidence':c['expectedEvidence'],'originalBaseline':next(r for r in rows if r['id']==c['id'] and r['group']=='before-B'),'latestCandidate':next(r for r in rows if r['id']==c['id'] and r['group']=='after-B'),'acceptedAnswer':next(r['answer'] for r in rows if r['id']==c['id'] and r['group']=='after-B') if review[c['id']]['after-B']['grade']=='correct' else None,'notTrained':True,'notWrittenIntoKnowledge':True} for c in fixed])
 parts=['<!doctype html><meta charset="utf-8"><title>阶段7原文与问答核查</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:25px auto}pre{white-space:pre-wrap;background:#f4f5f7;padding:15px}</style><h1>阶段7：未通过，不自动扩大</h1><p>所有评分为Agent原文复核，不是模型自评分或独立工程验收。A为指定来源检索，不等同自动回答。</p>']
 for c in fixed:
  parts.append('<h2>'+html.escape(c['id'])+'</h2><pre>'+html.escape(json.dumps(c,ensure_ascii=False,indent=2))+'</pre>')
  for r in rows:
   if r['id']==c['id']:parts.append('<h3>'+r['group']+'</h3><pre>'+html.escape(json.dumps(r,ensure_ascii=False,indent=2))+'</pre>')
 (w/'原文与问答质量审查.html').write_text(''.join(parts),encoding='utf8');print(json.dumps(summary,ensure_ascii=False))

if __name__=='__main__':main()
