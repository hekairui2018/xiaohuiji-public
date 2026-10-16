"""Repeatable local HTTP comparison runner; private questions supplied separately.

Uses the existing tool handler/client API, not an additional client or index.
Old source snapshots are optional inputs; no golden answers enter inference.
"""
import argparse,hashlib,importlib.util,json,shutil,sys,threading,time,urllib.request
from pathlib import Path
import common


def imported(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 module=importlib.util.module_from_spec(spec);sys.modules[name]=module
 spec.loader.exec_module(module);return module


def main():
 p=argparse.ArgumentParser();p.add_argument('--work',required=True);p.add_argument('--revision',choices=['before','after'],required=True)
 p.add_argument('--samples',default='fixed.json');p.add_argument('--arms',default='A,B,C');p.add_argument('--port',type=int,default=4512)
 p.add_argument('--run-label')
 a=p.parse_args();root=Path(a.work).resolve()
 if not root.is_relative_to(common.ROOT/'tmp'):raise ValueError('Output must be isolated under project tmp')
 fixed=json.loads((root/a.samples).read_text(encoding='utf8'))
 manifest=json.loads((root/'frozen.json').read_text(encoding='utf8'))
 for n,digest in manifest['files'].items():
  if common.sha(root/n)!=digest:raise ValueError('Frozen input changed')
 label=a.run_label or a.revision
 if not label.replace('-','').isalnum():raise ValueError('invalid run label')
 work=root/label;work.mkdir(exist_ok=True);shutil.copyfile(root/'access-policy.json',work/'access-policy.json');common.WORK=work
 if a.revision=='before':
  snapshot=root/'implementation-before'
  for name,digest in manifest['baselineImplementation'].items():
   if common.sha(snapshot/name)!=digest:raise ValueError('Old implementation changed')
  engine=imported('baseline_engine',snapshot/'engine.py');engine.PROJECT=common.ROOT;common.engine=engine
  imported('tools',snapshot/'tools.py');conv=imported('conversation',snapshot/'conversation.py')
  http=imported('stage7_http',snapshot/'trial_http.py')
 else:
  import conversation as conv,trial_http as http
 import model
 model.WORK=work;conv.WORK=work
 if a.revision=='after':
  class ProfileConversation(conv.Conversation):
   def chat(self,question,session,arm='hybrid',direct_mode=None,filters=None,run_id=None,profile=None):
    return super().chat(question,session,arm,direct_mode,filters,run_id,profile or ('simple' if arm=='hybrid' else None))
  http.Conversation=ProfileConversation
 server=http.server(a.port);worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 def post(url,body):
  req=urllib.request.Request(url,data=json.dumps(body,ensure_ascii=False).encode(),headers={'Content-Type':'application/json','X-V2-Local-Knowledge':'1'})
  with op.open(req,timeout=200) as r:return json.load(r)
 common.save(work/'run-config.json',{'revision':a.revision,'datasetSHA256':common.sha(root/a.samples),'model':'bonsai','temperature':0,'seed':42,'maxTokens':640,'contextBudget':8192,'actualExistingClientAPI':'/api/ai/chat','profile':'simple' if a.revision=='after' else None,'implementation':{n:common.sha(Path(http.__file__).parent/n) for n in ['conversation.py','tools.py','trial_http.py']},'baselineSnapshotRelocationOnly':a.revision=='before'})
 try:
  for c in fixed:
   for arm in a.arms.split(','):
    dest=work/'results'/(c['id']+'-'+arm+'.json')
    if dest.exists():print('retained',c['id'],arm,flush=True);continue
    run='p7-'+label+'-'+c['id']+'-'+arm
    started=time.perf_counter()
    if arm=='A':
     result=post('http://127.0.0.1:'+str(a.port)+'/tool',{'name':'search_document_blocks','arguments':{'query':c['canonicalQuestion'],'limit':3}})
     out={'directResults':result,'modelCalls':[],'seconds':round(time.perf_counter()-started,3),'question':c['canonicalQuestion']}
    elif arm=='B':
     # The real existing application's HTTP adapter forwards to the same tool
     # service. No expected source, criterion or canonical intent is supplied.
     body={'message':c['originalQuestion'],'localSession':run+'-session','localRunId':run,'localProfile':'simple' if a.revision=='after' else None}
     # Explicit profile support also works when the Node adapter is already
     # running an older opt-in bridge: the handler's app is wrapped below.
     result=post('http://127.0.0.1:4499/api/ai/chat',body)
     out=result.get('localTrace',{'error':'existing-client-did-not-use-local-tools','response':result})
    elif arm=='C':
     out=post('http://127.0.0.1:'+str(a.port)+'/chat',{'question':c['originalQuestion'],'session':run+'-session','runId':run,'arm':'bare'})
    else:raise ValueError('unknown arm')
    common.save(dest,out);print(c['id'],arm,out.get('seconds'),out.get('error'),flush=True)
 finally:server.shutdown();server.server_close()


if __name__=='__main__':main()
