"""Actual HTTP three-arm replay; immutable question set, one inference lane."""
import argparse,hashlib,json,time,urllib.request
from common import WORK,load,save,sha
BASE='http://127.0.0.1:4512'
LOCAL_HTTP=urllib.request.build_opener(urllib.request.ProxyHandler({}))

def request(path,value):
 req=urllib.request.Request(BASE+path,data=json.dumps(value,ensure_ascii=False).encode(),headers={'Content-Type':'application/json'})
 with LOCAL_HTTP.open(req,timeout=900) as r:return json.loads(r.read())

def run(only=None,question_file='questions.json'):
 frozen=load('frozen-manifest.json')
 for name,digest in frozen['files'].items():assert sha(WORK/name)==digest
 history={}
 for q in load(question_file):
  if only and q['id'] not in only:continue
  target=WORK/'results'/(q['id']+'.json');history.setdefault(q['clientSession'],[]).append(q['question'])
  if target.exists():continue
  start=time.perf_counter();query='\n'.join(history[q['clientSession']]);args={'query':query,'limit':3}
  if q['modelFilter']:args['model']=q['modelFilter']
  if q['versionFilter']:args['version']=q['versionFilter']
  direct=request('/tool',{'name':'search_resources' if q['group']=='files' else 'search_document_blocks','arguments':args})
  context=None
  if direct.get('results') and direct['results'][0].get('blockId'):
   first=direct['results'][0];context=request('/tool',{'name':'read_document','arguments':{'resourceId':first['resourceId'],'versionId':first['versionId'],'blockId':first['blockId'],'radius':1}})
  direct_arm={'request':args,'search':direct,'context':context,'seconds':round(time.perf_counter()-start,3),'noModel':True,'comparisonScope':'raw cumulative customer text, no AI query rewriting; one first-hit context read'}
  filters={k:v for k,v in {'model':q['modelFilter'],'version':q['versionFilter']}.items() if v}
  hybrid=request('/chat',{'question':q['question'],'session':'bench-'+q['clientSession'],'arm':'hybrid','directMode':'files' if q['group']=='files' else None,'filters':filters if q['group']=='files' else {},'runId':'hybrid-'+q['id']})
  bare=request('/chat',{'question':q['question'],'session':'bench-'+q['clientSession'],'arm':'bare','runId':'bare-'+q['id']})
  record={'questionId':q['id'],'question':q,'direct':direct_arm,'hybrid':hybrid,'bare':bare};save(target,record)
  print(json.dumps({'id':q['id'],'group':q['group'],'directMs':round(direct_arm['seconds']*1000,1),'hybridSeconds':hybrid.get('seconds'),'bareSeconds':bare.get('seconds'),'tools':[t['name'] for t in hybrid.get('tools',[])],'error':hybrid.get('error') or bare.get('error')},ensure_ascii=False),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--only',nargs='*');p.add_argument('--question-file',default='questions.json');a=p.parse_args();run(set(a.only) if a.only else None,a.question_file)
