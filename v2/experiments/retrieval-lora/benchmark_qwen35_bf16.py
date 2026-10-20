"""Offline CUDA-only BF16 inference benchmark; no Studio, Unsloth, training or quantization."""
import collections
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]
MODEL = ROOT/'tmp/qwen35-08b-base'
OUT = ROOT/'tmp/qwen35-08b-bf16-benchmark'
OUT.mkdir(exist_ok=True)
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                  TOKENIZERS_PARALLELISM='false', PYTHONUTF8='1')
import torch
import transformers
from transformers import AutoTokenizer, Qwen3_5ForConditionalGeneration, StoppingCriteria, StoppingCriteriaList

PROMPTS = [
    {'id':'engineering', 'text':'请用中文详细讲解如何分析LED显示屏“昨晚正常、今天突然整屏没有画面”的问题。请分别说明已知事实、需要追问的信息、故障范围、同步与异步的区别、供电与信号检查、对调实验、证据不足的边界。每部分解释检查目的和结果如何改变判断，不要编造厂家参数，不要提前认定原因。请尽量完整展开，约1500字。'},
    {'id':'explanation', 'text':'请用中文写一篇面向初学者的详细教程，解释电脑如何将一段文字变成显示器上的图像。依次讲清字符编码、字体、像素、帧缓冲、显卡、视频信号、刷新率和显示面板，每个部分给出一个直观例子，再说明各部分如何协作。请连续给出完整教程，约1500字，不要输出思考过程。'}
]

def gpu_snapshot():
    result = subprocess.run(['nvidia-smi','--query-gpu=memory.used,memory.free,utilization.gpu','--format=csv,noheader,nounits'],
                            capture_output=True,text=True,check=True)
    values = [int(v.strip()) for v in result.stdout.splitlines()[0].split(',')]
    return dict(device_total_used_mib=values[0],device_free_mib=values[1],utilization_percent=values[2])

def status(stage, **kwargs):
    (OUT/'status.json').write_text(json.dumps(dict(stage=stage,**kwargs),indent=2),encoding='utf-8')

class LoopGuard(StoppingCriteria):
    def __init__(self, prompt_length):
        self.prompt_length = prompt_length
        self.triggered = False
    def __call__(self, input_ids, scores, **kwargs):
        if input_ids.shape[1]-self.prompt_length >= 96:
            tail = input_ids[0,-96:]
            self.triggered = bool(torch.equal(tail[:32],tail[32:64]) and torch.equal(tail[:32],tail[64:]))
        return self.triggered

class TokenClock:
    def __init__(self):
        self.prompt_seen = False
        self.times = []
    def put(self, values):
        if not self.prompt_seen:
            self.prompt_seen = True
            return
        assert values.numel()==1, 'Benchmark requires batch size 1'
        torch.cuda.synchronize()
        self.times.append(time.perf_counter())
    def end(self):
        pass

