"""Single-stream fixed-length CUDA BF16 speed experiment. Never trains or modifies weights."""
import argparse
import collections
import json
import os
from pathlib import Path
import statistics
import tempfile
import time

ROOT=Path(__file__).resolve().parents[3]
TRITON=ROOT/'tmp/retrieval-lora-20261020/venv/Lib/site-packages/triton'
CACHE=Path(tempfile.gettempdir())/'xhj-qwen35-speed-lab'
os.environ.update(CUDA_PATH=str(TRITON/'backends/nvidia'),CC=str(TRITON/'runtime/tcc/tcc.exe'),
    TRITON_CACHE_DIR=str(CACHE/'triton'),TORCHINDUCTOR_CACHE_DIR=str(CACHE/'inductor'),
    HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',TOKENIZERS_PARALLELISM='false',
    TORCHINDUCTOR_COMPILE_THREADS='1')
import torch
import transformers
from transformers import AutoTokenizer,Qwen3_5ForConditionalGeneration,DynamicCache,StaticCache
from benchmark_qwen35_bf16 import PROMPTS

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['hf','bare','manual','static','compile','graph','graph_multi','compile_graph','compile_graph8'],required=True)
    parser.add_argument('--name',required=True)
    parser.add_argument('--quick',action='store_true')
    args=parser.parse_args()
    out=ROOT/'tmp/qwen35-speed-lab/results'/args.name
    out.mkdir(parents=True,exist_ok=True)
    assert not (out/'runs.jsonl').exists(),'Never overwrite measurements'
    def status(stage,**extra):
        (out/'status.json').write_text(json.dumps(dict(stage=stage,mode=args.mode,**extra)),encoding='utf-8')
    status('loading')
    assert torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    model_path=str(ROOT/'tmp/qwen35-08b-base')
    tokenizer=AutoTokenizer.from_pretrained(model_path,local_files_only=True)
    model=Qwen3_5ForConditionalGeneration.from_pretrained(model_path,dtype=torch.bfloat16,
        device_map={'':'cuda:0'},attn_implementation='sdpa',local_files_only=True).eval()
    assert all(p.device.type=='cuda' and p.dtype==torch.bfloat16 for p in model.parameters())
    text=tokenizer.apply_chat_template([{'role':'system','content':'你是一个用中文清晰回答问题的助手。直接回答，不输出思考过程。'},
        {'role':'user','content':PROMPTS[0]['text']}],tokenize=False,add_generation_prompt=True,enable_thinking=False)
    inputs=tokenizer(text,return_tensors='pt',add_special_tokens=False).to('cuda:0')
    length=inputs.input_ids.shape[1]
    native={'fwd':0,'update':0}
    try:
        import causal_conv1d_cuda as conv
        # Count actual extension entry calls only during the first warmup; removed for measurement.
        originals={key:getattr(conv,'causal_conv1d_'+key) for key in native}
        for key in native:
            def wrap(*a,_key=key,**kw):
                native[_key]+=1
                return originals[_key](*a,**kw)
            setattr(conv,'causal_conv1d_'+key,wrap)
    except ImportError:
        conv=None
    metadata=dict(mode=args.mode,name=args.name,torch=torch.__version__,transformers=transformers.__version__,
        model=model_path,dtype='bfloat16',device='cuda:0',input_tokens=length,
        prompt=PROMPTS[0]['text'],ignore_eos=True,stream_count=1,attention='sdpa',
        repetition_penalty=1.1 if args.mode=='hf' else 1.0,causal_conv1d=conv is not None,
        compile=False,cuda_graph=False,cache='dynamic',quality_tested=False)

    class Clock:
        def __init__(self): self.first=None;self.seen=False;self.count=0
        def put(self,tokens):
            if not self.seen:self.seen=True;return
            self.count+=1
            if self.first is None:
                torch.cuda.synchronize();self.first=time.perf_counter()
        def end(self):pass

    cache=None;graph=None;compiled=None;block_graph=None
    block_output=torch.empty(8,dtype=torch.long,device='cuda')
    token=torch.zeros((1,1),dtype=torch.long,device='cuda')
    pos=torch.full((1,1),length,dtype=torch.long,device='cuda')
    max_cache=length+1024+16
    slots=torch.arange(max_cache,device='cuda').view(1,1,1,-1)
    if args.mode in ['static','compile','graph','graph_multi','compile_graph','compile_graph8']:
        cache=StaticCache(model.config,max_cache_len=max_cache)
        metadata['cache']='static'
    def prefill():
        nonlocal cache
        if args.mode=='manual':cache=DynamicCache(config=model.config)
        else:cache.reset()
        pre=model(**inputs,past_key_values=cache,use_cache=True,logits_to_keep=1)
        token.copy_(pre.logits[:,-1,:].argmax(dim=-1,keepdim=True))
        pos.fill_(length)
    def step():
        mask={'full_attention':slots<=pos.view(1,1,1,1),'linear_attention':None} if metadata['cache']=='static' else {'full_attention':None,'linear_attention':None}
        result=model(input_ids=token,position_ids=pos.view(1,1,1).expand(4,1,1),
            attention_mask=mask,past_key_values=cache,use_cache=True,logits_to_keep=1)
        token.copy_(result.logits[:,-1,:].argmax(dim=-1,keepdim=True))
        pos.add_(1)

    @torch.inference_mode()
    def run(count,repeat,warmup=False):
        clock=Clock()
        torch.cuda.reset_peak_memory_stats()
        if args.mode in ['hf','bare']:
            torch.cuda.synchronize();start=time.perf_counter()
            result=model.generate(**inputs,max_new_tokens=count,min_new_tokens=count,
                do_sample=False,use_cache=True,repetition_penalty=metadata['repetition_penalty'],
                eos_token_id=None,pad_token_id=tokenizer.pad_token_id,streamer=clock,
                disable_compile=True)
            torch.cuda.synchronize();finish=time.perf_counter()
            assert result.shape[1]-length==count and clock.count==count
            elapsed=finish-clock.first
            output_ids=result[0,length:].tolist()
            ttft=clock.first-start
        else:
            torch.cuda.synchronize();start=time.perf_counter();prefill();torch.cuda.synchronize()
            ttft=time.perf_counter()-start
            output=torch.empty(count,dtype=torch.long,device='cuda')
            output[0].copy_(token.view(()))
            torch.cuda.synchronize();decode_start=time.perf_counter()
            i=1
            while i<count:
                if block_graph is not None and count-i>=8:
                    block_graph.replay()
                    output[i:i+8].copy_(block_output)
                    i+=8
                    continue
                if graph is not None:
                    graph.replay()
                elif compiled is not None:compiled()
                else:step()
                output[i].copy_(token.view(()));i+=1
            torch.cuda.synchronize();elapsed=time.perf_counter()-decode_start
            output_ids=output.tolist()
            expected_position=length+count-1
            assert int(pos.item())==expected_position,'Decode position did not advance for every token'
            cached_length=cache.get_seq_length()
            if isinstance(cached_length,torch.Tensor):cached_length=int(cached_length.item())
            assert cached_length==expected_position,'Cache did not advance for every token'
        record=dict(name=args.name,mode=args.mode,tokens=count,repeat=repeat,warmup=warmup,
            decode_tokens=count-1,decode_seconds=elapsed,tokens_per_s=(count-1)/elapsed,
            ttft_ms=ttft*1000,peak_allocated_mib=torch.cuda.max_memory_allocated()/2**20,
            peak_reserved_mib=torch.cuda.max_memory_reserved()/2**20,
            output_tokens=output_ids)
        with (out/'runs.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(record)+'\n')
        print(json.dumps({k:v for k,v in record.items() if k!='output_tokens'}),flush=True)
        return record

    with torch.inference_mode():
        status('warming')
        run(32,0,True)
        if conv is not None:
            metadata['native_calls_during_warmup']=dict(native)
            assert native['fwd']>0 and native['update']>0,'Native convolution was never called'
            for key,original in originals.items():setattr(conv,'causal_conv1d_'+key,original)
        if args.mode in ['compile','compile_graph','compile_graph8']:
            status('compiling')
            compiled=torch.compile(step,mode='reduce-overhead',fullgraph=True)
            compiled();torch.cuda.synchronize()
            metadata['compile']=True
        if args.mode in ['graph','graph_multi','compile_graph','compile_graph8']:
            status('capturing')
            prefill()
            stream=torch.cuda.Stream()
            stream.wait_stream(torch.cuda.current_stream())
            capture_step=compiled if compiled is not None else step
            with torch.cuda.stream(stream):
                for _ in range(3):capture_step()
            torch.cuda.current_stream().wait_stream(stream)
            torch.cuda.synchronize()
            graph=torch.cuda.CUDAGraph()
            with torch.cuda.graph(graph,stream=stream):capture_step()
            torch.cuda.synchronize()
            metadata['cuda_graph']=True
            if args.mode in ['graph_multi','compile_graph8']:
                block_graph=torch.cuda.CUDAGraph()
                with torch.cuda.graph(block_graph,stream=stream):
                    for j in range(8):
                        capture_step();block_output[j].copy_(token.view(()))
                torch.cuda.synchronize()
                metadata['graph_tokens_per_replay']=8
        run(128,0,True)
        (out/'environment.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
        rows=[]
        sizes=[128] if args.quick else [128,256,512,1024]
        repeats=1 if args.quick else 3
        for count in sizes:
            for repeat in range(1,repeats+1):
                status('measuring',tokens=count,repeat=repeat,completed=len(rows))
                rows.append(run(count,repeat))
    values=[r['tokens_per_s'] for r in rows]
    summary=dict(environment=metadata,runs=len(rows),mean=statistics.mean(values),maximum=max(values),minimum=min(values),
        stdev=statistics.stdev(values) if len(values)>1 else 0,
        cv_percent=statistics.stdev(values)/statistics.mean(values)*100 if len(values)>1 else 0,
        aggregate_tokens_per_s=sum(r['decode_tokens'] for r in rows)/sum(r['decode_seconds'] for r in rows),
        peak_allocated_mib=max(r['peak_allocated_mib'] for r in rows),
        peak_reserved_mib=max(r['peak_reserved_mib'] for r in rows))
    (out/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    status('complete',mean=summary['mean'])
    print('COMPLETE',json.dumps(summary),flush=True)

if __name__=='__main__':main()
