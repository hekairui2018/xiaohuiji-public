"""Resumable experiment worker. Only owns processes in its isolated environment."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import tempfile
import urllib.request

ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/retrieval-lora-20261020'
SCRIPTS=Path(__file__).resolve().parent
CACHE=Path(tempfile.gettempdir())/'xhj-retrieval-lora-20261020'
PYTHON=WORK/'venv/Scripts/python.exe'
UV=WORK/'venv/Scripts/uv.exe'
TORCH_URL='https://download-r2.pytorch.org/whl/cu130/torch-2.10.0%2Bcu130-cp312-cp312-win_amd64.whl'
TORCH_SHA='224649fa0ab181ec483cc368e3303dda1760e4ba31bea806b88979f855436aaa'


def state(stage,**extra):
    path=WORK/'worker-status.json'
    temp=path.with_suffix('.partial')
    temp.write_text(json.dumps(dict(pid=os.getpid(),stage=stage,at=time.time(),**extra),ensure_ascii=False,indent=2),encoding='utf-8')
    temp.replace(path)
    print(stage,extra,flush=True)


def fetch_torch():
    dest=WORK/'wheels';dest.mkdir(exist_ok=True)
    wheel=dest/'torch-2.10.0+cu130-cp312-cp312-win_amd64.whl'
    if wheel.exists() and hashlib.file_digest(wheel.open('rb'),'sha256').hexdigest()==TORCH_SHA:return wheel
    total=1867405006;count=8;part_size=(total+count-1)//count
    def part(i):
        start=i*part_size;end=min(total-1,start+part_size-1);path=dest/f'torch.part{i}'
        if path.exists() and path.stat().st_size==end-start+1:return path
        for attempt in range(4):
            have=path.stat().st_size if path.exists() else 0
            request=urllib.request.Request(TORCH_URL,headers={'Range':f'bytes={start+have}-{end}'})
            try:
                with urllib.request.urlopen(request,timeout=120) as response:
                    if response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {start+have}-'):raise ValueError('Invalid download range')
                    with path.open('ab') as output:
                        while chunk:=response.read(1024*1024):output.write(chunk)
                if path.stat().st_size==end-start+1:return path
            except Exception:
                if attempt==3:raise
                time.sleep(2)
        raise RuntimeError('Incomplete torch wheel segment')
    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:parts=list(pool.map(part,range(count)))
    with wheel.open('wb') as output:
        for path in parts:
            with path.open('rb') as source:
                while chunk:=source.read(4*1024*1024):output.write(chunk)
    if hashlib.file_digest(wheel.open('rb'),'sha256').hexdigest()!=TORCH_SHA:raise ValueError('Official torch wheel SHA256 mismatch')
    for path in parts:path.unlink()
    return wheel


def run(stage,args):
    state(stage)
    with (WORK/f'{stage}.log').open('w',encoding='utf-8') as output:
        child=subprocess.Popen([str(x) for x in args],cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONUTF8':'1','PYTHONIOENCODING':'utf-8','UV_CACHE_DIR':str(WORK/'uv-cache'),'HF_HOME':str(WORK/'hf-cache'),'UNSLOTH_COMPILE_LOCATION':str(CACHE/'unsloth'),'TORCHINDUCTOR_CACHE_DIR':str(CACHE/'inductor'),'TRITON_CACHE_DIR':str(CACHE/'triton')},creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        state(stage,child_pid=child.pid)
        code=child.wait()
    if code:raise RuntimeError(f'{stage} failed with {code}; inspect {stage}.log')


def main():
    state('download-torch')
    wheel=fetch_torch()
    run('install-torch',[UV,'pip','install','--python',PYTHON,wheel])
    run('install-all',[UV,'pip','install','--python',PYTHON,'unsloth==2026.10.7','torch==2.10.0','torchvision==0.25.0','xformers==0.0.34','triton-windows==3.6.0.post26','--torch-backend=cu130'])
    with (WORK/'requirements.lock.txt').open('w',encoding='utf-8') as output:subprocess.run([str(UV),'pip','freeze','--python',str(PYTHON)],stdout=output,check=True,env={**os.environ,'UV_CACHE_DIR':str(WORK/'uv-cache')})
    run('gpu-import',[PYTHON,'-c','import torch; print(torch.__version__,torch.cuda.is_available()); assert torch.cuda.is_available(); import unsloth; print("UNSLOTH_IMPORT_OK")'])
    if not (WORK/'adapter/adapter_model.safetensors').exists():
        run('experiment',[PYTHON,'-u',SCRIPTS/'experiment.py','--steps','36'])
    elif not (WORK/'results/comparison.json').exists():
        raise RuntimeError('Adapter exists but evaluation is incomplete; preserve it and inspect logs rather than retrain')
    else:
        result=json.loads((WORK/'results/comparison.json').read_text(encoding='utf-8'))
        current_hash=hashlib.sha256((WORK/'data/candidates.jsonl').read_bytes()).hexdigest()
        if result['review_manifest_sha256']!=current_hash:raise RuntimeError('Dataset changed; do not overwrite the frozen experiment')
    run('score',[PYTHON,'-u',SCRIPTS/'summarize.py'])
    run('interface',[PYTHON,'-u',SCRIPTS/'verify_interface.py'])
    run('dispatch',['node',SCRIPTS/'verify_dispatch.cjs'])
    state('complete')


if __name__=='__main__':
    try:main()
    except Exception as error:state('failed',error=str(error));raise
