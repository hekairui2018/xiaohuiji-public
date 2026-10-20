"""Loopback BF16 endpoint: Studio streaming and Xiaohuiji JSON transport, five admitted calls."""
import json,threading,time,traceback,uuid,select
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from studio_fast_engine import Engine,ROOT,ADAPTER,CAPACITY,BUCKETS
OUT=ROOT/'tmp/studio-fast-chat-20261020'
OUT.mkdir(parents=True,exist_ok=True)
engine=None
lock=threading.Lock()
admission=threading.BoundedSemaphore(5)
MODELS=['Qwen3.5-0.8B-BF16-Fast-Greedy','Qwen3.5-0.8B-BF16-Normal']
if ADAPTER.is_dir():MODELS+=['Qwen3.5-0.8B-LoRA-Fast-Greedy','Qwen3.5-0.8B-LoRA-Normal']

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def reply(self,status,obj):
        data=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.send_header('Connection','close');self.end_headers();self.wfile.write(data);self.close_connection=True
    def body(self):
        size=int(self.headers.get('Content-Length','0'))
        if not 0<size<1000000:raise ValueError('Invalid request size')
        return json.loads(self.rfile.read(size))
    def do_GET(self):
        if self.path=='/v1/models':self.reply(200,{'object':'list','data':[{'id':m,'object':'model','owned_by':'local-bf16','context_length':CAPACITY} for m in MODELS]})
        elif self.path=='/health':self.reply(200,{'service':'xhj-studio-fast-chat','ready':engine is not None,'context_tokens':CAPACITY,'max_admitted_requests':5,'metrics':engine.ready_stats if engine else {}})
        elif self.path=='/props':self.reply(200,{'default_generation_settings':{'n_ctx':CAPACITY}})
        else:self.reply(404,{'error':'Not found'})
    def do_POST(self):
        if self.path=='/tokenize':
            if engine is None:return self.reply(503,{'error':'Model warming up'})
            try:return self.reply(200,{'tokens':engine.tokenizer.encode(self.body().get('content',''),add_special_tokens=False)})
            except Exception as exc:return self.reply(400,{'error':str(exc)})
        if self.path!='/v1/chat/completions':return self.reply(404,{'error':'Not found'})
        if engine is None:return self.reply(503,{'error':'Model warming up'})
        try:payload=self.body()
        except Exception as exc:return self.reply(400,{'error':str(exc)})
        if payload.get('model') not in MODELS:return self.reply(400,{'error':'Unknown local model'})
        if payload.get('tools'):return self.reply(400,{'error':'Use Xiaohuiji JSON actions; native tools are not supported.'})
        if not payload.get('messages') or any(not isinstance(m.get('content'),str) for m in payload['messages']):return self.reply(400,{'error':'Text messages required'})
        if not admission.acquire(blocking=False):return self.reply(429,{'error':'Five requests already active or queued; retry shortly.'})
        acquired=False;cancelled=threading.Event()
        stats={'id':uuid.uuid4().hex,'created':time.time(),'model':payload['model'],'messages':payload['messages'],'max_tokens':payload.get('max_tokens')}
        iterator=None
        try:
            queued=time.perf_counter()
            acquired=lock.acquire(timeout=180)
            stats['queue_ms']=(time.perf_counter()-queued)*1000
            if not acquired:return self.reply(429,{'error':'GPU queue deadline exceeded'})
            # A closed queued client must not consume a GPU generation. Request
            # body is already consumed, so readability here means EOF/extra data.
            if select.select([self.connection],[],[],0)[0]:
                cancelled.set();stats['cancelled']=True;return
            iterator=engine.stream(payload,cancelled,stats)
            streaming=bool(payload.get('stream',False))
            if streaming:
                self.send_response(200);self.send_header('Content-Type','text/event-stream; charset=utf-8');self.send_header('Cache-Control','no-cache');self.send_header('Connection','close');self.end_headers()
            def send(obj):
                self.wfile.write(('data: '+json.dumps(obj,ensure_ascii=False)+'\n\n').encode());self.wfile.flush()
            def chunk(delta,reason=None,**extra):
                return dict(id=stats['id'],object='chat.completion.chunk',created=int(stats['created']),model=payload['model'],choices=[{'index':0,'delta':delta,'finish_reason':reason}],**extra)
            text=''
            if streaming:send(chunk({'role':'assistant','content':''}))
            for delta in iterator:
                text+=delta
                if streaming:send(chunk({'content':delta}))
            n=stats.get('completion_tokens',0);p=stats.get('prompt_tokens',0)
            usage={'prompt_tokens':p,'completion_tokens':n,'total_tokens':p+n}
            timings={'prompt_n':p,'prompt_ms':stats.get('ttft_ms',0),'predicted_n':max(0,n-1),'predicted_ms':stats.get('decode_seconds',0)*1000,'predicted_per_second':stats.get('tokens_per_s'),'prompt_per_second':p*1000/max(stats.get('ttft_ms',0),0.001)}
            extra={'usage':usage,'timings':timings,'local_metrics':{k:v for k,v in stats.items() if k not in ('messages','output_ids')}}
            if streaming:
                send(chunk({},stats.get('finish_reason','stop'),**extra));self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
            else:self.reply(200,dict(id=stats['id'],object='chat.completion',model=payload['model'],choices=[{'index':0,'message':{'role':'assistant','content':text},'finish_reason':stats.get('finish_reason','stop')}],**extra))
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):cancelled.set();stats['cancelled']=True
        except Exception as exc:
            stats['error']=str(exc);traceback.print_exc()
            try:
                if payload.get('stream'):self.wfile.write(('data: '+json.dumps({'error':{'message':str(exc)}})+'\n\n').encode());self.wfile.flush()
                else:self.reply(400 if isinstance(exc,ValueError) else 500,{'error':{'message':str(exc)}})
            except OSError:pass
        finally:
            cancelled.set()
            if iterator is not None:iterator.close()
            self.close_connection=True
            with (OUT/'chat-runs.jsonl').open('a',encoding='utf-8') as stream:stream.write(json.dumps(stats,ensure_ascii=False)+'\n')
            if acquired:lock.release()
            admission.release()

def load():
    global engine
    try:
        instance=Engine()
        for capacity in BUCKETS:
            instance.prepare(False,capacity)
            if instance.adapter_attached:instance.prepare(True,capacity)
        engine=instance
        (OUT/'ready.json').write_text(json.dumps(engine.ready_stats,indent=2),encoding='utf-8')
    except Exception:traceback.print_exc()

if __name__=='__main__':
    threading.Thread(target=load,daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1',8890),Handler).serve_forever()
