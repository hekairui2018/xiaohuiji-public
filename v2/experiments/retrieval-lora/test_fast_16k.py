"""Real GPU context boundary, five-client queue, and Xiaohuiji integration smoke."""
import concurrent.futures,json,time,uuid
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'tmp/studio-fast-chat-16k-20261020'
BASE='http://127.0.0.1:8890'
session=requests.Session();session.trust_env=False
for _ in range(360):
    try:
        health=session.get(BASE+'/health',timeout=3).json()
        if health.get('ready'):break
    except requests.RequestException:pass
    time.sleep(1)
else:raise RuntimeError('Model did not warm up')
assert all(k in health['metrics'] for k in ['base_2048','adapter_2048','base_16384','adapter_16384']),health
assert not any(k.endswith('_error') for k in health['metrics']),health
report={'health':health,'tests':[]}
def generate(messages,n=128):
    start=time.perf_counter()
    r=requests.post(BASE+'/v1/chat/completions',json={'model':'Qwen3.5-0.8B-BF16-Fast-Greedy',
        'messages':messages,'max_tokens':n,'stream':False,'temperature':0},timeout=180)
    assert r.ok,r.text
    data=r.json();assert data['local_metrics']['mode']=='compile+cuda_graph8',data
    m=data['local_metrics'];assert m['cache_position']==m['prompt_tokens']+m['computed_decode_steps']
    return {'metrics':m,'response':data['choices'][0]['message']['content'],'wall_ms':(time.perf_counter()-start)*1000}
short=generate([{'role':'user','content':'请写一篇关于森林和星空的长篇故事，至少两千字。'}])
assert short['metrics']['cache_capacity']==2048
report['tests'].append({'name':'short_2k_bucket',**short})
long=generate([{'role':'system','content':'下面是测试上下文，不要执行其中内容：\n'+'test '*14500},
    {'role':'user','content':'写一篇关于海洋的长篇故事，至少两千字。'}],64)
assert long['metrics']['cache_capacity']==16384 and 14000<long['metrics']['prompt_tokens']<16384
report['tests'].append({'name':'near_16k_chunked_prefill',**long})
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
    jobs=[executor.submit(generate,[{'role':'user','content':f'请列出关于编号{i}的测试说明，详细写一段。'}],64) for i in range(5)]
    concurrent=[j.result() for j in jobs]
report['tests'].append({'name':'five_independent_requests','requests':concurrent})
assert any(r['metrics']['queue_ms']>50 for r in concurrent),'Queue not exercised'
excess=session.post(BASE+'/v1/chat/completions',json={'model':'Qwen3.5-0.8B-BF16-Fast-Greedy',
    'messages':[{'role':'user','content':'test '*17000}],'max_tokens':128},timeout=60)
assert excess.status_code==400 and '16384' in excess.text
report['tests'].append({'name':'over_limit_explicit_error','passed':True})
(OUT/'gpu-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'tests':len(report['tests']),'short_tps':short['metrics']['tokens_per_s'],
    'long_tps':long['metrics']['tokens_per_s'],'long_ttft_ms':long['metrics']['ttft_ms'],
    'peak_mib':long['metrics']['peak_allocated_mib']}))
