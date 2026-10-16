"""Fourth-stage local experiment paths; no active or default application writes."""
import hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'tmp/tool-trial-stage4-20261016'
INDEX=ROOT/'tmp/resource-index-stage1-20261016'
sys.path.insert(0,str(ROOT/'v2/resource-index'))
import engine

def save(path,value):path.parent.mkdir(exist_ok=True,parents=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def load(name):return json.loads((WORK/name).read_text(encoding='utf8'))
def sha(path):
 with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