def main():
    assert torch.cuda.is_available(), 'CUDA required; CPU fallback forbidden'
    assert torch.cuda.is_bf16_supported(), 'Native BF16 required'
    torch.manual_seed(3407)
    baseline_gpu = gpu_snapshot()
    status('loading')
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL),local_files_only=True,trust_remote_code=False)
    torch.cuda.synchronize()
    begin = time.perf_counter()
    model = Qwen3_5ForConditionalGeneration.from_pretrained(str(MODEL),dtype=torch.bfloat16,
        device_map={'':'cuda:0'},attn_implementation='sdpa',local_files_only=True,trust_remote_code=False)
    model.eval()
    torch.cuda.synchronize()
    load_seconds = time.perf_counter()-begin
    devices = collections.Counter(str(p.device) for p in model.parameters())
    dtypes = collections.Counter(str(p.dtype) for p in model.parameters())
    assert set(devices)=={'cuda:0'}, devices
    assert 'torch.bfloat16' in dtypes
    assert not getattr(model,'is_loaded_in_4bit',False) and not getattr(model,'is_loaded_in_8bit',False)
    assert not getattr(model.config,'quantization_config',None)
    eos = tokenizer.eos_token_id
    assert tokenizer.convert_ids_to_tokens(eos)=='<|im_end|>'
    # The original config's 248044 is endoftext, not the chat turn ending. Override
    # per generate() only, without writing any model configuration to disk.
    metadata = dict(model=str(MODEL),torch=torch.__version__,transformers=transformers.__version__,
        gpu=torch.cuda.get_device_name(0),load_seconds=load_seconds,parameter_devices=dict(devices),
        parameter_dtypes=dict(dtypes),baseline_gpu=baseline_gpu,after_load_gpu=gpu_snapshot(),
        eos_token_id=eos,thinking=False,quantization=False,attention='sdpa',batch_size=1,
        sampling=False,repetition_penalty=1.1,loop_guard='three adjacent identical 32-token blocks',
        cpu_offload=False,existing_services_stopped=False,model_weights_sha256='04b1c301231dd422b8860db31311ab2721511346a32cb1e079c4c4e5f1fe4696')
    (OUT/'environment.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    def run(prompt, limit, repeat, warmup=False):
        messages = [{'role':'system','content':'你是一个用中文清晰回答问题的助手。直接回答，不输出思考过程。'},
                    {'role':'user','content':prompt['text']}]
        rendered = tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
        assert rendered.rstrip().endswith('</think>'), 'Non-thinking template suffix missing'
        inputs = tokenizer(rendered,return_tensors='pt',add_special_tokens=False).to('cuda:0')
        prompt_tokens = inputs['input_ids'].shape[1]
        clock = TokenClock()
        guard = LoopGuard(prompt_tokens)
        forward_times = []
        def pre_hook(module,args):
            if not forward_times:
                torch.cuda.synchronize()
                forward_times.append(time.perf_counter())
        def post_hook(module,args,result):
            if len(forward_times)==1:
                torch.cuda.synchronize()
                forward_times.append(time.perf_counter())
        pre = model.register_forward_pre_hook(pre_hook)
        post = model.register_forward_hook(post_hook)
        before_gpu = gpu_snapshot()
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
        start = time.perf_counter()
        try:
            with torch.inference_mode():
                result = model.generate(**inputs,max_new_tokens=limit,do_sample=False,use_cache=True,
                    repetition_penalty=1.1,eos_token_id=eos,pad_token_id=tokenizer.pad_token_id,
                    streamer=clock,stopping_criteria=StoppingCriteriaList([guard]))
            torch.cuda.synchronize()
            finish = time.perf_counter()
        finally:
            pre.remove(); post.remove()
        output_ids = result[0,prompt_tokens:].tolist()
        assert len(output_ids)==len(clock.times)
        n = len(output_ids)
        prefill_s = forward_times[1]-forward_times[0]
        decode_s = clock.times[-1]-clock.times[0] if n>1 else 0
        text = tokenizer.decode(output_ids,skip_special_tokens=True)
        record = dict(prompt_id=prompt['id'],prompt=prompt['text'],target_max_new_tokens=limit,repeat=repeat,
            warmup=warmup,input_tokens=prompt_tokens,actual_generated_tokens=n,
            load_seconds=load_seconds,ttft_s=clock.times[0]-start,prefill_forward_s=prefill_s,
            prompt_tokens_per_s=prompt_tokens/prefill_s,decode_tokens=max(0,n-1),decode_s=decode_s,
            decode_tokens_per_s=(n-1)/decode_s if decode_s else None,total_generation_s=finish-start,
            finish_reason='repetition_guard' if guard.triggered else 'eos' if output_ids[-1]==eos else 'length',
            loop_guard_triggered=guard.triggered,thinking_marker_in_output='<think>' in text or '</think>' in text,
            token_arrivals_s=[t-start for t in clock.times],output_token_ids=output_ids,output=text,
            peak_allocated_mib=torch.cuda.max_memory_allocated()/2**20,
            peak_reserved_mib=torch.cuda.max_memory_reserved()/2**20,before_gpu=before_gpu,after_gpu=gpu_snapshot())
        with (OUT/'runs.jsonl').open('a',encoding='utf-8') as f:
            f.write(json.dumps(record,ensure_ascii=False)+'\n')
        print(json.dumps({k:record[k] for k in ['prompt_id','target_max_new_tokens','repeat','warmup','actual_generated_tokens','ttft_s','decode_tokens_per_s','finish_reason']},ensure_ascii=False),flush=True)
        return record
    assert not (OUT/'runs.jsonl').exists(), 'Refusing to overwrite previous measurements'
    status('warming')
    for prompt in PROMPTS:
        run(prompt,32,0,warmup=True)
    records = []
    for limit in [128,256,512]:
        for prompt in PROMPTS:
            for repeat in range(1,4):
                status('measuring',limit=limit,prompt=prompt['id'],repeat=repeat,completed=len(records),total=18)
                records.append(run(prompt,limit,repeat))
    summary = []
    for limit in [128,256,512]:
        for prompt in PROMPTS:
            group = [r for r in records if r['target_max_new_tokens']==limit and r['prompt_id']==prompt['id']]
            row = dict(prompt_id=prompt['id'],max_new_tokens=limit,runs=3,actual_tokens=[r['actual_generated_tokens'] for r in group])
            for key in ['ttft_s','prompt_tokens_per_s','decode_tokens_per_s','peak_allocated_mib','peak_reserved_mib']:
                values = [r[key] for r in group]
                row[key] = dict(mean=statistics.mean(values),min=min(values),max=max(values))
            summary.append(row)
    (OUT/'summary.json').write_text(json.dumps(dict(environment=metadata,groups=summary,
        loops=sum(r['loop_guard_triggered'] for r in records),thinking_markers=sum(r['thinking_marker_in_output'] for r in records),
        methodology='TTFT includes generate setup and sampling; prefill forward is separately synchronized; decode speed=(N-1)/(last-first token arrival). Natural EOS retained, no forced minimum length.'),indent=2),encoding='utf-8')
    del model
    torch.cuda.empty_cache()
    status('complete',runs=18,after_release_gpu=gpu_snapshot())

if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        status('failed',error=str(exc))
        raise
