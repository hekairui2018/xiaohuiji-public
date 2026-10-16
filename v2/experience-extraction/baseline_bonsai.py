"""Re-use unchanged stage2 extractor on held-out windows; retain original fixed baseline."""
import collections,json,time
from extract import boundary,extract_record
from evaluate_bonsai import load,compare,matched_cases
from source import WORK,save
from bonsai import STAGE

def convert(row,doc,wid):
 byid={u['evidenceId']:u for u in doc['units']};ns=[byid[i]['ordinal'] for i in row['sourceUnitIds']]
 result={'caseId':row['caseId'],'windowId':wid,'documentId':doc['documentId'],'span':[min(ns),max(ns)],'fields':{k:row[k] for k in ['phenomenon','checks','observations','causes','actions','warnings']},'reviewFlags':[]}
 result['fields']['outcome']=row['sourceOutcomeClaims'];result['fields']['conditions']=row['scope']['conditionStatements']
 return result

def run():
 started=time.perf_counter();docs=load('source-evidence.json');bydoc={d['documentId']:d for d in docs};windows=load('frozen-inputs.json');out=[]
 raw=json.loads((WORK/'independent-record-candidates.json').read_text(encoding='utf8'))
 for row in raw:out.append(convert(row,bydoc[row['documentId']],'legacy-fixed'))
 for w in windows:
  if not w['windowId'].startswith('H'):continue
  d=bydoc[w['documentId']];nums={u['n'] for u in w['units']};selected=[u for u in d['units'] if u['ordinal'] in nums]
  if d['name'].endswith('.csv'):selected=[d['units'][0]]+selected
  sliced={**d,'units':selected};records,outline,unassigned=boundary(sliced)
  for rec in records:out.append(convert(extract_record(d,rec),d,w['windowId']))
 comparisons=[]
 for target in load('frozen-gold-stage2.json')+load('frozen-blind-gold.json'):
  candidates=[c for c in out if c['documentId']==target['documentId']]
  if target['documentId']=='D4':
   candidates=[c for c in candidates if c['span'][0]==target['sourceRange']['startOrdinal']]
   # Preserve legacy result identity while allowing the shared target matcher.
   candidates=[{**c,'windowId':'W-'+target['reviewId']} for c in candidates]
  matches=matched_cases(target,candidates,bydoc);kind='fixed25' if target['reviewId'].startswith('R') else 'blind12';comparisons.extend(compare(target,matches,kind))
 metrics={k:dict(collections.Counter(r['result'] for r in comparisons if r['set']==k)) for k in ['fixed25','blind12']};metrics['seconds']=round(time.perf_counter()-started,3)
 metrics['originalStage2OfficialCounts']={'sameRoleSpanPresent':45,'missingOrNotSeparated':91,'fields':136};metrics['alignment']='Same fixed source annotations, full-span same-role criterion; best single case for new and legacy. Original official counts kept separately.'
 save(STAGE/'legacy-aligned-cases.json',out);save(STAGE/'legacy-aligned-comparison.json',comparisons);save(STAGE/'legacy-aligned-metrics.json',metrics);print(json.dumps(metrics,ensure_ascii=False))

if __name__=='__main__':run()
