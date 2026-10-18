"""Bounded, read-only proximity over existing FTS candidates and parsed blocks."""
import bisect
import json
import re
import time
import engine

# Text equivalences only; these neither select a business route nor infer a model.
ALIASES = [('闪烁', '闪屏', '频闪'), ('颜色异常', '颜色不正常', '偏色', '花屏'),
           ('模组', '模块'), ('排线', '扁平线'), ('Wi-Fi', 'WIFI', '无线'),
           ('搜不到', '搜索不到', '找不到'), ('带载', '像素负载')]
CASE_START = re.compile(r'(?m)^\s*(?:案例\s*[一二三四五六七八九十\d]+|\d+(?:\.\d+)+\s+[^\n]+|\d+[、.]\s*[^\n]{0,45}(?:芯片|模组|问题|异常|闪烁|花屏|黑屏)[^\n]*|(?:故障现象|问题现象|客户反馈)\s*[:：])')
MODEL_START = re.compile(r'(?mi)^\s*(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9]*(?:-[A-Z0-9]+)*(?:[ \t]*(?:控标点|技术参数|规格书|产品参数|用户手册)[^\n]*|[ \t]*$)')


def concepts_for(query, concepts=None):
    if concepts is None:
        concepts = re.findall(r'[A-Za-z0-9]+(?:[-_.+][A-Za-z0-9]+)*|[\u3400-\u9fff]{2,8}', query)
    if not isinstance(concepts, list) or not 1 <= len(concepts) <= 6:
        raise ValueError('invalid-concepts')
    groups = []
    for word in concepts:
        if not isinstance(word, str) or not word.strip() or len(word) > 32:
            raise ValueError('invalid-concept')
        words = [word.strip()]
        for group in ALIASES:
            if any(x.casefold() in word.casefold() for x in group):
                words.extend(group)
        groups.append(list(dict.fromkeys(words)))
    return groups


def positions(text, groups):
    hits = []
    for i, words in enumerate(groups):
        for word in words:
            # Atomic ASCII identities; R512 is never R512S.
            pattern = re.escape(word)
            if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.+-]*', word):
                pattern = r'(?<![A-Za-z0-9])' + pattern + r'(?![A-Za-z0-9])'
            for m in list(re.finditer(pattern, text, re.I))[:256]:
                hits.append({'concept': i, 'term': word, 'start': m.start(), 'end': m.end()})
    return sorted(hits, key=lambda h: h['start'])


def best_window(text, groups, width=900):
    hits = positions(text, groups)
    if not hits:
        return None
    # Compare distinct concepts first, then the shortest covering span, not raw
    # counts across a whole anthology. At most the bounded hit context is read.
    best = None
    for i, hit in enumerate(hits):
        window = [h for h in hits[i:] if h['start'] - hit['start'] <= width]
        coverage = len({h['concept'] for h in window})
        span = window[-1]['end'] - hit['start']
        key = (coverage, -span)
        if best is None or key > best[0]:
            best = (key, window)
    selected = best[1]
    return {'coverage': len({h['concept'] for h in selected}), 'span': selected[-1]['end'] - selected[0]['start'],
            'hits': selected, 'start': selected[0]['start'], 'end': selected[-1]['end']}


