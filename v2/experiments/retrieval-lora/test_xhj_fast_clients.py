"""Real HTTP multi-session integration and rolling five-round context check."""
import concurrent.futures,json,time,uuid
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'tmp/qwen-fast-xhj-trial-20261020'
BASE='http://127.0.0.1:8631'
ids=['trial-'+uuid.uuid4().hex for _ in range(5)]
def ask(sid,message='A5L带载多少'):
    response=requests.post(BASE+'/api/ai/chat',json={'message':message,'mode':'expert','sessionId':sid},timeout=90)
    data=response.json()
    assert response.ok and data['status']=='answer',(response.status_code,data)
    assert data['sessionState']['id']==sid
    assert data['modelCallCount']==1 and data['toolCallCount']==1
    return data
start=time.perf_counter()
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
    results=list(executor.map(ask,ids))
concurrent_ms=(time.perf_counter()-start)*1000
assert len({r['sessionState']['id'] for r in results})==5
for _ in range(5):last=ask(ids[0])
rows=[json.loads(s) for s in (ROOT/'tmp/studio-fast-chat-20261020/chat-runs.jsonl').read_text(encoding='utf-8').splitlines()]
last_model=next(r for r in reversed(rows) if r.get('messages') and '当前客户问题：A5L带载多少' in r['messages'][-1]['content'])
history=last_model['messages'][-1]['content'].split('\n当前客户问题：')[0]
assert history.count('A5L带载多少')==4,'Model did not receive exactly the previous four user rounds'
saved=json.loads((OUT/'sessions'/f'{ids[0]}.json').read_text(encoding='utf-8'))
assert len([m for m in saved['messages'] if m['role']=='user'])==6,'Stored chat history was deleted'
report={'clients':5,'independent_session_ids':ids,'concurrent_wall_ms':concurrent_ms,
    'five_round_model_context':True,'six_round_archive_retained':True,
    'all_answer':True,'model_calls_per_question':1,'tool_calls_per_question':1,
    'results':[{'session':r['sessionState']['id'],'decision':r['decision'],'elapsed_ms':r['elapsedMs']} for r in results]}
(OUT/'five-client-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
