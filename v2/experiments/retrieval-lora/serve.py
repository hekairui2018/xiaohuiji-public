"""Temporary loopback-only decision endpoint. Never executes tools or binds LAN."""
import os
import tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/retrieval-lora-20261020'
CACHE=Path(tempfile.gettempdir())/'xhj-retrieval-lora-20261020'
for variable,folder in [('TRITON_CACHE_DIR','triton'),('TORCHINDUCTOR_CACHE_DIR','inductor'),('UNSLOTH_COMPILE_LOCATION','unsloth')]:
    os.environ.setdefault(variable,str(CACHE/folder))
os.environ.setdefault('HF_HOME',str(WORK/'hf-cache'))
os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
import argparse
import faulthandler
import json
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from protocol import SYSTEM,compact,parse_raw


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=0);args=parser.parse_args()
    from unsloth import FastLanguageModel
    import torch
    model,tokenizer=FastLanguageModel.from_pretrained(model_name=str(WORK/'adapter'),max_seq_length=512,dtype=torch.bfloat16,load_in_4bit=False,local_files_only=True,trust_remote_code=False)
    FastLanguageModel.for_inference(model)
    # Compile/warm on the owning thread before readiness; first-request JIT is
    # otherwise mixed into the endpoint test and can exceed its socket timeout.
    warm=tokenizer.apply_chat_template([dict(role='system',content=SYSTEM),dict(role='user',content='你好')],tokenize=True,add_generation_prompt=True,enable_thinking=False)
    with torch.inference_mode():
        warm_ids=torch.tensor([warm],device='cuda')
        model.generate(input_ids=warm_ids,attention_mask=torch.ones_like(warm_ids),max_new_tokens=8,do_sample=False,pad_token_id=tokenizer.eos_token_id)
    lock=threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def reply(self,status,data,headers=None):
            body=compact(data).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)))
            for k,v in (headers or {}).items():self.send_header(k,str(v))
            self.end_headers();self.wfile.write(body)
        def do_GET(self):
            return self.reply(200 if self.path=='/health' else 404,dict(ok=self.path=='/health',mode='isolated-first-action-only',toolsExecuted=False))
        def do_POST(self):
            if self.path!='/decision':return self.reply(404,dict(error='not-found'))
            if self.headers.get('Origin') or self.headers.get('Forwarded') or self.headers.get('X-Forwarded-For'):return self.reply(403,dict(error='local-script-only'))
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=8192:return self.reply(413,dict(error='body-size'))
            try:
                body=json.loads(self.rfile.read(length));message=body['message']
                if not isinstance(message,str) or not 0<len(message)<=1000:raise ValueError('message-size')
            except (ValueError,KeyError):return self.reply(400,dict(error='invalid-message'))
            if not lock.acquire(blocking=False):return self.reply(409,dict(error='experiment-busy'))
            try:
                faulthandler.dump_traceback_later(60,repeat=False)
                prompt=tokenizer.apply_chat_template([dict(role='system',content=SYSTEM),dict(role='user',content=message)],tokenize=True,add_generation_prompt=True,enable_thinking=False)
                if len(prompt)>512:return self.reply(413,dict(error='prompt-too-long'))
                ids=torch.tensor([prompt],device='cuda');torch.cuda.synchronize();start=time.perf_counter()
                with torch.inference_mode():output=model.generate(input_ids=ids,attention_mask=torch.ones_like(ids),max_new_tokens=256,do_sample=False,pad_token_id=tokenizer.eos_token_id)
                torch.cuda.synchronize();elapsed=time.perf_counter()-start;tokens=output.shape[1]-ids.shape[1];raw=tokenizer.decode(output[0,ids.shape[1]:],skip_special_tokens=True)
                with (WORK/'results/interface-raw.jsonl').open('a',encoding='utf-8') as log:log.write(compact(dict(message=message,raw=raw,seconds=elapsed,tokens=tokens))+'\n')
                try:action=parse_raw(raw)
                except ValueError:return self.reply(422,dict(error='model-invalid-json',raw=raw))
                return self.reply(200,action,{'X-Inference-Seconds':elapsed,'X-Output-Tokens':tokens,'X-Tokens-Per-Second':tokens/elapsed})
            finally:faulthandler.cancel_dump_traceback_later();lock.release()
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    (WORK/'results/interface-runtime.json').write_text(compact(dict(port=server.server_port,pid=os.getpid(),host='127.0.0.1',run_id=os.environ.get('XHJ_EXPERIMENT_RUN_ID'))),encoding='utf-8')
    print('TEST_INTERFACE_READY '+str(server.server_port),flush=True)
    try:server.serve_forever()
    finally:server.server_close()


if __name__=='__main__':main()