def context_unit(db, block_id, anchor=0):
    b = db.execute('SELECT * FROM blocks WHERE id=?', (block_id,)).fetchone()
    if not b:
        raise KeyError('unknown-block')
    locator = json.loads(b['locator'])
    # Rows and slides are independent records; never borrow another customer's row.
    if 'row' in locator or 'slide' in locator:
        rows = [b]
        boundary = 'row' if 'row' in locator else 'slide-paragraph'
    else:
        rows = db.execute('SELECT * FROM blocks WHERE hash=? AND ordinal BETWEEN ? AND ? ORDER BY ordinal',
                          (b['hash'], b['ordinal'] - 24, b['ordinal'] + 24)).fetchall()
        section = locator.get('section')
        if section:
            rows = [r for r in rows if json.loads(r['locator']).get('section') == section]
        boundary = 'section' if section else 'bounded-paragraphs-case-boundary-unverified'
    text = '\n'.join(r['text'] for r in rows)
    offsets = []
    cursor = 0
    target = 0
    for r in rows:
        offsets.append((cursor, cursor + len(r['text']), r))
        if r['id'] == block_id:
            target = cursor + min(max(int(anchor), 0), max(0, len(r['text']) - 1))
        cursor += len(r['text']) + 1
    matches=list(CASE_START.finditer(text))
    headings=[m for m in matches if re.match(r'\s*(?:案例\s*[一二三四五六七八九十\d]+|\d+[.、])',m.group())]
    # Keep a case's heading (and its model/chip) with the phenomenon. A labelled
    # phenomenon below an explicit case heading is not the start of another case.
    model_headings=list(MODEL_START.finditer(text))
    markers = sorted(set(m.start() for m in [*(headings or matches),*model_headings]))
    if markers and boundary not in ('row', 'slide-paragraph'):
        index = bisect.bisect_right(markers, target) - 1
        start = markers[index] if index >= 0 else 0
        end = markers[index + 1] if index + 1 < len(markers) else len(text)
        boundary = 'explicit-model-section' if model_headings and start in {m.start() for m in model_headings} else 'explicit-case-marker'
    else:
        start, end = 0, len(text)
    parts = []
    for low, high, row in offsets:
        if high <= start or low >= end:
            continue
        a, z = max(start, low) - low, min(end, high) - low
        parts.append({'blockId': row['id'], 'ordinal': row['ordinal'], 'locator': json.loads(row['locator']),
                      'charStart': a, 'charEnd': z, 'text': row['text'][a:z]})
    return {'text': text[start:end], 'parts': parts, 'boundary': boundary, 'sha256': b['hash'],
            'targetOffset': target - start, 'bounded': len(rows) >= 49}


