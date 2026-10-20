"""Register only a new loopback provider using Studio's supported API; preserve all old entries."""
import json,os,sys,subprocess
from pathlib import Path
from datetime import timedelta
ROOT=Path(__file__).resolve().parents[3]
HOME=ROOT/'tmp/unsloth-studio-20261020/home'
os.environ['UNSLOTH_HOME']=str(HOME)
os.environ['UNSLOTH_STUDIO_HOME']=str(HOME/'studio')
sys.path.insert(0,str(HOME/'studio/unsloth_studio/Lib/site-packages/studio/backend'))
from auth.authentication import create_access_token
from auth.storage import DEFAULT_ADMIN_USERNAME
import requests
token=create_access_token(DEFAULT_ADMIN_USERNAME,timedelta(hours=2))
session=requests.Session();session.trust_env=False
session.headers['Authorization']='Bearer '+token
base='http://127.0.0.1:8888'
out=ROOT/'tmp/studio-fast-chat-20261020'
if '--register' in sys.argv:
    old=session.get(base+'/api/providers/').json()
    backup=out/'backups/providers-before.json'
    if not backup.exists():backup.write_text(json.dumps(old,indent=2),encoding='utf-8')
    assert isinstance(old,list),old
    existing=next((p for p in old if p.get('base_url')=='http://127.0.0.1:8890/v1'),None)
    if not existing:
        models=requests.get('http://127.0.0.1:8890/v1/models').json()['data']
        reply=session.post(base+'/api/providers/',json={'provider_type':'custom',
            'display_name':'本机 Qwen3.5 BF16 · CUDA Graph', 'base_url':'http://127.0.0.1:8890/v1',
            'models':[m['id'] for m in models], 'available_models':[m['id'] for m in models],
            'max_output_tokens':2048})
        assert reply.ok,reply.text
        existing=reply.json()
    (out/'provider.json').write_text(json.dumps(existing,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Local GPU provider registered:',existing['id'])
if '--browser' in sys.argv:
    result=subprocess.run([os.environ.get('XHJ_NODE','node'),str(Path(__file__).with_name('studio_fast_ui.cjs'))],
        input=token,text=True,encoding='utf-8',cwd=ROOT,timeout=1800)
    raise SystemExit(result.returncode)
