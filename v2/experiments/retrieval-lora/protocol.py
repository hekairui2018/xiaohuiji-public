"""Isolated first-action protocol; never generates a customer repair answer."""
import json
import re

KINDS = ('products', 'resources', 'cases', 'faq', 'firmware', 'text', 'files')
SYSTEM = '''你是LED技术资料检索调度器。只输出一个简短JSON，不回答产品参数或维修答案，不输出思考。客户明确要查什么就按原话查，保留型号后缀、芯片和版本，不补造信息。action只能search或clarify。
search格式：{"action":"search","query":"短关键词","kind":"资料类型","goals":["检索目标"],"concepts":["关键词"],"models":["原话型号"],"chips":["原话芯片"]}。有准确三段或四段版本号才加version。型号使用客户原文，不自行补HD前缀。
kind：产品参数/型号对比products；固件文件firmware；软件怎么用faq；说明书/规格书/操作视频resources；明确查故障案例cases；技术原文text；按文件名找files。信息太含糊无法形成有效检索时输出{"action":"clarify","question":"一个关键问题"}。检索案例不代表确认原因。JSON尽量约100 tokens。'''


def validate(action):
    if not isinstance(action, dict):
        raise ValueError('expected-object')
    if action.get('action') == 'clarify':
        if set(action) != {'action', 'question'} or not isinstance(action['question'], str) or not 0 < len(action['question']) <= 400:
            raise ValueError('invalid-clarify')
        return action
    required = {'action', 'query', 'kind', 'goals', 'concepts'}
    allowed = required | {'models', 'chips', 'version'}
    if action.get('action') != 'search' or not required <= set(action) <= allowed:
        raise ValueError('invalid-search-keys')
    if action['kind'] not in KINDS or not isinstance(action['query'], str) or not 0 < len(action['query']) <= 240:
        raise ValueError('invalid-search')
    for key, minimum, maximum, size in [('goals', 1, 3, 120), ('concepts', 1, 6, 32), ('models', 0, 4, 64), ('chips', 0, 4, 64)]:
        values = action.get(key, [])
        if not isinstance(values, list) or not minimum <= len(values) <= maximum or any(not isinstance(v, str) or not 0 < len(v) <= size for v in values):
            raise ValueError('invalid-' + key)
    if 'version' in action and not re.fullmatch(r'[Vv]?\d+(?:\.\d+){2,3}', action['version']):
        raise ValueError('invalid-version')
    return action


def parse_raw(text):
    # No repair, grammar coercion or extraction from prose: report raw failures.
    return validate(json.loads(text.strip()))


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def score(action, row):
    expected = row['target']
    action_ok = action.get('action') == expected['action']
    kind_ok = action_ok and action.get('kind') == expected.get('kind')
    models_ok = set(action.get('models', [])) == set(expected.get('models', []))
    chips_ok = set(action.get('chips', [])) == set(expected.get('chips', []))
    version_ok = action.get('version') == expected.get('version')
    haystack = ' '.join([action.get('query', ''), *action.get('concepts', [])]).casefold()
    facts_ok = all(any(term.casefold() in haystack for term in alternatives) for alternatives in row.get('keyword_groups', [])) if expected['action'] == 'search' else action_ok
    return dict(action=action_ok, kind=kind_ok, models=models_ok, chips=chips_ok, version=version_ok, keywords=facts_ok,
                strict=all([action_ok, kind_ok, models_ok, chips_ok, version_ok, facts_ok]))
