"""Pinned official safetensors download, no GGUF and no remote Python code."""
import concurrent.futures
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MODEL = 'Qwen/Qwen3-0.6B'
REVISION = 'c1899de289a04d12100db370d81485cdf75e47ca'
DEST = ROOT / 'tmp/retrieval-lora-20261020/base-model'
FILES = ['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','vocab.json','merges.txt','model.safetensors']


def download(name):
    path = DEST/name
    if path.exists() and path.stat().st_size:
        return dict(file=name,bytes=path.stat().st_size,sha256=hashlib.file_digest(path.open('rb'),'sha256').hexdigest())
    url = f'https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}'
    req = urllib.request.Request(url,headers={'User-Agent':'xiaohuiji-local-training-experiment/1'})
    temp = path.with_suffix(path.suffix+'.partial')
    with urllib.request.urlopen(req,timeout=90) as response, temp.open('wb') as output:
        digest = hashlib.sha256()
        total = 0
        while chunk := response.read(4*1024*1024):
            output.write(chunk);digest.update(chunk);total+=len(chunk)
    temp.replace(path)
    result = dict(file=name,bytes=total,sha256=digest.hexdigest())
    print(json.dumps(result),flush=True)
    return result


if __name__ == '__main__':
    DEST.mkdir(parents=True,exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(download,FILES))
    # Official LFS object hash, captured from the pinned HF revision's tree API.
    expected = 'f47f71177f32bcd101b7573ec9171e6a57f4f4d31148d38e382306f42996874b'
    if next(r['sha256'] for r in records if r['file']=='model.safetensors') != expected:
        raise ValueError('Official safetensors SHA256 mismatch; refusing training')
    (DEST/'download-manifest.json').write_text(json.dumps(dict(model=MODEL,revision=REVISION,source='official Hugging Face safetensors',files=records),indent=2),encoding='utf-8')
