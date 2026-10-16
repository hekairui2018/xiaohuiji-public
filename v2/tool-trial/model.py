"""Streaming native-tool client for existing single-slot Bonsai; no model startup."""
import hashlib,json,subprocess,threading,time,urllib.request
from common import WORK,save
BASE='http://127.0.0.1:8080'
LOCAL_HTTP=urllib.request.build_opener(urllib.request.ProxyHandler({}))

def post(path,payload,timeout=180):
 req=urllib.request.Request(BASE+path,data=json.dumps(payload,ensure_ascii=False).encode(),headers={'Content-Type':'application/json'})
 return LOCAL_HTTP.open(req,timeout=timeout)

def context_tokens(payload):
 try:
  with post('/apply-template',payload,10) as r:prompt=json.loads(r.read())['prompt']
  with post('/tokenize',{'content':prompt,'add_special':False},10) as r:count=len(json.loads(r.read())['tokens'])
  return count,'llama-template-and-tokenizer'
 except Exception:return len(json.dumps(payload,ensure_ascii=False))*2,'conservative-character-upper-bound-not-actual-token-count'

def infer(call_id,messages,tools=None,choice=None,budget=8192):
 target=WORK/'calls'/(call_id+'.json');target.parent.mkdir(exist_ok=True,parents=True)
 payload={'model':'bonsai','messages':messages,'temperature':0,'seed':42,'max_tokens':640,'stream':True,'stream_options':{'include_usage':True},'chat_template_kwargs':{'enable_thinking':False}}
 if tools:payload.update({'tools':tools,'tool_choice':choice or 'auto','parallel_tool_calls':False})
 fingerprint=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
 if target.exists():
  previous=json.loads(target.read_text(encoding='utf8'))
  if previous['requestSHA256']!=fingerprint:raise RuntimeError('Immutable call ID reused with different prompt')
  return previous
 count,method=context_tokens(payload);receipt={'callId':call_id,'request':payload,'requestSHA256':fingerprint,'contextBudget':budget,'promptTokenCheck':count,'promptCountMethod':method,'startedUnix':time.time(),'events':[],'gpuSamples':[]}
 if count+640>budget:receipt.update({'error':'context-budget-exceeded-no-evidence-truncated','seconds':0});save(target,receipt);return receipt
 start=time.perf_counter();stop=threading.Event()
 def gpu():
  while not stop.is_set():
   try:s=subprocess.check_output(['nvidia-smi','--query-gpu=memory.used,utilization.gpu','--format=csv,noheader,nounits'],timeout=3,creationflags=0x08000000).decode().strip();receipt['gpuSamples'].append({'elapsed':round(time.perf_counter()-start,3),'sample':s})
   except Exception:pass
   stop.wait(5)
 worker=threading.Thread(target=gpu,daemon=True);worker.start();content=[];calls={}
 try:
  with post('/v1/chat/completions',payload) as response:
   for raw in response:
    if not raw.startswith(b'data:'):continue
    data=raw[5:].strip()
    if data==b'[DONE]':break
    event=json.loads(data);receipt['events'].append(event)
    if event.get('usage'):receipt['usage']=event['usage']
    if event.get('timings'):receipt['timings']=event['timings']
    for item in event.get('choices',[]):
     delta=item.get('delta',{});piece=delta.get('content') or ''
     if piece:content.append(piece)
     tool_deltas=delta.get('tool_calls',[])
     if (piece or tool_deltas) and 'firstTokenSeconds' not in receipt:receipt['firstTokenSeconds']=round(time.perf_counter()-start,3)
     for tc in tool_deltas:
      row=calls.setdefault(tc.get('index',0),{'id':'','type':'function','function':{'name':'','arguments':''}})
      if tc.get('id'):row['id']=tc['id']
      fn=tc.get('function',{})
      if fn.get('name'):row['function']['name']+=fn['name']
      if fn.get('arguments'):row['function']['arguments']+=fn['arguments']
     if item.get('finish_reason'):receipt['finishReason']=item['finish_reason']
  receipt['message']={'role':'assistant','content':''.join(content)}
  if calls:receipt['message']['tool_calls']=[calls[k] for k in sorted(calls)]
 except Exception as e:receipt['error']=repr(e)
 finally:stop.set();worker.join(timeout=4);receipt['seconds']=round(time.perf_counter()-start,3);save(target,receipt)
 return receipt
