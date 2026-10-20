"""Conditional larger-model baseline only; no additional fine-tuning."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
from experiment import WORK,ROOT,dump,evaluate,gpu,load_rows

MODEL='Qwen/Qwen3-1.7B'
REV='70d244cc86ccca08cf5af4e1e306ecf908b1ad5e'
DEST=WORK/'base-model-1.7b'


def fetch():
    DEST.mkdir(exist_ok=True)
    tree=json.load(urllib.request.urlopen(f'https://huggingface.co/api/models/{MODEL}/tree/{REV}?recursive=false&expand=false',timeout=30))
    wanted=[r for r in tree if r['path'] in ['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','vocab.json','merges.txt','model.safetensors.index.json'] or r['path'].endswith('.safetensors')]
    manifest=[]
    for info in wanted:
        name=info['path'];path=DEST/name;size=info['size'];expected=info.get('lfs',{}).get('oid')
        if path.exists() and path.stat().st_size==size and (not expected or hashlib.file_digest(path.open('rb'),'sha256').hexdigest()==expected):continue
        url=f'https://huggingface.co/{MODEL}/resolve/{REV}/{name}'
        if size<20_000_000:
            with urllib.request.urlopen(url,timeout=90) as response:path.write_bytes(response.read())
        else:
            count=8;part_size=(size+count-1)//count
            def part(i):
                start=i*part_size;end=min(size-1,start+part_size-1);p=DEST/(name+f'.part{i}')
                for attempt in range(4):
                    have=p.stat().st_size if p.exists() else 0
                    if have==end-start+1:return p
                    request=urllib.request.Request(url+f'?download=true&xhjpart={i}&offset={have}',headers={'Range':f'bytes={start+have}-{end}'})
                    try:
                        with urllib.request.urlopen(request,timeout=120) as response:
                            if response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {start+have}-'):raise ValueError('range mismatch')
                            with p.open('ab') as output:
                                while chunk:=response.read(1024*1024):output.write(chunk)
                        if p.stat().st_size==end-start+1:return p
                    except Exception:
                        if attempt==3:raise
                        time.sleep(1)
                raise ValueError('incomplete model shard')
            with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:parts=list(pool.map(part,range(count)))
            with path.open('wb') as output:
                for p in parts:
                    with p.open('rb') as source:
                        while chunk:=source.read(4*1024*1024):output.write(chunk)
            if expected and hashlib.file_digest(path.open('rb'),'sha256').hexdigest()!=expected:raise ValueError('official shard hash mismatch')
            for p in parts:p.unlink()
        manifest.append(dict(file=name,bytes=path.stat().st_size,sha256=hashlib.file_digest(path.open('rb'),'sha256').hexdigest()))
        print(json.dumps(dict(downloaded=name,bytes=size)),flush=True)
    dump(DEST/'download-manifest.json',dict(model=MODEL,revision=REV,files=manifest))


if __name__=='__main__':
    fetch()
    # Wait only for this experiment's own 0.6B worker, not unrelated services.
    while True:
        status=json.loads((WORK/'worker-status.json').read_text(encoding='utf-8'))
        if status['stage'] in ('complete','failed'):break
        time.sleep(2)
    if gpu()['free_mib']<6500:raise RuntimeError('Insufficient free VRAM; did not stop existing services')
    from unsloth import FastLanguageModel
    import torch
    from transformers import set_seed
    set_seed(3407)
    model,tokenizer=FastLanguageModel.from_pretrained(model_name=str(DEST),max_seq_length=512,dtype=torch.bfloat16,load_in_4bit=False,local_files_only=True,trust_remote_code=False)
    summary=evaluate(model,tokenizer,load_rows('test'),'baseline-1.7b',torch)
    print(json.dumps(summary),flush=True)
