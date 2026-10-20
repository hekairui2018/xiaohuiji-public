"""Create uploadable text JSONL, preserving the frozen experiment splits."""
import hashlib
import json
import shutil
from pathlib import Path
from transformers import AutoTokenizer
from protocol import SYSTEM, compact, validate

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT/'tmp/retrieval-lora-20261020/data'
DEST = ROOT/'tmp/qwen35-08b-training-kit'
MODEL = ROOT/'tmp/qwen35-08b-base'
DEST.mkdir(exist_ok=True)
tokenizer = AutoTokenizer.from_pretrained(str(MODEL), local_files_only=True, trust_remote_code=False)
seen_ids = set()
seen_questions = set()
seen_groups = set()
report = {'model_path':str(MODEL), 'human_reviewed':False, 'excluded_pending_cases':20,
          'purpose':'synthetic explicit first-retrieval intent pilot; not validated engineer judgments',
          'format':'text JSONL with official chat template, enable_thinking=False',
          'splits':{}, 'training_started':False}
for split in ['train', 'validation', 'test']:
    rows = [json.loads(line) for line in (SOURCE/f'{split}.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    assert all(row['status']=='policy_reviewed' for row in rows)
    ids = {row['id'] for row in rows}
    questions = {row['customer'].strip().casefold() for row in rows}
    groups = {row['group_id'] for row in rows}
    assert len(ids)==len(rows)==len(questions)
    assert not seen_ids & ids and not seen_questions & questions and not seen_groups & groups
    seen_ids.update(ids); seen_questions.update(questions); seen_groups.update(groups)
    records = []
    editable = []
    lengths = []
    for row in rows:
        validate(row['target'])
        messages = [{'role':'system','content':SYSTEM}, {'role':'user','content':row['customer']},
                    {'role':'assistant','content':compact(row['target'])}]
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False, enable_thinking=False)
        lengths.append(len(tokenizer.encode(text,add_special_tokens=False)))
        records.append({'text':text})
        editable.append({'messages':messages})
    folder = DEST if split!='test' else DEST/'evaluation-only-do-not-upload'
    folder.mkdir(exist_ok=True)
    path = folder/f'{split}.jsonl'
    path.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records),encoding='utf-8')
    edit_dir = DEST/'editable-messages'
    edit_dir.mkdir(exist_ok=True)
    if split!='test':
        (edit_dir/f'{split}.messages.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in editable),encoding='utf-8')
    report['splits'][split] = {'count':len(rows), 'path':str(path), 'max_tokens':max(lengths),
                             'min_tokens':min(lengths), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
assert report['splits']['train']['count']==48
assert max(r['max_tokens'] for r in report['splits'].values()) <= 1024
shutil.copyfile(SOURCE/'review.html',DEST/'review-candidates.html')
(DEST/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
