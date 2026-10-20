"""Resident BF16 chat decoder; reuse speed_lab's compiled, mutable-cache CUDA graph.

Only the explicitly named Fast-Greedy model selects greedy decoding. Normal honors
sampling. Each request resets all KV/SSM state; graph buffers never hold chat history.
"""
import contextlib
import json
import os
from pathlib import Path
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
TRITON = ROOT/'tmp/retrieval-lora-20261020/venv/Lib/site-packages/triton'
CACHE = Path(tempfile.gettempdir())/'xhj-qwen35-speed-lab'
os.environ.update(CUDA_PATH=str(TRITON/'backends/nvidia'), CC=str(TRITON/'runtime/tcc/tcc.exe'),
    TRITON_CACHE_DIR=str(CACHE/'triton'), TORCHINDUCTOR_CACHE_DIR=str(CACHE/'inductor'),
    TORCHINDUCTOR_COMPILE_THREADS='1', TOKENIZERS_PARALLELISM='false')
import torch
from transformers import AutoTokenizer, Qwen3_5ForConditionalGeneration, StaticCache, TextIteratorStreamer
from threading import Thread

MODEL = ROOT/'tmp/qwen35-08b-base'
ADAPTER = ROOT/'tmp/unsloth-studio-20261020/home/studio/outputs/qwen35-08b-base_1792467563'
CAPACITY = 16384
BUCKETS = (2048, CAPACITY)

