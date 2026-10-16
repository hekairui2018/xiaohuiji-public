"""Read-only experimental audit/export. Never a runtime answer or model grader."""
import collections,html,json,math,re,sys,zipfile
from pathlib import Path
import common
from tools import Tools
from conversation import citation_check

WORK=common.ROOT/'tmp/case-evidence-stage6-20261016'
OLD=common.ROOT/'tmp/client-evidence-stage5-20261016'

def walk_blocks(value):
 if isinstance(value,dict):
  if value.get('evidenceId') and 'text' in value:yield value
  for v in value.values():yield from walk_blocks(v)
 elif isinstance(value,list):
  for v in value:yield from walk_blocks(v)

def percentile(values,p):return sorted(values)[max(0,math.ceil(len(values)*p)-1)] if values else None

def run():
 import evidence_experiment
 evidence_experiment.configure(WORK);t=Tools();db=common.engine.connect(common.INDEX,True)
 hashes={h[:16]:h for h in t.policy if not h.startswith('metadata:')}
 assert len(hashes)==sum(not h.startswith('metadata:') for h in t.policy),'ambiguous evidence hash prefix'
 results=[json.loads(p.read_text(encoding='utf8')) for p in sorted((WORK/'results').glob('*.json'))]
 assessments=json.loads((WORK/'agent-review.json').read_text(encoding='utf8')) if (WORK/'agent-review.json').exists() else {}
 source={};readbacks=[];answer_checks=[];rows=[]
 for r in results:
  for arm in ['A','B']:
   trace=r[arm]['localTrace'];blocks=list(walk_blocks(trace));allowed={b['evidenceId'] for b in blocks}
   allowed.update(trace.get('evidenceIds',[]));ids,unknown=citation_check(trace.get('rawAnswer',trace.get('answer','')),allowed)
   answer_checks.append({'id':r['id'],'arm':arm,'citations':ids,'unknown':unknown,'rejected':trace.get('answerRejected'),'semanticCorrectness':'Agent source review required; valid ID does not validate a claim'})
   for b in blocks:
    eid=b['evidenceId'];suffix=eid.split('-');row=db.execute('select * from blocks where hash=? and ordinal=?',(hashes[suffix[1]],int(suffix[2]))).fetchone()
    assert row is not None,eid
    projected=t.block(dict(row),b.get('offset',0),len(b['text']))
    ok=projected['text']==b['text'];assert ok,(r['id'],arm,eid)
    readbacks.append({'question':r['id'],'arm':arm,'evidenceId':eid,'blockId':row['id'],'locator':b['locator'],'exactProjectionMatch':ok})
    if 'resourceId' in b or eid not in source:source[eid]=b
   rows.append({'id':r['id'],'arm':arm,'question':r['question'],'split':r['split'],'answer':trace.get('answer'),
    'seconds':trace['seconds'],'tools':len(trace.get('tools',[])),'error':trace.get('error'),
    'assessment':assessments.get(r['id'],{}).get(arm,{'grade':'not-reviewed'})})
 frozen=json.loads((WORK/'frozen-experiment.json').read_text(encoding='utf8'))
 prior={n:common.sha(OLD/'results'/n)==sha for n,sha in frozen['stage6Baseline'].items()};assert all(prior.values())
 safety_before=json.loads((WORK/'safety-before.json').read_text(encoding='utf8'))
 safety={p:{'sha256':common.sha(common.ROOT/p),'unchanged':common.sha(common.ROOT/p)==sha} for p,sha in safety_before.items()};assert all(v['unchanged'] for v in safety.values())
 calls=[json.loads(p.read_text(encoding='utf8')) for p in (WORK/'calls').glob('*.json')]
 stats={}
 for split in ['original12','blind4']:
  for arm in ['A','B']:
   selected=[r for r in rows if r['arm']==arm and ((r['split']=='stage6-blind')==(split=='blind4'))];times=[r['seconds'] for r in selected]
   stats[split+'-'+arm]={'n':len(selected),'grades':dict(collections.Counter(r['assessment']['grade'] for r in selected)),
    'averageSeconds':round(sum(times)/len(times),3) if times else None,'p95Seconds':percentile(times,.95),
    'issueCounts':dict(collections.Counter(issue for r in selected for issue in r['assessment'].get('issues',[])))}
 gpu=[]
 for c in calls:
  for s in c.get('gpuSamples',[]):
   for line in s['sample'].splitlines():
    try:gpu.append(int(line.split(',')[0]))
    except ValueError:pass
 metrics={'groups':stats,'actualModelCalls':len(calls),'inputTokens':sum((c.get('usage') or {}).get('prompt_tokens',0) for c in calls),'outputTokens':sum((c.get('usage') or {}).get('completion_tokens',0) for c in calls),'peakSampledGPUMiB':max(gpu,default=None),
  'modelFailures':[{'callId':c['callId'],'error':c['error']} for c in calls if c.get('error')],
  'notHardwareSuccessRate':True,'grading':'Agent reads frozen criteria and originals, not model self-grading or independent human approval','blindResultsNotUsedToTuneThisVersion':True}
 critical={'S05':['blk-381054d54486c41c-98','blk-381054d54486c41c-99'],'S07':['blk-381054d54486c41c-467','blk-381054d54486c41c-468','blk-381054d54486c41c-470'],'S08':['blk-0a1bcad01373fb54-245','blk-0a1bcad01373fb54-246','blk-0a1bcad01373fb54-247']}
 delivery=[]
 for cid,expected in critical.items():
  r=next((x for x in results if x['id']==cid),None)
  if not r:continue
  before=json.loads((OLD/'results'/(cid+'.json')).read_text(encoding='utf8'))
  for label,item in [('before',before),('after',r)]:
   blocks=list(walk_blocks(item['A']['localTrace']));present={b['evidenceId'] for b in blocks}
   delivery.append({'id':cid,'version':label,'expectedEvidenceIds':expected,'actuallyDelivered':[eid for eid in expected if eid in present],'notAnswerCorrectness':True})
 common.save(WORK/'critical-delivery-comparison.json',delivery)
 common.save(WORK/'paired-review.json',rows);common.save(WORK/'metrics.json',metrics);common.save(WORK/'source-evidence.json',[{'name':'Authorized source projections','units':list(source.values()),'header':[]}]);common.save(WORK/'evidence-readback.json',readbacks);common.save(WORK/'citation-audit.json',answer_checks);common.save(WORK/'safety-after.json',{'protectedData':safety,'stage5ResultsUnchanged':prior})
 page=['<!doctype html><meta charset="utf-8"><title>阶段6逐题原文审查</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:30px auto}pre{white-space:pre-wrap;background:#f4f5f6;padding:15px}</style><h1>第六阶段：保留全部回答与失败</h1>']
 for r in rows:
  page.append('<h2>'+html.escape(r['id']+' '+r['arm']+' '+r['question'])+'</h2><pre>'+html.escape(json.dumps(r,ensure_ascii=False,indent=2))+'</pre>')
 page.append('<h2>本次实际交付的原文证据</h2>')
 for eid,b in source.items():page.append('<h3>'+eid+'</h3><pre>'+html.escape(json.dumps(b,ensure_ascii=False,indent=2))+'</pre>')
 (WORK/'逐题回答与原文审查.html').write_text('\n'.join(page),encoding='utf8')
 print(json.dumps(metrics,ensure_ascii=False,indent=2));db.close()

if __name__=='__main__':run()
