"""Opt-in native document boundaries. No OCR, source edits or compatibility inference.

The output is the existing engine block/locator format, so the same FTS, role
index, source-span verification and scoped read API can consume it.
"""
import collections
import json
import re
from pathlib import Path

import engine

REVISION = 'native-paragraphs-1'
BULLET = re.compile(r'^\s*[•●○▪◆\uf0b7]\s*')
VISUAL = re.compile(r'如下图|如图|见图|下图|上图|图示|shown (?:below|above)|following (?:figure|image)', re.I)


def title_level(text, size=0, body_size=10, bold=False):
    text = text.strip()
    if not text or len(text) > 95 or re.search(r'\.{3,}|…{2,}|·{3,}', text):
        return None
    if re.match(r'^第[一二三四五六七八九十百\d]+[章节篇]', text):
        return 1
    if re.match(r'^[一二三四五六七八九十]+[、．.]\s*\S', text):
        return 2
    if re.match(r'^\d+(?:\.\d+){1,4}\s*[^\d.\s]', text) and (bold or size > body_size * 1.04):
        return 2 + text.split()[0].count('.')
    if re.match(r'^\d+[.、]\s*[^\d\s]', text) and (bold or size > body_size * 1.12):
        return 2
    return None


def box(items):
    return [round(min(x['x0'] for x in items), 2), round(min(x['top'] for x in items), 2),
            round(max(x['x1'] for x in items), 2), round(max(x['bottom'] for x in items), 2)]


def inside(obj, bbox):
    return bbox[0] <= (obj['x0'] + obj['x1']) / 2 <= bbox[2] and bbox[1] <= (obj['top'] + obj['bottom']) / 2 <= bbox[3]


def host_requirements(section, rows):
    labels = ' '.join(str(r[0] or '') for r in rows if r)
    return bool(re.search(r'推荐配置|运行环境|系统要求|电脑配置|硬件要求|system requirements', section, re.I)
                and sum(bool(re.search(p, labels, re.I)) for p in ['CPU|处理器', '内存|memory', '显卡|GPU', '硬盘|磁盘', '操作系统']) >= 3)


def extract_pdf(path):
    import pdfplumber
    blocks, details = [], {'parser': REVISION, 'ocrPerformed': False, 'ocrPendingPages': [],
                           'rotatedTextPages': [], 'tableGeometry': 'native-ruling-lines', 'textBoundaryReviewed': False}
    stack, serial = [], 0
    with pdfplumber.open(path) as pdf:
        details['pages'] = len(pdf.pages)
        # Only repeated margin text is removed. Body repetitions and qualifiers
        # are preserved; rotated diagram labels remain explicitly unparsed.
        margins = collections.Counter()
        def native(obj):
            if obj.get('object_type') != 'char':
                return True
            matrix = obj.get('matrix', (1, 0, 0, 1))
            return abs(matrix[1]) < 0.001 and abs(matrix[2]) < 0.001
        for raw in pdf.pages:
            page = raw.filter(native)
            for line in page.extract_text_lines(return_chars=False):
                if line['top'] < raw.height * .1 or line['bottom'] > raw.height * .92:
                    margins[re.sub(r'\s+', '', line['text'])] += 1
            raw.close()
        for page_number, raw in enumerate(pdf.pages, 1):
            page = raw.filter(native)
            excluded = sum(not native(c) for c in raw.chars)
            if excluded:
                details['rotatedTextPages'].append(page_number)
            chars = page.chars
            if len(''.join(c['text'] for c in chars).strip()) < 15:
                details['ocrPendingPages'].append(page_number)
            sizes = collections.Counter(round(c['size'], 1) for c in chars if c['text'].strip())
            body_size = sizes.most_common(1)[0][0] if sizes else 10
            tables = page.find_tables()
            events = []
            for i, table in enumerate(tables, 1):
                rows = table.extract(x_tolerance=2, y_tolerance=3)
                if not rows or not any(any(c for c in r) for r in rows):
                    continue
                events.append({'type': 'table', 'top': table.bbox[1], 'bottom': table.bbox[3],
                               'bbox': list(table.bbox), 'table': i, 'rows': rows})
            for line in page.extract_text_lines(x_tolerance=2, y_tolerance=3):
                value = line['text'].strip()
                if not value or any(inside(line, t.bbox) for t in tables):
                    continue
                margin = line['top'] < raw.height * .1 or line['bottom'] > raw.height * .92
                identity = re.sub(r'\s+', '', value)
                if margin and (margins[identity] >= 2 or re.fullmatch(r'\d+', value) or re.search(r'https?://|www\.', value)):
                    continue
                lc = line.pop('chars', [])
                size = max((c['size'] for c in lc), default=body_size)
                bold = any(re.search('bold|黑体', c.get('fontname', ''), re.I) for c in lc)
                events.append({**line, 'type': 'line', 'text': value, 'size': size,
                               'level': title_level(value, size, body_size, bold)})
            events.sort(key=lambda x: (x['top'], x.get('x0', x.get('bbox', [0])[0])))
            pending = []
            def emit(text, kind, bbox, **extra):
                if not text.strip():
                    return
                locator = {'page': page_number, 'bbox': [round(x, 2) for x in bbox],
                           'structure': REVISION, 'unitKind': kind, 'section': stack[-1]['text'] if stack else '',
                           'sectionId': stack[-1]['id'] if stack else None,
                           'sectionPath': [s['text'] for s in stack],
                           'headingOrdinals': [s['ordinal'] for s in stack],
                           'visualContextRequired': bool(VISUAL.search(re.sub(r'\s+', '', text))) or bool(re.search(r'如下\s*$', text)), **extra}
                blocks.append({'text': text.strip(), 'locator': locator})
            def flush():
                if pending:
                    emit('\n'.join(x['text'] for x in pending), 'bullet' if BULLET.match(pending[0]['text']) else 'paragraph', box(pending))
                    pending.clear()
            for event in events:
                if event['type'] == 'table':
                    flush()
                    rows = event['rows']
                    subject = 'software-host-computer' if host_requirements(stack[-1]['text'] if stack else '', rows) else 'document-table'
                    # Whole native table preserves labels, units and conditions.
                    # Cell boundaries remain in the locator, not invented from whitespace.
                    emit('\n'.join(' | '.join((c or '').replace('\n', ' / ') for c in r) for r in rows), 'table', event['bbox'],
                         table=event['table'], cells=rows, contextSubject=subject,
                         uses=['host_requirements', 'parameter'] if subject == 'software-host-computer' else ['parameter'])
                elif event['level']:
                    flush()
                    while stack and stack[-1]['level'] >= event['level']:
                        stack.pop()
                    serial += 1
                    stack.append({'text': event['text'], 'id': f'section-{serial}', 'level': event['level'], 'ordinal': len(blocks)})
                    emit(event['text'], 'heading', box([event]))
                else:
                    previous = pending[-1] if pending else None
                    # Wrapped lines belong to the same paragraph/bullet. A new
                    # bullet, blank-line gap or enumerated task starts a new one.
                    gap = event['top'] - previous['bottom'] if previous else 0
                    continuation = previous and (BULLET.match(pending[0]['text']) or previous['x1'] >= raw.width * .87)
                    if previous and (BULLET.match(event['text']) or gap > max(26, body_size * 2.5) and not continuation
                                     or gap > max(60, body_size * 6)
                                     or re.match(r'^\s*(?:\d+[、.)）]|步骤\s*\d|注[：:]|备注[：:]|注意[：:])', event['text'])):
                        flush()
                    pending.append(event)
            flush()
            raw.close()
    details.update({'blocks': len(blocks), 'tableCount': sum(b['locator']['unitKind'] == 'table' for b in blocks),
                    'visualReferences': sum(b['locator']['visualContextRequired'] for b in blocks)})
    return {'state': 'parsed-ocr-pending' if details['ocrPendingPages'] else 'parsed', 'blocks': blocks, 'details': details}