def search(work, query, scope='text', concepts=None, models=None, version=None, chips=None, limit=4, documents=None):
    started = time.perf_counter()
    if scope not in ('text', 'cases', 'faq', 'products', 'firmware') or not isinstance(query, str) or not 1 <= len(query) <= 240:
        raise ValueError('invalid-query')
    groups = concepts_for(query, concepts)
    models, chips = models or [], chips or []
    if not isinstance(models, list) or len(models) > 4 or not isinstance(chips, list) or len(chips) > 4 or any(not isinstance(x, str) or len(x)>64 for x in models+chips):
        raise ValueError('invalid-constraints')
    authorized=None
    if documents is not None:
        if not isinstance(documents,list) or not 1<=len(documents)<=4 or any(not isinstance(n,str) or not n or len(n)>240 for n in documents):
            raise ValueError('invalid-documents')
        db=engine.connect(work,True)
        try:
            authorized={r['sha256'] for r in db.execute("SELECT sha256 FROM locations WHERE state='present' AND name IN ("+','.join('?' for _ in documents)+") AND sha256 IS NOT NULL",documents)}
        finally:db.close()
    # Reuse FTS5/BM25 and its pre-limit model/owner/version filters. No full scan.
    requested = models or [None]
    candidates = {}
    queries = [query]
    # Short concept queries recover a focused paragraph hidden by a broad OR list.
    queries += [' '.join(g[:2]) for g in groups[:4]]
    for model in requested:
        for q in queries:
            for row in engine.query(work, q, 'text', model, 24, authorized_keys=authorized, include_history=bool(documents or version))['results']:
                candidates.setdefault(row['blockId'], row)
            if len(candidates) >= 120:
                break
    db = engine.connect(work, True)
    ranked, seen = [], set()
    try:
        for row in list(candidates.values())[:120]:
            anchor_hits = positions(row['text'], groups)
            # One parsed page can contain several cases; evaluate each bounded case.
            for anchor in list(dict.fromkeys(h['start'] for h in anchor_hits))[:8]:
                unit = context_unit(db, row['blockId'], anchor)
                identity = (unit['sha256'], tuple((p['blockId'], p['charStart'], p['charEnd']) for p in unit['parts']))
                if identity in seen:
                    continue
                seen.add(identity)
                text = unit['text']
                if scope == 'faq' and not re.search(r'FAQ|FQA|常见问题|问答', row['name'], re.I):
                    continue
                if scope == 'cases' and not (re.search(r'案例|售后|问题总结|问题汇总',row['name']) or re.search(r'问题描述[：:]|问题现象[：:]|故障现象[：:]|客户反馈[：:]|处理方法[：:]|解决方法[：:]|处理结果[：:]|排查思路[：:]',text)):
                    continue
                if scope == 'firmware' and not re.search(r'固件|升级|firmware', row['name']+' '+text, re.I):
                    continue
                if scope == 'products' and not re.search(r'规格|参数|控标|产品|手册|Specification|Manual',row['name'],re.I):
                    continue
                present = engine.model_tokens(text) & engine.known_product_models()
                wanted = {engine.normalize_model(x) for x in models}
                if wanted and present and not wanted.intersection(present):
                    continue
                found_chips = set(re.findall(r'(?<![A-Z0-9])(?:ICN|ICND|FM|SM|MBI|LS)\d+[A-Z0-9]*(?![A-Z0-9])', text.upper()))
                if chips and found_chips and not found_chips.intersection(x.upper() for x in chips):
                    continue
                explicit_versions = re.findall(r'(?<![\d.])\d+\.\d+\.\d+(?:\.\d+)?(?![\d.])', text)
                if version and explicit_versions and version.lstrip('vV') not in explicit_versions:
                    continue
                window = best_window(text, groups)
                # Not a universal BM25 threshold: require more than one requested
                # independent concept in the same bounded local window.
                if not window or window['coverage'] < min(2, len(groups)):
                    continue
                low, high = max(0, window['start'] - 200), min(len(text), window['end'] + 300)
                hit_parts = []
                at = 0
                for part in unit['parts']:
                    for hit in window['hits']:
                        if at <= hit['start'] < at + len(part['text']):
                            hit_parts.append({**hit, 'blockId':part['blockId'], 'locator':part['locator'],
                                              'charStart':part['charStart']+hit['start']-at})
                    at += len(part['text']) + 1
                ranked.append({**row, 'text':text[low:high], 'scope':scope, 'readAnchor':anchor,
                    'proximity':{'conceptCount':len(groups),'matchedConcepts':window['coverage'], 'spanChars':window['span'],
                      'hits':hit_parts,'contextBoundary':unit['boundary'], 'contextBlockIds':[p['blockId'] for p in unit['parts']],
                      'excerptStart':low,'excerptEnd':high,'totalContextChars':len(text),'boundaryWindowLimited':unit['bounded']},
                    'constraints':{'requestedModels':models,'mentionedModels':sorted(present),'chips':sorted(found_chips),
                                   'versions':explicit_versions,'compatibilityConfirmed':False},
                    '_rank':(-window['coverage'],window['span'], -row.get('score',0))})
    finally:
        db.close()
    ranked.sort(key=lambda r:r['_rank'])
    results=[]
    for row in ranked[:min(max(int(limit),1),6)]:
        row.pop('_rank');results.append(row)
    return {'results':results,'candidateCount':len(candidates),'elapsedMs':round((time.perf_counter()-started)*1000,3),
            'semantics':'existing-FTS5-BM25-recall;distinct-concepts-in-bounded-case-window;not-compatibility'}


def read(work, block, anchor=0, offset=0):
    if int(offset)<0 or int(offset)>100000:
        raise ValueError('invalid-offset')
    db=engine.connect(work,True)
    try:
        unit=context_unit(db,int(block),int(anchor))
    finally:
        db.close()
    offset=int(offset);end=min(offset+6000,len(unit['text']))
    if offset>len(unit['text']):raise ValueError('offset-outside-context')
    parts=[];at=0
    for p in unit['parts']:
        low,high=max(offset,at),min(end,at+len(p['text']))
        if high>low:parts.append({**p,'text':p['text'][low-at:high-at], 'charStart':p['charStart']+low-at,'charEnd':p['charStart']+high-at})
        at+=len(p['text'])+1
    return {'blocks':parts,'boundary':unit['boundary'],'offset':offset,'nextOffset':end if end<len(unit['text']) else None,
            'totalChars':len(unit['text']),'boundaryWindowLimited':unit['bounded']}
