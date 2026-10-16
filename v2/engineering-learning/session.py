"""Append-only local apprenticeship records. No retrieval or device execution."""
import argparse
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'tmp' / 'engineering-learning'
PROMPT = Path(__file__).with_name('PROMPT.md').read_text(encoding='utf-8')


def write_once(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def case_path(case_id):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', case_id):
        raise ValueError('Use a short anonymous case ID')
    return WORK / case_id


def prepare(case_id, customer, split):
    if not customer.strip():
        raise ValueError('Customer message is empty')
    write_once(case_path(case_id) / 'case.json', {
        'caseId': case_id, 'customer': customer, 'split': split,
        'createdUTC': datetime.now(timezone.utc).isoformat(),
        'experienceStatus': '个人经验/暂未充分验证',
    })


def messages_for(folder, turn):
    case = read(folder / 'case.json')
    messages = [{'role': 'system', 'content': PROMPT},
                {'role': 'user', 'content': case['customer']}]
    # Explicit allowlist: engineer notes, comparisons and outcomes never enter baseline.
    for number in range(turn):
        receipt = read(folder / f'model-{number:03}.json')
        if not receipt.get('usable'):
            raise ValueError('Previous turn failed or was truncated; retain it and start a new case ID')
        messages.append(receipt['response']['choices'][0]['message'])
        feedback = read(folder / f'feedback-{number + 1:03}.json')
        messages.append({'role': 'user', 'content': json.dumps(feedback, ensure_ascii=False)})
    return messages


def run_model(case_id, turn):
    folder = case_path(case_id)
    destination = folder / f'model-{turn:03}.json'
    if destination.exists():
        raise FileExistsError('Frozen model turn already exists')
    messages = messages_for(folder, turn)
    request = {'model': 'bonsai', 'messages': messages, 'temperature': 0,
               'seed': 42, 'max_tokens': 2200, 'stream': False,
               'chat_template_kwargs': {'enable_thinking': False}}
    receipt = {'request': request, 'requestSHA256': hashlib.sha256(
        json.dumps(request, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
        'startedUTC': datetime.now(timezone.utc).isoformat(), 'usable': False}
    # Reserve before network call, so failures and concurrent attempts cannot overwrite history.
    write_once(destination, receipt)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req = urllib.request.Request('http://127.0.0.1:8080/v1/chat/completions',
            data=json.dumps(request, ensure_ascii=False).encode(),
            headers={'Content-Type': 'application/json'})
        with opener.open(req, timeout=180) as response:
            receipt['response'] = json.load(response)
        choice = receipt['response']['choices'][0]
        receipt['usable'] = (choice.get('finish_reason') == 'stop'
                             and bool(choice['message'].get('content')))
    except Exception as error:
        receipt['error'] = str(error)
    # Only complete our own reserved receipt; no command allows re-running this turn.
    destination.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return receipt


def record(case_id, kind, text, turn=0):
    folder = case_path(case_id)
    read(folder / 'case.json')
    if not text.strip():
        raise ValueError('Empty record')
    if kind == 'engineer':
        if not read(folder / 'model-000.json').get('usable'):
            raise ValueError('Freeze a usable baseline before collecting engineer judgement')
        target = 'engineer.json'
    elif kind == 'feedback':
        if turn < 1 or not read(folder / f'model-{turn - 1:03}.json').get('usable'):
            raise ValueError('Feedback requires a usable previous model turn')
        target = f'feedback-{turn:03}.json'
    elif kind == 'comparison':
        read(folder / 'engineer.json')
        target = 'comparison.json'
    else:
        raise ValueError('Unknown record kind')
    write_once(folder / target, {'kind': kind, 'text': text,
        'recordedUTC': datetime.now(timezone.utc).isoformat()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'model', 'engineer', 'feedback', 'comparison'])
    parser.add_argument('case_id')
    parser.add_argument('--input', type=Path, help='UTF-8 file; private text stays in ignored tmp')
    parser.add_argument('--turn', type=int, default=0)
    parser.add_argument('--split', choices=['train-candidate', 'validation', 'holdout'], default='train-candidate')
    args = parser.parse_args()
    if args.turn < 0:
        parser.error('turn must be nonnegative')
    if args.action == 'model':
        result = run_model(args.case_id, args.turn)
        print('Model receipt saved; usable=' + str(result['usable']))
        return
    if not args.input:
        parser.error('--input is required')
    text = args.input.read_text(encoding='utf-8-sig')
    if args.action == 'prepare':
        prepare(args.case_id, text, args.split)
    else:
        record(args.case_id, args.action, text, args.turn)
    print('Private record saved')


if __name__ == '__main__':
    main()
