"""Independent field scoring from preserved raw outputs, including invalid protocols.

Never changes labels, predictions, prompt or adapter. JSON shape and extraction are
reported separately so a wrong kind does not erase a correctly extracted model.
"""
import json
import statistics
from pathlib import Path
from protocol import parse_raw,score

ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/retrieval-lora-20261020'


def summarize(tag,split='test'):
    rows={r['id']:r for r in map(json.loads,(WORK/f'data/{split}.jsonl').read_text(encoding='utf-8').splitlines())}
    records=json.loads((WORK/f'results/{tag}.raw.json').read_text(encoding='utf-8'))
    for record in records:
        try:action=json.loads(record['raw_output'].strip());record['valid_json']=True
        except ValueError:action=None;record['valid_json']=False
        try:parse_raw(record['raw_output']);record['protocol_valid']=True
        except (ValueError,TypeError,KeyError):record['protocol_valid']=False
        record['field_scores']={k:False for k in ['action','kind','models','chips','version','keywords','strict']}
        if isinstance(action,dict):
            try:record['field_scores']=score(action,rows[record['id']])
            except (ValueError,TypeError,AttributeError):pass
        record['field_scores']['strict']=record['field_scores']['strict'] and record['protocol_valid']
    n=len(records)
    def rate(metric,indices):
        return dict(n=len(indices),correct=sum(records[i]['field_scores'][metric] for i in indices),rate=sum(records[i]['field_scores'][metric] for i in indices)/len(indices) if indices else None)
    summary=dict(n=n,json_valid_rate=sum(r['valid_json'] for r in records)/n,protocol_valid_rate=sum(r['protocol_valid'] for r in records)/n,
                 mean_latency_s=statistics.mean(r['elapsed_s'] for r in records),aggregate_tokens_per_s=sum(r['output_tokens'] for r in records)/sum(r['elapsed_s'] for r in records),
                 mean_output_tokens=statistics.mean(r['output_tokens'] for r in records),output_under_100_rate=sum(r['output_tokens']<=100 for r in records)/n,
                 metrics={k:sum(r['field_scores'][k] for r in records)/n for k in ['action','kind','models','chips','version','keywords','strict']})
    applicable={
        'search_kind':('kind',[i for i,r in enumerate(records) if rows[r['id']]['target']['action']=='search']),
        'nonempty_models':('models',[i for i,r in enumerate(records) if rows[r['id']]['target'].get('models')]),
        'nonempty_chips':('chips',[i for i,r in enumerate(records) if rows[r['id']]['target'].get('chips')]),
        'specified_version':('version',[i for i,r in enumerate(records) if rows[r['id']]['target'].get('version')]),
    }
    summary['applicable_metrics']={k:rate(metric,indices) for k,(metric,indices) in applicable.items()}
    (WORK/f'results/{tag}.scored.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
    (WORK/f'results/{tag}.summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    return summary


if __name__=='__main__':
    baseline=summarize('baseline');tuned=summarize('lora');summarize('lora-validation','validation')
    path=WORK/'results/comparison.json';comparison=json.loads(path.read_text(encoding='utf-8'))
    comparison.update(baseline=baseline,lora=tuned,strict_delta=tuned['metrics']['strict']-baseline['metrics']['strict'],
                      scoring_note='字段指标独立于协议合法性；strict同时要求协议合法。固定标签未修改。')
    if (WORK/'results/baseline-1.7b.raw.json').exists():comparison['baseline_1_7b']=summarize('baseline-1.7b')
    path.write_text(json.dumps(comparison,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(baseline=baseline,lora=tuned),ensure_ascii=False))