class Engine:
    def __init__(self):
        start=time.perf_counter()
        assert torch.cuda.is_available() and torch.cuda.is_bf16_supported()
        self.tokenizer=AutoTokenizer.from_pretrained(MODEL, local_files_only=True)
        self.model=Qwen3_5ForConditionalGeneration.from_pretrained(MODEL, dtype=torch.bfloat16,
            device_map={'':'cuda:0'}, attn_implementation='sdpa', local_files_only=True).eval()
        assert all(p.device.type=='cuda' and p.dtype==torch.bfloat16 for p in self.model.parameters())
        self.adapter_attached=False
        self.graphs={}
        self.failures={}
        self.eos={self.tokenizer.convert_tokens_to_ids('<|im_end|>'), self.tokenizer.eos_token_id}
        torch.cuda.synchronize()
        self.load_seconds=time.perf_counter()-start
        self.ready_stats={'load_seconds':self.load_seconds}
        if ADAPTER.is_dir():
            adapter_start=time.perf_counter()
            with self.adapter_context(True):pass
            torch.cuda.synchronize()
            self.ready_stats['adapter_load_seconds']=time.perf_counter()-adapter_start

    def adapter_context(self, enabled):
        if not self.adapter_attached and enabled:
            from peft import PeftModel
            # BF16 Linear adapters do not use torchao. The inherited optional 0.15
            # quantization plugin is incompatible with this PEFT and is irrelevant here.
            import peft.tuners.lora.torchao as optional_quant
            optional_quant.is_torchao_available=lambda:False
            self.model=PeftModel.from_pretrained(self.model, str(ADAPTER), is_trainable=False,
                autocast_adapter_dtype=False).to(dtype=torch.bfloat16).eval()
            self.adapter_attached=True
            # Attaching hooks invalidates any compiled base graph. Keep it out of replay.
            self.graphs.clear()
        return self.model.disable_adapter() if self.adapter_attached and not enabled else contextlib.nullcontext()

    def inputs(self, messages):
        text=self.tokenizer.apply_chat_template(messages, tokenize=False,
            add_generation_prompt=True, enable_thinking=False)
        return self.tokenizer(text, return_tensors='pt', add_special_tokens=False).to('cuda:0')

    @torch.inference_mode()
    def prepare(self, adapter=False, capacity=2048):
        key=(adapter,capacity)
        if key in self.graphs or key in self.failures:return
        try:
            with self.adapter_context(adapter):
                start=time.perf_counter()
                state={}
                cache=StaticCache(self.model.config, max_cache_len=capacity)
                token=torch.zeros((1,1),dtype=torch.long,device='cuda')
                pos=torch.zeros((1,1),dtype=torch.long,device='cuda')
                slots=torch.arange(capacity,device='cuda').view(1,1,1,-1)
                def prefill(inputs):
                    cache.reset()
                    # Bound prefill temporary allocations for 16K prompts. Every
                    # chunk updates the same KV and recurrent DeltaNet states.
                    for begin in range(0,inputs.input_ids.shape[1],1024):
                        end=min(begin+1024,inputs.input_ids.shape[1])
                        out=self.model(input_ids=inputs.input_ids[:,begin:end],
                            attention_mask=inputs.attention_mask[:,:end],
                            past_key_values=cache,use_cache=True,logits_to_keep=1)
                    token.copy_(out.logits[:,-1,:].argmax(-1,keepdim=True))
                    pos.fill_(inputs.input_ids.shape[1])
                def step():
                    out=self.model(input_ids=token,position_ids=pos.view(1,1,1).expand(4,1,1),
                        attention_mask={'full_attention':slots<=pos.view(1,1,1,1),'linear_attention':None},
                        past_key_values=cache,use_cache=True,logits_to_keep=1)
                    token.copy_(out.logits[:,-1,:].argmax(-1,keepdim=True))
                    pos.add_(1)
                import collections,triton,causal_conv1d_cuda
                launches=collections.Counter()
                def enter(metadata):launches[metadata.get()['name']]+=1
                triton.knobs.runtime.launch_enter_hook.add(enter)
                try:
                    prefill(self.inputs([{'role':'user','content':'你好，请介绍一下你自己。'}]))
                    for _ in range(4):step()
                    torch.cuda.synchronize()
                finally:triton.knobs.runtime.launch_enter_hook.remove(enter)
                assert any('gated_delta' in name for name in launches),'FLA prefill kernel missing'
                assert any('fused_recurrent' in name for name in launches),'FLA decode kernel missing'
                # We record explicit graphs below. Disable the compiler's separate
                # automatic graph-tree manager (its thread-local state is unsafe in
                # this Windows HTTP worker); retain the compiled kernels themselves.
                compiled=torch.compile(step,options={'triton.cudagraphs':False},fullgraph=True)
                compiled();torch.cuda.synchronize()
                stream=torch.cuda.Stream();stream.wait_stream(torch.cuda.current_stream())
                with torch.cuda.stream(stream):
                    for _ in range(3):compiled()
                torch.cuda.current_stream().wait_stream(stream);torch.cuda.synchronize()
                graph=torch.cuda.CUDAGraph()
                with torch.cuda.graph(graph,stream=stream):compiled()
                block=torch.empty(8,dtype=torch.long,device='cuda')
                graph8=torch.cuda.CUDAGraph()
                with torch.cuda.graph(graph8,stream=stream):
                    for j in range(8):
                        compiled();block[j].copy_(token.view(()))
                torch.cuda.synchronize()
                state.update(cache=cache,token=token,pos=pos,prefill=prefill,graph=graph,
                    graph8=graph8,block=block,compiled=compiled,compile_seconds=time.perf_counter()-start)
                self.graphs[key]=state
                self.ready_stats[('adapter' if adapter else 'base')+'_'+str(capacity)]= {'compile_seconds':state['compile_seconds'],
                    'cache_capacity':capacity,'actual_fla_launches':dict(launches)}
        except Exception as exc:
            self.failures[key]=str(exc)
            self.ready_stats[str(key)+'_error']=str(exc)
            import traceback
            traceback.print_exc()

    @torch.inference_mode()
    def stream(self, payload, cancelled, stats):
        adapter='LoRA' in payload['model']
        fast='Fast-Greedy' in payload['model']
        max_tokens=min(int(payload.get('max_tokens') or 512),2048)
        messages=payload['messages']
        inputs=self.inputs(messages)
        length=inputs.input_ids.shape[1]
        if length+max_tokens>CAPACITY:raise ValueError('Input plus reserved output exceeds 16384 tokens; shorten the history or evidence.')
        capacity=next(c for c in BUCKETS if length+max_tokens<=c)
        key=(adapter,capacity)
        with self.adapter_context(adapter):
            if fast:self.prepare(adapter,capacity)
            supported=fast and key in self.graphs and not payload.get('tools')
            stats.update(mode='compile+cuda_graph8' if supported else 'normal',adapter=adapter,
                context_limit=CAPACITY,cache_capacity=capacity,
                prompt_tokens=length, compile_seconds=self.graphs.get(key,{}).get('compile_seconds'),
                fallback_reason=None if supported or not fast else self.failures.get(key,'context/tool shape unsupported'))
            if not supported:
                yield from self.normal(inputs,payload,cancelled,stats,max_tokens)
                return
            state=self.graphs[key]
            torch.cuda.reset_peak_memory_stats();torch.cuda.synchronize();start=time.perf_counter()
            state['prefill'](inputs);torch.cuda.synchronize()
            stats['ttft_ms']=(time.perf_counter()-start)*1000
            output=[int(state['token'].item())]
            emitted='';actual_steps=0;end=False;decode_start=time.perf_counter()
            while True:
                visible=output
                for i,token in enumerate(output):
                    if token in self.eos:
                        visible=output[:i];end=True;break
                text=self.tokenizer.decode(visible,skip_special_tokens=True)
                # Avoid emitting a half UTF-8 character; the next block may complete it.
                if text.endswith('\ufffd') and not end and len(output)<max_tokens:
                    text=text.rstrip('\ufffd')
                if text.startswith(emitted):
                    delta=text[len(emitted):]
                    if delta:yield delta
                    emitted=text
                if end or len(output)>=max_tokens or cancelled.is_set():break
                remaining=max_tokens-len(output)
                if remaining>=8:
                    state['graph8'].replay();new=state['block'].tolist();actual_steps+=8
                else:
                    state['graph'].replay();new=[int(state['token'].item())];actual_steps+=1
                output.extend(new)
            torch.cuda.synchronize();elapsed=time.perf_counter()-decode_start
            expected=length+actual_steps
            assert int(state['pos'].item())==expected,'Position did not advance'
            cached=state['cache'].get_seq_length()
            assert int(cached)==expected,'KV cache did not advance'
            stats.update(completion_tokens=len(visible),decode_tokens=max(0,len(visible)-1),
                decode_seconds=elapsed,tokens_per_s=max(0,len(visible)-1)/elapsed,
                computed_decode_steps=actual_steps,cache_position=expected,
                finish_reason='stop' if end else 'length',output_ids=visible,
                peak_allocated_mib=torch.cuda.max_memory_allocated()/2**20,
                peak_reserved_mib=torch.cuda.max_memory_reserved()/2**20)

    def normal(self,inputs,payload,cancelled,stats,max_tokens):
        from transformers import StoppingCriteria,StoppingCriteriaList
        class Cancel(StoppingCriteria):
            def __call__(self,*a,**kw):return cancelled.is_set()
        class TimedStreamer(TextIteratorStreamer):
            first_token=None
            prompt_seen=False
            def put(self,value):
                if not self.prompt_seen:self.prompt_seen=True
                elif self.first_token is None:
                    torch.cuda.synchronize();self.first_token=time.perf_counter()
                super().put(value)
        streamer=TimedStreamer(self.tokenizer,skip_prompt=True,skip_special_tokens=True,timeout=120)
        kwargs=dict(**inputs,max_new_tokens=max_tokens,do_sample=float(payload.get('temperature',0.6))>0,
            temperature=max(float(payload.get('temperature',0.6)),0.01),top_p=payload.get('top_p',0.95),
            use_cache=True,eos_token_id=list(self.eos),streamer=streamer,
            stopping_criteria=StoppingCriteriaList([Cancel()]),disable_compile=True)
        result={}
        def generate():
            try:
                with torch.inference_mode():result['ids']=self.model.generate(**kwargs)
            except Exception as exc:
                result['error']=exc;streamer.end()
        torch.cuda.synchronize();start=time.perf_counter();thread=Thread(target=generate);thread.start()
        text='';first=None
        try:
            for chunk in streamer:
                if first is None:first=time.perf_counter()
                text+=chunk
                yield chunk
        finally:
            cancelled.set() if thread.is_alive() and 'ids' not in result else None
            thread.join(120)
        if thread.is_alive():raise RuntimeError('Normal generation did not stop; refusing further model work.')
        if 'error' in result:raise result['error']
        torch.cuda.synchronize();finish=time.perf_counter()
        ids=result['ids'][0,inputs.input_ids.shape[1]:].tolist()
        first_token=streamer.first_token or finish
        visible=ids[:-1] if ids and ids[-1] in self.eos else ids
        elapsed=finish-first_token
        stats.update(completion_tokens=len(visible),ttft_ms=(first_token-start)*1000,
            decode_tokens=max(0,len(visible)-1),decode_seconds=elapsed,
            tokens_per_s=max(0,len(visible)-1)/max(elapsed,0.000001),wall_seconds=finish-start,
            peak_allocated_mib=torch.cuda.max_memory_allocated()/2**20,
            peak_reserved_mib=torch.cuda.max_memory_reserved()/2**20,
            output_ids=visible,finish_reason='stop' if len(visible)<max_tokens else 'length')