def extract(path):
    path = Path(path)
    if path.suffix.lower() == '.pdf':
        return extract_pdf(path)
    result = engine.extract(path)
    # Native Word paragraphs/rows already have reliable structural locators.
    for b in result['blocks']:
        loc = b['locator']
        loc.update(structure=REVISION, unitKind='table-row' if 'row' in loc else 'paragraph',
                   sectionId=loc.get('section') or None, sectionPath=[loc['section']] if loc.get('section') else [],
                   visualContextRequired=bool(VISUAL.search(b['text'])))
    return result


def units_for(blocks, role):
    """Literal paragraph/table spans; a manual task restores its own section."""
    import role_index
    locs = [json.loads(b['locator']) for b in blocks]
    prerequisites = {}
    for i, (b, loc) in enumerate(zip(blocks, locs)):
        if loc.get('unitKind') == 'heading':
            continue
        if re.search(r'前提|操作前|准备工作|注意事项|Prerequisite|Before you', b['text'], re.I) and len(b['text']) <= 2000:
            prerequisites.setdefault(loc.get('sectionId'), []).append(b)
    groups = []
    for b, loc in zip(blocks, locs):
        if loc.get('unitKind') == 'heading':
            continue
        key = loc.get('sectionId') if role == 'operation' else None
        same_section = groups and json.loads(groups[-1][1][-1]['locator']).get('sectionId') == loc.get('sectionId')
        qualifier = re.match(r'^\s*(?:注[：:]|备注[：:]|注意[：:]|条件[：:]|Note[：:])', b['text'], re.I)
        if groups and (key and groups[-1][0] == key or role == 'parameter' and same_section and qualifier):
            groups[-1][1].append(b)
        else:
            groups.append((key, [b]))
    for key, group in groups:
        first = json.loads(group[0]['locator'])
        ordinals = first.get('headingOrdinals', [])
        parents = [blocks[i] for i in ordinals if 0 <= i < len(blocks) and blocks[i]['id'] not in {b['id'] for b in group}]
        prefix = []
        for parent in parents:
            prefix.append(parent)
            if role == 'operation':
                sid = json.loads(parent['locator']).get('sectionId')
                prefix.extend(b for b in prerequisites.get(sid, []) if b['ordinal'] < group[0]['ordinal'] and b['id'] not in {b['id'] for b in group})
        yield {'spans': [role_index.span(b, role='condition') for b in prefix] + [role_index.span(b) for b in group],
               'heading': ' / '.join(first.get('sectionPath', [])), 'complete': False,
               'basis': 'native-section-task' if key else 'native-' + first.get('unitKind', 'paragraph'),
               'toc': bool(re.search(r'\.{3,}|…{2,}', '\n'.join(b['text'] for b in group)))}
