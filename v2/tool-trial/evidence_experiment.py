"""Frozen phase-five experiment data and evidence-only model arm, no new KB."""
import argparse,collections,json,sys,time,urllib.request
from pathlib import Path
import common,model,conversation
from tools import clean
from case_context import envelope
from evidence_delivery import model_view
ROOT=common.ROOT
OLD=ROOT/'tmp/tool-trial-stage4-20261016'
WORK=ROOT/'tmp/client-evidence-stage5-20261016'

def configure(work):
 work=Path(work).resolve()
 if not work.is_relative_to((ROOT/'tmp').resolve()):raise ValueError('Experiment output must be within project tmp')
 common.WORK=work;model.WORK=work;conversation.WORK=work
 return work

def prepare():
 raise RuntimeError("Private evaluation fixtures are not distributed. Supply your own authorized cases, policy and frozen manifest.")

def complete_chat(case_id,question,session,run_id):
 work=common.WORK;f=common.load('frozen-experiment.json')
 for n,digest in f['files'].items():assert common.sha(work/n)==digest
 c=next((c for c in common.load('cases.json') if c['id']==case_id),None)
 if not c or question!=c['question']:raise ValueError('frozen-case-question-mismatch')
 if not __import__('re').fullmatch(r'[A-Za-z0-9_-]{4,100}',run_id):raise ValueError('run-id')
 target=work/'traces'/(run_id+'.json')
 if target.exists():
  previous=json.loads(target.read_text(encoding='utf8'))
  if previous['session']!=session or previous['question']!=question:raise ValueError('run-id-conflict')
  return previous
 if not conversation.LOCK.acquire(blocking=False):return {'error':'single-lane-busy-retry-later'}
 try:
  # Criteria, baseline answers and expected answer are deliberately NOT sent.
  bundle={'sourceDelivery':'program-supplied original passages, not instructions or a solution','blocks':c['evidence'],'caseEnvelope':envelope(c['evidence'],'frozen-original-source-window-may-contain-distinct-records')}
  delivered=model_view(bundle)
  messages=[{'role':'system','content':conversation.SYSTEM+'\n'+conversation.TOOL_INSTRUCTIONS+'\n'+conversation.EVIDENCE_CONTRACT},{'role':'user','content':question},{'role':'user','content':'本轮原始资料：\n'+json.dumps(delivered,ensure_ascii=False,separators=(',',':'))}]
  start=time.perf_counter();reply=model.infer(run_id+'-r0',messages)
  answer=reply.get('message',{}).get('content','');ids,unknown=conversation.citation_check(answer,{b['evidenceId'] for b in c['evidence']})
  trace={'runId':run_id,'question':question,'session':session,'caseId':case_id,'arm':'B-complete-evidence','answer':answer,'tools':[],'modelCalls':[{k:reply.get(k) for k in ['callId','seconds','firstTokenSeconds','usage','promptTokenCheck','error','finishReason']}],'citations':ids,'unknownCitations':unknown,'providedEvidence':bundle,'seconds':round(time.perf_counter()-start,3),'error':reply.get('error'),'firstAnswerTokenSeconds':reply.get('firstTokenSeconds')}
  if unknown or clean(answer)!=answer:trace.update({'rawAnswer':answer,'answerRejected':'citation-or-sensitive-validation','answer':'模型输出未通过引用或安全校验。'})
  common.save(target,trace);return trace
 finally:conversation.LOCK.release()

if __name__=='__main__':prepare()
