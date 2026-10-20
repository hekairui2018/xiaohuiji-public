"""Independent teacher-forced CUDA reference; diagnoses BF16 argmax divergence."""
import json
from studio_fast_engine import Engine,ROOT,torch
OUT=ROOT/'tmp/studio-fast-chat-20261020'
rows=[json.loads(s) for s in (OUT/'chat-runs.jsonl').read_text(encoding='utf-8').splitlines()]
row=next(r for r in reversed(rows) if r.get('adapter') and r.get('mode')=='compile+cuda_graph8' and
    r.get('messages',[])[-1]['content']=='请详细列出LED显示屏售后问题的分类方式。')
engine=Engine()
records=[]
from transformers import DynamicCache,StaticCache
with torch.inference_mode(),engine.adapter_context(True):
    cache=DynamicCache(config=engine.model.config)
    inputs=engine.inputs(row['messages'])
    out=engine.model(**inputs,past_key_values=cache,use_cache=True,logits_to_keep=1)
    for i,target in enumerate(row['output_ids']):
        logits=out.logits[0,-1].float()
        top=logits.topk(3)
        actual=int(logits.argmax().item())
        gap=float((logits[actual]-logits[target]).item())
        records.append({'position':i,'graph_token':target,'reference_token':actual,
            'logit_gap':gap,'reference_top3':top.indices.tolist(),'reference_scores':top.values.tolist()})
        out=engine.model(input_ids=torch.tensor([[target]],device='cuda'),
            past_key_values=cache,use_cache=True,logits_to_keep=1)
    cache=StaticCache(engine.model.config,max_cache_len=2048)
    out=engine.model(**inputs,past_key_values=cache,use_cache=True,logits_to_keep=1)
    slots=torch.arange(2048,device='cuda').view(1,1,1,-1)
    length=inputs.input_ids.shape[1]
    for i,target in enumerate(row['output_ids']):
        logits=out.logits[0,-1].float()
        actual=int(logits.argmax().item())
        records[i]['static_reference_token']=actual
        records[i]['static_logit_gap']=float((logits[actual]-logits[target]).item())
        records[i]['static_top3']=logits.topk(3).indices.tolist()
        records[i]['static_scores']=logits.topk(3).values.tolist()
        pos=torch.tensor([[length+i]],device='cuda')
        out=engine.model(input_ids=torch.tensor([[target]],device='cuda'),
            position_ids=pos.view(1,1,1).expand(4,1,1),
            attention_mask={'full_attention':slots<=pos.view(1,1,1,1),'linear_attention':None},
            past_key_values=cache,use_cache=True,logits_to_keep=1)
report={'mismatches':[r for r in records if r['graph_token']!=r['reference_token']],
    'max_logit_gap':max(r['logit_gap'] for r in records),'positions':records,
    'static_mismatches':[r for r in records if r['graph_token']!=r['static_reference_token']]}
(OUT/'lora-teacher-forcing.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'mismatches':len(report['mismatches']),'max_logit_gap':report['max_logit_gap'],
    'details':report['mismatches']}))
