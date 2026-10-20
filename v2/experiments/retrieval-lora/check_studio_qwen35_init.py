"""Initialize through Studio's training loader; never prepare data or call train()."""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STUDIO = ROOT/'tmp/unsloth-studio-20261020'
HOME = STUDIO/'home/studio'
compile_root = Path(tempfile.gettempdir())/'xhj-studio-qwen35-init'
os.environ.update(UNSLOTH_HOME=str(STUDIO/'home'), UNSLOTH_STUDIO_HOME=str(HOME),
    HF_HOME=str(STUDIO/'hf-cache'), HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
    TOKENIZERS_PARALLELISM='false', UNSLOTH_DIFFUSERS_MAIN='0',
    TRITON_CACHE_DIR=str(compile_root/'triton'), TORCHINDUCTOR_CACHE_DIR=str(compile_root/'inductor'),
    UNSLOTH_COMPILE_LOCATION=str(compile_root/'unsloth'))
sys.path.insert(0,str(HOME/'unsloth_studio/Lib/site-packages/studio/backend'))
from utils.transformers_version import activate_transformers_for_subprocess, _VENV_T5_530_DIR
model_path = str(ROOT/'tmp/qwen35-08b-base')
activate_transformers_for_subprocess(model_path)
import unsloth
import transformers
import torch
assert transformers.__version__ == '5.3.0'
assert Path(transformers.__file__).resolve().is_relative_to(Path(_VENV_T5_530_DIR).resolve())
from core.training.trainer import UnslothTrainer
started = time.monotonic()
trainer = UnslothTrainer()
ok = trainer.load_model(model_path, max_seq_length=512, load_in_4bit=False,
                         is_dataset_image=False, full_finetuning=False, local_files_only=True,
                         trust_remote_code=False)
assert ok and trainer.model is not None, str(trainer.model_load_error)
assert not getattr(trainer.model,'is_loaded_in_4bit',False)
assert not getattr(trainer.model,'is_loaded_in_8bit',False)
dtypes = sorted({str(p.dtype) for p in trainer.model.parameters()})
assert 'torch.bfloat16' in dtypes
result = {'transformers':transformers.__version__, 'transformers_file':transformers.__file__,
          'model':model_path, 'model_class':type(trainer.model).__name__, 'dtypes':dtypes,
          'initialized':True, 'load_in_4bit':False,'load_in_8bit':False,
          'seconds':time.monotonic()-started,
          'peak_reserved_mib':torch.cuda.max_memory_reserved()/2**20,
          'training_started':False,'optimizer_steps':0}
(STUDIO/'qwen35-init-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2),flush=True)
del trainer
torch.cuda.empty_cache()
