"""External-to-model fixed annotation comparison. No model grades its own output."""
import collections,csv,html,json,re,time
from source import WORK,ROOT,save,sha
from bonsai import STAGE

ROLES={'phenomenon','conditions','checks','observations','causes','actions','failedAttempts','outcome','warnings','models','versions','sourceClaim','artifactReferences'}

def load(name):return json.loads((STAGE/name).read_text(encoding='utf8'))

def parse_response(receipt):
 if 'response' not in receipt:return None,'transport-error'
 content=receipt['response']['choices'][0]['message'].get('content','').strip()
 mode='json-body'
 if content.startswith('```json\n') and content.endswith('```'):content=content[8:-3].strip();mode='outer-json-fence-only'
 elif content.startswith('```\n') and content.endswith('```'):content=content[4:-3].strip();mode='outer-json-fence-only'
 try:
  result=json.loads(content)
  if not isinstance(result,dict) or not isinstance(result.get('cases'),list):return None,'schema-root-error'
  return result,mode
 except Exception:return None,'json-error'

def normalize(receipt,window,doc):
 parsed,mode=parse_response(receipt);cases=[];errors=[];allowed={u['n'] for u in window['units']}|{u['n'] for u in window['outline']}
 if parsed is None:return [],[{'type':mode,'callId':receipt['callId']}],mode
 for ci,c in enumerate(parsed['cases']):
  if not isinstance(c,dict):errors.append({'type':'case-schema','index':ci});continue
  result={'caseId':receipt['callId']+'-C'+str(ci+1),'callId':receipt['callId'],'windowId':window['windowId'],'documentId':doc['documentId'],'resourceId':doc['resourceId'],'resourceVersionId':doc['resourceVersionId'],
   'title':c.get('title'),'span':c.get('span'),'fields':{},'missing':c.get('missing',[]),'status':'candidate-only-not-executable','modelIdentity':'bonsai-27B-PTQ1_0','rejectedFacts':[],'reviewFlags':[]}
  span=c.get('span')
  if not isinstance(span,list) or len(span)!=2 or not all(type(n)==int for n in span) or not 0<=span[0]<=span[1]<len(doc['units']):errors.append({'type':'invalid-boundary','caseId':result['caseId']});result['reviewFlags'].append('invalid-boundary')
  for fi,f in enumerate(c.get('facts',[])):
   error=None
   if not isinstance(f,list) or len(f)!=4:error='fact-schema'
   else:
    role,n,q,certainty=f
    if role not in ROLES or type(n)!=int or not isinstance(q,str) or not q or certainty not in ['source','hypothesis']:error='fact-schema'
    elif n not in allowed:error='evidence-not-in-input'
    elif not 0<=n<len(doc['units']):error='evidence-id-invalid'
    else:
     u=doc['units'][n];positions=[m.start() for m in re.finditer(re.escape(q),u['text'])]
     if not positions:error='quote-not-in-original'
     elif len(positions)>1 and role not in ['models','versions']:error='ambiguous-quote-position'
     elif role not in ['models','versions'] and re.search(r'(?:不能|未能|没有|并非|不是|不|未|没|无)$',u['text'][:positions[0]]):error='truncated-source-negation'
   if error:
    entry={'type':error,'caseId':result['caseId'],'factIndex':fi,'rawFact':f};errors.append(entry);result['rejectedFacts'].append(entry);continue
   position=positions[0];v={'text':q,'evidence':[{'evidenceId':u['evidenceId'],'start':position,'end':position+len(q)}],'assertionType':'source-reported-hypothesis' if certainty=='hypothesis' else 'literal-source-record-not-independently-verified','sourceUnitOrdinal':n}
   result['fields'].setdefault(role,[]).append(v)
   if role=='causes' and re.search('怀疑|可能|应该|疑似',u['text']) and certainty!='hypothesis':result['reviewFlags'].append('hypothesis-qualifier-may-be-lost')
   if role=='actions' and re.search('无效|未能|更加严重|失败',q):result['reviewFlags'].append('failed-attempt-may-be-in-actions')
   if role=='outcome' and re.search('即可|可以|需要|成功后|后再',q):result['reviewFlags'].append('conditional-outcome-may-be-promoted')
  cases.append(result)
 return cases,errors,mode

def coverage(values,ref):
 intervals=[]
 for v in values:
  for x in v.get('evidence',[]):
   if x['evidenceId']==ref['evidenceId']:intervals.append((max(x['start'],ref['start']),min(x['end'],ref['end'])))
 intervals=sorted((a,b) for a,b in intervals if b>a);total=0;end=ref['start']
 for a,b in intervals:
  if b>end:total+=b-max(a,end);end=b
 return total

