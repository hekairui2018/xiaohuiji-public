"""Use this installed Studio's own sidecar repair; never install into base Python."""
import json
import os
import sys
from pathlib import Path
from importlib.metadata import version

ROOT = Path(__file__).resolve().parents[3]
STUDIO = ROOT/'tmp/unsloth-studio-20261020'
HOME = STUDIO/'home/studio'
os.environ.update(UNSLOTH_HOME=str(STUDIO/'home'), UNSLOTH_STUDIO_HOME=str(HOME),
                  UV_DEFAULT_INDEX='https://pypi.tuna.tsinghua.edu.cn/simple',
                  PIP_INDEX_URL='https://pypi.tuna.tsinghua.edu.cn/simple',
                  UV_CACHE_DIR=str(ROOT/'tmp/retrieval-lora-20261020/uv-cache'),
                  PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
os.environ['PATH'] = str(ROOT/'tmp/retrieval-lora-20261020/venv/Scripts')+os.pathsep+os.environ['PATH']
backend = HOME/'unsloth_studio/Lib/site-packages/studio/backend'
sys.path.insert(0, str(backend))
from utils import transformers_version as runtime
assert Path(runtime._VENV_T5_530_DIR).resolve() == (HOME/'.venv_t5_530').resolve()
before = {name:version(name) for name in ['transformers','huggingface-hub','torch']}
assert runtime._ensure_venv_t5_530_exists(), 'Official sidecar repair failed'
# This Studio was installed next to a newer ambient tokenizers. The official repair
# deliberately uses --no-deps; fill the 5.3.0 requirement in the same sidecar only.
from importlib.metadata import Distribution
metadata = next(Path(runtime._VENV_T5_530_DIR).glob('transformers-*.dist-info'))
requirements = Distribution.at(metadata).requires
tokenizer_requirement = next(r for r in requirements if r.startswith('tokenizers'))
from packaging.requirements import Requirement
requirement = Requirement(tokenizer_requirement)
if version('tokenizers') not in requirement.specifier:
    assert runtime._install_to_dir('tokenizers==0.22.2', runtime._VENV_T5_530_DIR)
assert runtime._venv_dir_is_valid_and_undamaged(runtime._VENV_T5_530_DIR, runtime._VENV_T5_530_PACKAGES)
after = {name:version(name) for name in before}
assert before == after, 'Ambient packages changed'
report = {'sidecar':runtime._VENV_T5_530_DIR, 'packages':runtime._VENV_T5_530_PACKAGES,
          'tokenizers_requirement':tokenizer_requirement, 'isolated_tokenizers':'0.22.2',
          'official_repair':True, 'ambient_before':before, 'ambient_after':after,
          'integrity_check':True, 'training_started':False}
(STUDIO/'t530-repair.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2),flush=True)
