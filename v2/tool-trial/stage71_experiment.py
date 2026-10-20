"""Same existing HTTP client, frozen private input, pre/post dispatch comparison."""
import argparse,json,shutil,threading,time,urllib.request
from pathlib import Path
import common
from stage7_experiment import imported

def main():
 p=argparse.ArgumentParser();p.add_argument('--work',required=True);p.add_argument('--revision',choices=['before','after'],required=True);p.add_argument('--label',required=True);p.add_argument('--samples',default='all-samples.json');p.add_argument('--port',type=int,default=4512);p.add_argument('--limit',type=int,default=0);a=p.parse_args()
 root=Path(a.work).resolve()
 if not root.is_relative_to(common.ROOT/'tmp') or not a.label.replace('-','').isalnum():raise ValueError('output')
 frozen=json.loads((root/'frozen.json').read_text(encoding='utf8'))
 assert all(common.sha(root/n)==sha for n,sha in frozen['files'].items())
 work=root/a.label;work.mkdir(exist_ok=True);shutil.copyfile(root/'access-policy.json',work/'access-policy.json');common.WORK=work
 if a.revision=='before':
  s=root/'implementation-before';assert all(common.sha(s/n)==sha for n,sha in frozen['baselineImplementation'].items())
  e=imported('baseline_engine',s/'engine.py');e.PROJECT=common.ROOT;common.engine=e
  imported('simple_response',s/'simple_response.py');imported('tools',s/'tools.py');conv=imported('conversation',s/'conversation.py');http=imported('trial_http',s/'trial_http.py')
 else:
  import conversation as conv,trial_http as http
 import model
 model.WORK=work;conv.WORK=work
 profile='simple' if a.revision=='before' else 'dispatch'
 server=http.server(a.port,default_profile=profile);threading.Thread(target=server.serve_forever,daemon=True).start()
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}));samples=json.loads((root/a.samples).read_text(encoding='utf8'))
 if a.limit:samples=samples[:a.limit]
 code=work/'implementation';code.mkdir(exist_ok=True)
 for name in ['conversation.py','tools.py','trial_http.py','simple_response.py']+(['decision_protocol.py'] if a.revision=='after' else []):
  source=Path(conv.__file__).parent/name;shutil.copyfile(source,code/name)
 common.save(work/'run-config.json',{'revision':a.revision,'profile':profile,'datasetSHA256':common.sha(root/a.samples),'sampleIds':[x['id'] for x in samples],'model':'bonsai','temperature':0,'seed':42,'maxOutputTokens':640,'contextBudget':8192,'client':'existing /api/ai/chat on 4499, no frontend change','blind':0,'sourceFiles':{p.name:common.sha(p) for p in code.iterdir()}})
 try:
  for c in samples:
   if (work/'stop-after-current').exists():
    common.save(work/'interruption.json',{'reason':'requested graceful stop at sample boundary','completedIds':[p.stem for p in (work/'results').glob('*.json')],'remainingSamplesRetained':True});break
   dest=work/'results'/(c['id']+'.json')
   if dest.exists():print('retained',c['id'],flush=True);continue
   rid='p71-'+a.label+'-'+c['id'];body={'message':c['originalQuestion'],'localSession':rid+'-client','localRunId':rid}
   req=urllib.request.Request('http://127.0.0.1:4499/api/ai/chat',data=json.dumps(body,ensure_ascii=False).encode(),headers={'Content-Type':'application/json','X-V2-Local-Knowledge':'1'})
   start=time.perf_counter()
   with op.open(req,timeout=240) as response:out=json.load(response)
   common.save(dest,{'id':c['id'],'split':c['split'],'question':c['originalQuestion'],'response':out,'clientElapsedSeconds':round(time.perf_counter()-start,3)})
   tr=out.get('localTrace',{});print(c['id'],tr.get('seconds'),tr.get('error'),'decisions',len(tr.get('decisions',[])),flush=True)
 finally:server.shutdown();server.server_close()

if __name__=='__main__':main()
