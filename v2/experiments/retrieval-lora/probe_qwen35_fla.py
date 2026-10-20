"""Confirm actual CUDA kernel launches before any performance claim."""
import collections
import json
import os
from pathlib import Path
import tempfile
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'tmp/retrieval-lora-20261020/venv/Lib/site-packages/triton'
CACHE=Path(tempfile.gettempdir())/'xhj-qwen35-fla'
os.environ.update(CUDA_PATH=str(BASE/'backends/nvidia'),CC=str(BASE/'runtime/tcc/tcc.exe'),
    TRITON_CACHE_DIR=str(CACHE/'triton'),TORCHINDUCTOR_CACHE_DIR=str(CACHE/'inductor'),
    HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',TOKENIZERS_PARALLELISM='false')
import torch
import triton
import fla
assert triton.runtime.driver.active.get_current_target().backend=='cuda'
from fla.utils import get_available_device
assert get_available_device()=='cuda', 'FLA CPU fallback forbidden'
from transformers import AutoTokenizer,Qwen3_5ForConditionalGeneration
from benchmark_qwen35_bf16 import PROMPTS
model_path=str(ROOT/'tmp/qwen35-08b-base')
tokenizer=AutoTokenizer.from_pretrained(model_path,local_files_only=True)
model=Qwen3_5ForConditionalGeneration.from_pretrained(model_path,dtype=torch.bfloat16,
    device_map={'':'cuda:0'},attn_implementation='sdpa',local_files_only=True).eval()
assert all(p.device.type=='cuda' and p.dtype==torch.bfloat16 for p in model.parameters())
launches=collections.Counter()
def enter(metadata):
    launches[metadata.get()['name']]+=1
triton.knobs.runtime.launch_enter_hook.add(enter)
text=tokenizer.apply_chat_template([{'role':'system','content':'你是一个用中文清晰回答问题的助手。直接回答，不输出思考过程。'},
    {'role':'user','content':PROMPTS[0]['text']}],tokenize=False,add_generation_prompt=True,enable_thinking=False)
inputs=tokenizer(text,return_tensors='pt',add_special_tokens=False).to('cuda:0')
with torch.inference_mode():
    result=model.generate(**inputs,max_new_tokens=8,do_sample=False,use_cache=True,
        repetition_penalty=1.1,eos_token_id=tokenizer.eos_token_id,pad_token_id=tokenizer.pad_token_id)
torch.cuda.synchronize()
triton.knobs.runtime.launch_enter_hook.remove(enter)
assert any('gated_delta' in name for name in launches), launches
assert any('fused_recurrent' in name for name in launches), launches
record={'verified':True,'backend':get_available_device(),'launches':dict(launches),
    'output':tokenizer.decode(result[0,inputs['input_ids'].shape[1]:],skip_special_tokens=True),
    'causal_conv1d':'not installed; official wheel download failed; reference convolution retained',
    'weights_cuda_bf16':True}
(ROOT/'tmp/qwen35-accel/kernel-verification.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=False,indent=2))
