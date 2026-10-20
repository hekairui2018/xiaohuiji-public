"""Owner-local recovery checks; credentials remain in memory, never logged."""
import json
import hashlib
import os
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STUDIO = ROOT/'tmp/unsloth-studio-20261020'
os.environ['UNSLOTH_HOME'] = str(STUDIO/'home')
os.environ['UNSLOTH_STUDIO_HOME'] = str(STUDIO/'home/studio')
backend = STUDIO/'home/studio/unsloth_studio/Lib/site-packages/studio/backend'
sys.path.insert(0, str(backend))
from auth.authentication import create_access_token
from auth.storage import DEFAULT_ADMIN_USERNAME
import requests

session = requests.Session()
session.trust_env = False
session.headers['Authorization'] = 'Bearer ' + create_access_token(DEFAULT_ADMIN_USERNAME, timedelta(minutes=5))
base = 'http://127.0.0.1:8888'

def call(method, path, **kwargs):
    response = session.request(method, base+path, timeout=60, **kwargs)
    if not response.ok:
        raise RuntimeError(f'{method} {path}: {response.status_code}: {response.text[:400]}')
    return response.json()

model = ROOT/'tmp/qwen35-08b-base'
folder = call('POST', '/api/models/scan-folders', json={'path':str(model), 'recursive':True})
models = call('GET', '/api/models/local')
assert 'qwen35-08b-base' in json.dumps(models, ensure_ascii=False), 'Model absent from inventory'
source = ROOT/'tmp/qwen35-08b-training-kit/train.jsonl'
with source.open('rb') as stream:
    upload = call('POST', '/api/hub/datasets/upload', files={'file':('qwen35-08b-train.jsonl', stream, 'application/jsonl')})
stored = upload['stored_path']
format_result = call('POST', '/api/datasets/check-format', json={'dataset_name':stored, 'is_vlm':False, 'train_split':'train'})
stored_file = Path(stored)
assert stored_file.is_file(), 'Upload did not create a dataset file'
assert hashlib.sha256(source.read_bytes()).digest() == hashlib.sha256(stored_file.read_bytes()).digest()
assert len([line for line in stored_file.read_text(encoding='utf-8').splitlines() if line.strip()]) == 48
assert 'text' in format_result.get('columns', []), format_result
report = {'health':call('GET','/api/health'), 'model_registered':True,
          'scan_folder':folder, 'model_inventory':models,
          'upload':upload, 'format_check':{key:value for key,value in format_result.items() if key!='preview_samples'},
          'training_started':False}
(STUDIO/'recovery-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'model_identified':True,'upload_ok':True,'rows':48,
                  'format':format_result.get('detected_format'), 'manual_mapping':format_result.get('requires_manual_mapping'), 'stored_path':stored,
                  'training_started':False},ensure_ascii=False))
