"""Run five pilot windows first; explicit separate invocation for remaining set."""
import argparse,json,time
from bonsai import STAGE,call,messages,discover,GRAMMAR
from source import save,sha

def run(phase,revision=1):
 discover();manifest=json.loads((STAGE/'frozen-manifest.json').read_text(encoding='utf8'))
 for f,s in manifest['files'].items():assert sha(STAGE/f)==s,'Frozen source/expectation changed: '+f
 windows=json.loads((STAGE/'frozen-inputs.json').read_text(encoding='utf8'));pilot=manifest['pilotWindows']
 if phase=='remaining':
  gate=json.loads((STAGE/'pilot-gate.json').read_text(encoding='utf8'));assert gate['continueToRemaining'],gate
 selected=[w for w in windows if (w['windowId'] in pilot)==(phase=='pilot')]
 for w in selected:
  result=call((f'v{revision}-' if revision>=2 else '')+w['windowId'],messages(w,revision),max_tokens=4000,grammar=GRAMMAR if revision>=3 else None)
  parsed=result.get('parsed',{});print(json.dumps({'window':w['windowId'],'seconds':result['seconds'],'json':bool(parsed),'finish':result.get('finishReason'),'cases':len(parsed.get('cases',[])),'usage':result.get('response',{}).get('usage'),'error':result.get('error')},ensure_ascii=False),flush=True)
  if result.get('error'):break

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('phase',choices=['pilot','remaining']);p.add_argument('--revision',type=int,choices=[1,2,3],default=1);args=p.parse_args();run(args.phase,args.revision)
