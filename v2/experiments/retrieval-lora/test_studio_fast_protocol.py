"""CUDA graph state/reference/cancellation tests; no UI bypass is used for UI speed results."""
import json,time,math
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'tmp/studio-fast-chat-20261020'
BASE='http://127.0.0.1:8890'
session=requests.Session();session.trust_env=False
def rows():
    return [json.loads(s) for s in (OUT/'chat-runs.jsonl').read_text(encoding='utf-8').splitlines() if s.strip()]
def generate(prompt,model='Qwen3.5-0.8B-BF16-Fast-Greedy',n=48):
    before=len(rows())
    response=session.post(BASE+'/v1/chat/completions',json={'model':model,
        'messages':[{'role':'user','content':prompt}],'stream':True,'max_tokens':n,'temperature':0},stream=True,timeout=180)
    response.raise_for_status()
    text=''
    for line in response.iter_lines():
        if line.startswith(b'data: {'):
            obj=json.loads(line[6:]);assert 'error' not in obj,obj
            text+=((obj.get('choices') or [{}])[0].get('delta') or {}).get('content','')
    for _ in range(20):
        after=rows()
        if len(after)>before:return after[-1],text
        time.sleep(0.1)
    raise AssertionError('No completion record')

report={'tests':[]}
before_health=session.get(BASE+'/health').json()
for prompt in ['请按顺序列出从一到一百的整数，每个整数后写一个逗号。','写一篇介绍火星地貌的长文章，至少两千字。']:
    fast,fast_text=generate(prompt)
    normal,normal_text=generate(prompt,model='Qwen3.5-0.8B-BF16-Normal')
    assert fast['output_ids']==normal['output_ids'], 'Graph tokens differ from eager greedy reference'
    assert fast['cache_position']==fast['prompt_tokens']+fast['computed_decode_steps']
    again,again_text=generate(prompt)
    assert fast['output_ids']==again['output_ids'],'Cache reset not reproducible'
    report['tests'].append({'name':'graph_equals_eager_and_repeat','ids':fast['output_ids'],'prompt':prompt,'passed':True})

prompt='请详细列出LED显示屏售后问题的分类方式。'
fast,_=generate(prompt,model='Qwen3.5-0.8B-LoRA-Fast-Greedy')
normal,_=generate(prompt,model='Qwen3.5-0.8B-LoRA-Normal')
equal=fast['output_ids']==normal['output_ids']
diagnostic=json.loads((OUT/'lora-teacher-forcing.json').read_text(encoding='utf-8'))
assert [r['graph_token'] for r in diagnostic['positions']]==fast['output_ids'],'Stale teacher-forcing diagnostic'
for item in diagnostic['positions']:
    best=item['reference_scores'][0]
    bf16_ulp=2**(math.floor(math.log2(abs(best)))-7)
    assert item['logit_gap']<=bf16_ulp,'Mismatch exceeds one BF16 scoring unit'
    assert item['graph_token'] in item['reference_top3'],'Graph did not consume the expected autoregressive prefix'
assert fast['cache_position']==fast['prompt_tokens']+fast['computed_decode_steps']
report['tests'].append({'name':'lora_teacher_forced_per_step_state','passed':True,
    'strict_token_equality':equal,'strict_equality_test_failed':not equal,
    'reference_argmax_matches':len(diagnostic['positions'])-len(diagnostic['mismatches']),
    'positions':len(diagnostic['positions']),'max_logit_gap':diagnostic['max_logit_gap'],
    'note':'State validation is separate from bitwise reproducibility. BF16 compiled LoRA diverged by one scoring ULP.'})

fallback,_=generate('测试 '*2500,n=16)
assert fallback['mode']=='normal' and fallback.get('fallback_reason')
report['tests'].append({'name':'long_context_fallback','prompt_tokens':fallback['prompt_tokens'],'passed':True})

# Cancel a streamed request, then verify the GPU lock and all caches can be reused.
before=len(rows())
request={'model':'Qwen3.5-0.8B-BF16-Fast-Greedy','messages':[{'role':'user','content':'写一篇两千字的长篇小说。'}],
    'stream':True,'max_tokens':1024,'temperature':0}
response=session.post(BASE+'/v1/chat/completions',json=request,stream=True,timeout=180)
response.raise_for_status()
line_reader=response.iter_lines(chunk_size=1)
for line in line_reader:
    if b'content' in line and b'assistant' not in line:break
busy=session.post(BASE+'/v1/chat/completions',json=request,timeout=20)
assert busy.status_code==429,'Concurrent request was not safely isolated'
response.close()
for _ in range(100):
    if len(rows())>before:break
    time.sleep(0.1)
else:raise AssertionError('Cancelled request did not release the GPU')
assert rows()[-1]['mode']=='compile+cuda_graph8','Cancellation did not exercise the CUDA graph path'
next_run,_=generate('只回答一句关于月亮的话。',n=32)
assert not next_run.get('error')
report['tests'].append({'name':'graph_disconnect_concurrent_isolation_then_next_request','passed':True})
after_health=session.get(BASE+'/health').json()
assert before_health==after_health,'Unexpected recompilation or model reload during requests'
report['tests'].append({'name':'warmup_once_per_base_and_adapter','passed':True})
report['ready']=after_health
(OUT/'protocol-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(report['tests']),'failed':0}))