def matched_cases(target,cases,docs):
 did=target['documentId'];refs=[e for role,vs in target['fields'].items() for v in vs for e in v['evidence'] if role=='phenomenon']
 if not refs:refs=[e for role,vs in target['fields'].items() for v in vs for e in v['evidence'] if role=='conditions']
 def score(c):
  values=c['fields'].get('phenomenon',[])+c['fields'].get('conditions',[])
  return sum(coverage(values,e) for e in refs)
 candidates=[c for c in cases if c['documentId']==did and isinstance(c.get('span'),list) and len(c['span'])==2]
 # Each gold CSV row has its own window, preventing a duplicate answer in a
 # different date/version row from proving this row was extracted.
 if did=='D4':candidates=[c for c in candidates if c['windowId']=='W-'+target['reviewId']]
 if did.startswith('H'):
  source_start=target['sourceRange']['startOrdinal'];source_end=target['sourceRange']['endOrdinalExclusive']
  candidates=[c for c in candidates if c['span'][0]<source_end and c['span'][1]>=source_start]
 if not candidates:return []
 top=max(score(c) for c in candidates)
 if top<=0:
  allrefs=[e for vs in target['fields'].values() for v in vs for e in v['evidence']]
  def support_score(c):return sum(coverage([x for values in c['fields'].values() for x in values],e) for e in allrefs)
  supported=max(candidates,key=support_score)
  if support_score(supported)>0:return [{**supported,'alignmentMethod':'same-source-span-across-roles-no-field-repair'}]
  # A bad phenomenon quote may be rejected while the actual record still has
  # valid checks/actions. Align by original body range in that case; keep the
  # rejected quote as an error, rather than falsely saying every field vanished.
  start=target['sourceRange']['startOrdinal'];end=target['sourceRange']['endOrdinalExclusive']
  def overlap(c):return max(0,min(end,c['span'][1]+1)-max(start,c['span'][0]))
  best=max(candidates,key=overlap)
  return [{**best,'alignmentMethod':'source-range-fallback-no-quote-repair'}] if overlap(best)>0 else []
 # Model may have wrongly split a case. Only best single case is compared;
 # do not union unrelated model records to fabricate complete understanding.
 return [{**max(candidates,key=score),'alignmentMethod':'same-evidence-phenomenon-or-condition'}]

def compare(target,candidates,kind):
 result=[]
 for role,vs in target['fields'].items():
  for v in vs:
   for e in v['evidence']:
    wanted=e['end']-e['start'];matching=[x for c in candidates for x in c.get('fields',{}).get(role,[])];amount=coverage(matching,e)
    other=[(k,x) for c in candidates for k,values in c.get('fields',{}).items() for x in values if k!=role]
    wrong=[k for k,x in other if coverage([x],e)>0]
    status='full-same-role' if amount==wanted else 'partial-same-role' if amount else 'other-role' if wrong else 'missing'
    result.append({'reviewId':target['reviewId'],'set':kind,'role':role,'text':v['text'],'evidenceId':e['evidenceId'],'expectedStart':e['start'],'expectedEnd':e['end'],'coveredChars':amount,'expectedChars':wanted,'result':status,'otherRoles':sorted(set(wrong))})
 return result

def evaluate(revision=2):
 docs=load('source-evidence.json');bydoc={d['documentId']:d for d in docs};windows=load('frozen-inputs.json');cases=[];errors=[];protocol=[];receipts=[]
 for w in windows:
  name=(f'v{revision}-' if revision>=2 else '')+w['windowId'];p=STAGE/'calls'/(name+'.json')
  if not p.exists():continue
  receipt=json.loads(p.read_text(encoding='utf8'));cs,es,mode=normalize(receipt,w,bydoc[w['documentId']]);cases.extend(cs);errors.extend(es);receipts.append(receipt);protocol.append({'callId':name,'mode':mode,'cases':len(cs),'errors':len(es)})
 gold=load('frozen-gold-stage2.json');blind=load('frozen-blind-gold.json');comparisons=[];target_matches=[]
 for target in gold+blind:
  matches=matched_cases(target,cases,bydoc);kind='fixed25' if target['reviewId'].startswith('R') else 'blind12'
  rows=compare(target,matches,kind);comparisons.extend(rows);target_matches.append({'reviewId':target['reviewId'],'set':kind,'caseIds':[c['caseId'] for c in matches],'alignmentMethods':[c.get('alignmentMethod') for c in matches],'fieldResults':dict(collections.Counter(r['result'] for r in rows))})
 summary={kind:dict(collections.Counter(r['result'] for r in comparisons if r['set']==kind)) for kind in ['fixed25','blind12']}
 summary.update({'completedCalls':len(receipts),'expectedCalls':len(windows),'normalizedCases':len(cases),'rejectedFactsOrErrors':len(errors),'errorTypes':dict(collections.Counter(e['type'] for e in errors)),
  'fieldPrecision':'not-estimated: gold is not exhaustive; valid literal citation does not prove correct semantic role','promptTokens':sum(r.get('response',{}).get('usage',{}).get('prompt_tokens',0) for r in receipts),'completionTokens':sum(r.get('response',{}).get('usage',{}).get('completion_tokens',0) for r in receipts),'inferenceWallSeconds':round(sum(r['seconds'] for r in receipts),3),'cachedPromptTokens':sum(r.get('response',{}).get('usage',{}).get('prompt_tokens_details',{}).get('cached_tokens',0) for r in receipts),
  'reviewFlags':dict(collections.Counter(f for c in cases for f in c['reviewFlags'])),'publication':'candidate-only-no-active-write','qualification':'NOT-PASSED-until-independent-semantic-review-and-no-critical-errors'})
 prefix=f'v{revision}-' if revision>=2 else 'pilot-v1-'
 save(STAGE/(prefix+'cases.json'),cases);save(STAGE/(prefix+'errors.json'),errors);save(STAGE/(prefix+'protocol.json'),protocol);save(STAGE/(prefix+'target-matches.json'),target_matches);save(STAGE/(prefix+'comparison.json'),comparisons);save(STAGE/(prefix+'metrics.json'),summary)
 with (STAGE/(prefix+'comparison.csv')).open('w',encoding='utf-8-sig',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=list(comparisons[0]));writer.writeheader();writer.writerows(comparisons)
 return summary

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--revision',type=int,default=2);print(json.dumps(evaluate(p.parse_args().revision),ensure_ascii=False))
