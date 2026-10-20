"""Official full-precision snapshot fallback when HF TLS is unavailable; no training."""
import concurrent.futures
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import quote
import requests

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / 'tmp/qwen35-08b-base'
AUDIT = ROOT / 'tmp/qwen35-download-cache'
MODEL = 'Qwen/Qwen3.5-0.8B'
HF_WEIGHT_SHA256 = '04b1c301231dd422b8860db31311ab2721511346a32cb1e079c4c4e5f1fe4696'
DEST.mkdir(parents=True, exist_ok=True)
AUDIT.mkdir(parents=True, exist_ok=True)

def download(entry):
    name = entry['Path']
    target = DEST / name
    assert target.resolve().is_relative_to(DEST.resolve())
    expected = entry['Sha256']
    if name.endswith('.safetensors'):
        assert expected == HF_WEIGHT_SHA256, 'Not the exact official HF weight'
    if target.exists() and target.stat().st_size == entry['Size']:
        with target.open('rb') as f:
            if hashlib.file_digest(f, 'sha256').hexdigest() == expected:
                return dict(file=name, bytes=entry['Size'], sha256=expected, verified=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    url = f'https://modelscope.cn/api/v1/models/{MODEL}/repo?Revision={entry["Revision"]}&FilePath={quote(name)}'
    partial = target.with_name(target.name + '.partial')
    for attempt in range(4):
        try:
            digest = hashlib.sha256()
            count = 0
            with requests.get(url, stream=True, timeout=(20, 90)) as response:
                response.raise_for_status()
                with partial.open('wb') as output:
                    for chunk in response.iter_content(4 * 1024 * 1024):
                        output.write(chunk)
                        digest.update(chunk)
                        count += len(chunk)
            assert count == entry['Size'], f'Incorrect length: {name}: {count}'
            assert digest.hexdigest() == expected, f'SHA256 mismatch: {name}'
            partial.replace(target)
            print(f'verified {name}: {count} bytes', flush=True)
            return dict(file=name, bytes=count, sha256=expected, verified=True,
                        source_revision=entry['Revision'])
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)

if __name__ == '__main__':
    started = time.time()
    entries = json.loads((AUDIT / 'modelscope-official-files.json').read_text(encoding='utf-8'))['Data']['Files']
    assert not any(e['Path'].lower().endswith('.gguf') for e in entries)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(download, entries))
    report = dict(model=MODEL, source='Qwen official ModelScope repository',
                  requested_source=f'https://huggingface.co/{MODEL}',
                  fallback_reason='hf CLI and direct HF requests failed with TLS unexpected EOF',
                  official_hf_weight_sha256=HF_WEIGHT_SHA256,
                  official_hf_hash_source=f'https://huggingface.co/{MODEL}/blob/main/model.safetensors-00001-of-00001.safetensors',
                  files=files, seconds=time.time()-started, training_started=False)
    (AUDIT / 'download-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(dict(complete=True, files=len(files), bytes=sum(f['bytes'] for f in files),
                          seconds=report['seconds'])), flush=True)
