"""Owns and stops only its temporary experiment server, never any existing service."""
import json
import os
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path
from protocol import parse_raw

ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/retrieval-lora-20261020'


def main():
    runtime=WORK/'results/interface-runtime.json'
    started=time.time()
    run_id=uuid.uuid4().hex
    stdout=(WORK/'results/interface.stdout.log').open('w',encoding='utf-8')
    stderr=(WORK/'results/interface.stderr.log').open('w',encoding='utf-8')
    child=subprocess.Popen([sys.executable,'-u',str(Path(__file__).with_name('serve.py'))],cwd=ROOT,stdout=stdout,stderr=stderr,env={**os.environ,'PYTHONUTF8':'1','XHJ_EXPERIMENT_RUN_ID':run_id},creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    try:
        for _ in range(180):
            if child.poll() is not None:raise RuntimeError('Test server exited; see interface.stderr.log')
            if runtime.exists() and runtime.stat().st_mtime>=started:
                info=json.loads(runtime.read_text(encoding='utf-8'))
                # Windows venv launchers can have a different PID from the real
                # Python interpreter. A per-run nonce identifies this child.
                if info.get('run_id')==run_id:break
            time.sleep(1)
        else:raise RuntimeError('Test server readiness timeout')
        base='http://127.0.0.1:'+str(info['port'])
        with urllib.request.urlopen(base+'/health',timeout=5) as response:assert json.load(response)['toolsExecuted'] is False
        requests=[]
        for message in ['B6L对比B8L的带载规格','R732的ICN2153专用升级文件','给我一个']:
            request=urllib.request.Request(base+'/decision',data=json.dumps(dict(message=message),ensure_ascii=False).encode(),headers={'Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(request,timeout=90) as response:
                    raw=response.read().decode();parse_raw(raw)
                    requests.append(dict(message=message,status=response.status,action=json.loads(raw),seconds=float(response.headers['X-Inference-Seconds']),output_tokens=int(response.headers['X-Output-Tokens'])))
            except urllib.error.HTTPError as error:
                requests.append(dict(message=message,status=error.code,error=error.read().decode()))
        receipt=dict(passed=all(r['status']==200 for r in requests),host='127.0.0.1',port=info['port'],requests=requests,productionToolsExecuted=0,productionConfigChanged=False)
        (WORK/'results/interface-verification.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(receipt,ensure_ascii=False))
        if not receipt['passed']:raise RuntimeError('Model failed independent interface; production remains unchanged')
    finally:
        if child.poll() is None:child.terminate()
        try:child.wait(timeout=15)
        except subprocess.TimeoutExpired:child.kill();child.wait()
        stdout.close();stderr.close()


if __name__=='__main__':main()
