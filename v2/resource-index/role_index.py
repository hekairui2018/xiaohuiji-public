"""Optional role-aware shadow index derived ONLY from registered parsed blocks.

The source catalogue and originals are opened read-only.  Roles describe evidence
use, not product compatibility.  PDF layout is never reconstructed as a table.
"""
import argparse
import collections
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

import engine
from catalog_metadata import analyze
from current_documents import historical_locations
import proximity

REVISION = 'role-shadow-3'
DEFAULT_INDEX = getattr(engine, 'SOURCE_PROJECT', engine.PROJECT) / 'tmp/customer-service-20261023/role-index'
ROLES = {'parameter', 'operation', 'firmware', 'software', 'video', 'case', 'faq', 'document'}
MAX_UNIT = 12000
J = engine.J


def line_identity(line):
    return re.sub(r'\s+','',line)


def ranking_line(line, repeated_lines):
    value = line.strip()
    # URL/copyright/company headers are not parameter values or operation
    # instructions. Their original text is retained in every read response.
    boilerplate = bool(re.search(r'https?://|www\.|版权所有|copyright|©|(?:股份|有限)公司',value,re.I))
    marketing = bool(re.search(r'[!！]',value) and not re.search(r'\d|注意|警告|禁止|不要|切勿',value))
    if line_identity(value) in repeated_lines or boilerplate or marketing:
        return ' '*len(line.rstrip('\r\n')) + line[len(line.rstrip('\r\n')):]
    return line


def fingerprint(work):
    base = Path(work) / 'resources.db'
    # SQLite may create/remove an empty WAL while opening a read-only WAL-mode
    # database. It carries no committed content and must not mark a build stale.
    return [(p.name, p.stat().st_size, p.stat().st_mtime_ns)
            for p in (base, Path(str(base) + '-wal')) if p.exists() and (p == base or p.stat().st_size)]


def index_path(folder):
    folder = Path(folder).resolve()
    if folder.suffix == '.db':
        target = folder
        folder = folder.parent
    else:
        target = folder / 'role-index.db'
    allowed = (getattr(engine, 'SOURCE_PROJECT', engine.PROJECT) / 'tmp').resolve()
    if folder != allowed and allowed not in folder.parents:
        raise ValueError('role-index-must-stay-in-project-tmp')
    return target


def file_role(row):
    ext = row['extension'].lower()
    if ext in ('.bin', '.zbin') or ext == '.img' and re.search(r'固件|firmware', row['path'], re.I):
        return 'firmware'
    if ext in ('.exe', '.msi', '.apk'):
        return 'software'
    if ext in ('.mp4', '.webm', '.mov', '.avi', '.wmv', '.mkv'):
        return 'video'
    return 'document'


def body_role(name, meta):
    if meta.get('kind') == 'spec':
        return 'parameter'
    if meta.get('kind') == 'manual':
        return 'operation'
    if re.search(r'FAQ|FQA|常见问题|问答', name, re.I):
        return 'faq'
    if re.search(r'案例|售后|问题总结|问题汇总', name):
        return 'case'
    # A filename remains an explicit, weaker classification basis.
    if re.search(r'规格书|specifications?', name, re.I):
        return 'parameter'
    if re.search(r'说明书|操作手册|用户手册|manual', name, re.I):
        return 'operation'
    return 'document'


def span(block, start=0, end=None, role='body'):
    return {'blockId': block['id'], 'start': start,
            'end': len(block['text']) if end is None else end,
            'textHash': hashlib.sha256(block['text'].encode('utf8')).hexdigest(),
            'indexedTextHash': block['text_hash'], 'role': role,
            'locator': json.loads(block['locator'])}


def extract_spans(blocks, start, end):
    result = []
    at = 0
    for b in blocks:
        low, high = max(start, at), min(end, at + len(b['text']))
        if high > low:
            result.append(span(b, low - at, high - at))
        at += len(b['text']) + 1
    return result


def heading(line):
    value = line.strip()
    if not value or len(value) > 100 or re.search(r'\.{3,}|…{2,}|·{3,}', value):
        return None
    if re.match(r'^第[一二三四五六七八九十百\d]+[章节篇]', value):
        return 1
    if re.match(r'^[一二三四五六七八九十]+[、．.]\s*\S', value):
        return 2
    if re.match(r'^\d+(?:\.\d+){1,4}\s+\S', value):
        return 3
    if re.match(r'^\d+[.、]\s*[^\d\s]', value):
        return 3
    return None


def case_heading(line):
    """A record title, not a numbered action or a field inside that record."""
    value = line.strip()
    if not value or len(value) > 120 or re.search(r'\.{3,}|…{2,}|·{3,}', value):
        return None
    explicit = re.match(r'^案例\s*[一二三四五六七八九十百\d]+(?:[、.．:：\s]+|$)', value)
    if explicit:
        return value
    numbered = re.match(r'^\d+(?:\.\d+)*(?:[、.．])?\s+(.+)$', value)
    if not numbered:
        numbered = re.match(r'^\d+[、.．]([^\d\s].+)$', value)
    if not numbered:
        return None
    title = numbered[1].strip()
    # A symptom word inside "1.更换排线，解决闪屏问题" cannot delimit a
    # second case. Likewise "3.45.1 问题现象" is a field in the same case.
    if re.match(r'^(?:问题现象|故障现象|现象描述|主要原因|次要原因|原因分析|原因说明|解决方法|处理方法|排查步骤|操作步骤|处理结果|解决方案|注意事项|模组信息|设备信息|测试结果|验证结果|调试步骤)', title):
        return None
    if re.match(r'^(?:使用|打开|点击|选择|勾选|进入|设置|检查|确认|观察|替换|交换|互换|断电|重启|导入|尝试|建议|将|把|给|用|调节|调整|修改|降低|提高|增加|减少|关闭|开启|连接|先|再|然后|拔|插|更换(?!后)|升级(?!后))', title):
        return None
    return value if re.search(r'问题|故障|异常|案例|闪屏|闪烁|黑屏|花屏|白屏|不亮|乱码|掉线|死机|偏色|色差', title) else None


def case_sections(text):
    """Keep title and conditions with a case; never merge sibling records."""
    lines, cursor = [], 0
    for line in text.splitlines(keepends=True):
        lines.append((cursor, cursor + len(line), line.rstrip('\r\n')))
        cursor += len(line)
    markers = []
    for i, (start, end, line) in enumerate(lines):
        title = case_heading(line)
        if title is None:
            continue
        # A short chip grouping label immediately before a numbered title belongs
        # to that new record, rather than the preceding case's final solution.
        previous = i - 1
        while previous >= 0 and not lines[previous][2].strip().strip('|'):
            previous -= 1
        if previous >= 0:
            label = lines[previous][2].strip()
            digits = re.fullmatch(r'(?:[A-Za-z]{1,6})?(\d{3,6})(?:[A-Za-z0-9]*)', label)
            if digits and digits[1] in re.findall(r'\d{3,6}', title):
                start = lines[previous][0]
        header_end = end
        for _, following_end, following in lines[i + 1:]:
            if not following.strip():
                header_end = following_end
            elif re.match(r'^\s*(?:模组信息|设备信息|适用条件|前提条件|芯片(?:信息|型号)?|扫描(?:方式)?|产品型号|软件版本|固件版本)\s*[:：]', following):
                header_end = following_end
            else:
                break
        markers.append((start, min(header_end, start + 2000), title))
    for i, (start, header_end, title) in enumerate(markers):
        end = markers[i + 1][0] if i + 1 < len(markers) else len(text)
        if end > start:
            yield start, min(header_end, end), end, title


def units_for(blocks, role):
    """Return literal source spans, with honest automatically inferred boundaries."""
    if role == 'parameter':
        # Native rows stay individual. PDF chunks sharing a page stay together:
        # parameter, maximum/recommended values and notes remain one source window.
        groups = []
        for b in blocks:
            loc = json.loads(b['locator'])
            key = ('row', b['id']) if 'row' in loc else ('page', loc['page']) if 'page' in loc else ('section', loc.get('section')) if loc.get('section') else ('block', b['id'])
            if groups and groups[-1][0] == key:
                groups[-1][1].append(b)
            else:
                groups.append((key, [b]))
        for key, group in groups:
            text = '\n'.join(b['text'] for b in group)
            for start in range(0, len(text), MAX_UNIT):
                yield {'spans': extract_spans(group, start, min(len(text), start + MAX_UNIT)),
                       'heading': json.loads(group[0]['locator']).get('section', ''),
                       'complete': False, 'basis': 'native-row' if key[0] == 'row' else 'parsed-page-parameter-window;table-layout-unverified',
                       'toc': False}
        return
    if role == 'operation':
        text = '\n'.join(b['text'] for b in blocks)
        lines = []
        at = 0
        for line in text.splitlines(keepends=True):
            lines.append((at, line.rstrip('\r\n')))
            at += len(line)
        headings = [(start, level, line.strip()) for start, line in lines
                    if (level := heading(line)) is not None]
        # TOC dotted leaders never delimit task sections or outrank actual steps.
        toc_ranges = [(start, start + len(line)) for start, line in lines
                      if re.search(r'\.{3,}|…{2,}|·{3,}', line)]
        if headings:
            for i, (start, level, title) in enumerate(headings):
                end = next((h[0] for h in headings[i + 1:] if h[1] <= level), len(text))
                children = [h for h in headings[i + 1:] if start < h[0] < end]
                # Leaf tasks are preferred. Keep a parent's introduction as a
                # prerequisite only when it explicitly labels one, without
                # borrowing another sibling's actions.
                if children and end - start > MAX_UNIT:
                    end = children[0][0]
                if end <= start:
                    continue
                parents = [h for h in headings[:i] if h[1] < level and
                           not any(x[1] <= h[1] for x in headings[headings.index(h) + 1:i])]
                prefix = []
                for parent in parents[-1:]:
                    parent_end = next((h[0] for h in headings if h[0] > parent[0]), start)
                    intro = text[parent[0]:parent_end]
                    if len(intro) <= 2000 and re.search(r'前提|准备工作|操作前|注意事项|Prerequisite|Before you', intro, re.I):
                        prefix = extract_spans(blocks, parent[0], parent_end)
                        for p in prefix:
                            p['role'] = 'condition'
                for part_start in range(start, end, MAX_UNIT):
                    part_end = min(end, part_start + MAX_UNIT)
                    yield {'spans': prefix + extract_spans(blocks, part_start, part_end),
                           'heading': title, 'complete': False,
                           'basis': 'explicit-heading-continuous-section;visual-steps-unverified' + (';window-limited' if end - start > MAX_UNIT else ''),
                           'toc': False}
            first = headings[0][0]
            if first > 0:
                yield {'spans': extract_spans(blocks, 0, min(first, MAX_UNIT)), 'heading': '',
                       'complete': False, 'basis': 'manual-prefix-not-operation', 'toc': bool(toc_ranges)}
        else:
            for b in blocks:
                yield {'spans': [span(b)], 'heading': '', 'complete': False,
                       'basis': 'parsed-fragment-operation-boundary-unverified',
                       'toc': bool(re.search(r'\.{3,}|…{2,}', b['text']))}
        return
    # Preserve one native spreadsheet/table row, case or FAQ paragraph. Multi-
    # record merging is left to the existing case reader unless explicit markers
    # establish a continuous record in this original.
    if role == 'case':
        # Spreadsheet/CSV rows are independent records. A DOCX table row is a
        # source span inside the document; even an empty embedded table must not
        # disable all numbered case boundaries in the surrounding paragraphs.
        def native_record(block):
            loc = json.loads(block['locator'])
            return 'row' in loc and not str(loc.get('part', '')).startswith('word/')
        if any(native_record(b) for b in blocks):
            pending = []
            for b in blocks:
                if native_record(b):
                    if pending:
                        yield from units_for(pending, role)
                        pending = []
                    yield {'spans': [span(b)], 'heading': '', 'complete': False,
                           'basis': 'native-row', 'toc': False}
                else:
                    pending.append(b)
            if pending:
                yield from units_for(pending, role)
            return
        text = '\n'.join(b['text'] for b in blocks)
        sections = list(case_sections(text))
        if sections:
            if sections[0][0] > 0:
                yield {'spans': extract_spans(blocks, 0, min(sections[0][0], MAX_UNIT)),
                       'heading': '', 'complete': False,
                       'basis': 'case-document-prefix-not-record', 'toc': False}
            for start, header_end, end, title in sections:
                for low in range(start, end, MAX_UNIT):
                    prefix = extract_spans(blocks, start, header_end) if low > start else []
                    for p in prefix:
                        p['role'] = 'condition'
                    yield {'spans': prefix + extract_spans(blocks, low, min(low + MAX_UNIT, end)),
                           'heading': title, 'complete': False,
                           'basis': 'explicit-case-heading-continuous-section;source-outcome-unverified' + (';window-limited' if end - start > MAX_UNIT else ''), 'toc': False}
            return
    for b in blocks:
        loc = json.loads(b['locator'])
        yield {'spans': [span(b)], 'heading': loc.get('section', ''), 'complete': False,
               'basis': 'native-row' if 'row' in loc else 'parsed-original-fragment', 'toc': False}


def build(work=engine.DEFAULT_WORK, folder=DEFAULT_INDEX, replace=False):
    started = time.perf_counter()
    target = index_path(folder)
    if target.exists() and not replace:
        raise FileExistsError('role-index-exists;choose-new-folder-or-explicit-replace')
    source = engine.connect(work, True)
    before = fingerprint(work)
    source_sha = engine.digest(Path(work) / 'resources.db')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('building-' + uuid.uuid4().hex + '.db')
    shadow = sqlite3.connect(temporary)
    counts = collections.Counter()
    try:
        shadow.executescript('''
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE sources(id INTEGER PRIMARY KEY,doc_key TEXT,name TEXT,path TEXT,
          resource_id TEXT,version_id TEXT,sha256 TEXT,history INTEGER);
        CREATE INDEX sources_document ON sources(doc_key);
        CREATE INDEX sources_name ON sources(name);
        CREATE TABLE source_models(location_id INTEGER,model TEXT,owner INTEGER,
          PRIMARY KEY(location_id,model,owner));
        CREATE INDEX source_model_value ON source_models(model,location_id);
        CREATE TABLE units(id INTEGER PRIMARY KEY,uid TEXT UNIQUE,doc_key TEXT,role TEXT,
          kind TEXT,heading TEXT,text TEXT,match_text TEXT,spans TEXT,models TEXT,complete INTEGER,basis TEXT,toc INTEGER);
        CREATE INDEX units_document ON units(doc_key);
        CREATE INDEX units_uid ON units(uid);
        CREATE VIRTUAL TABLE unit_fts USING fts5(title,path,heading,body,keywords);
        ''')
        locations = [dict(r) for r in source.execute("SELECT * FROM locations WHERE state='present' AND kind!='sensitive-metadata-only'")
                     if r['kind'] == 'document' or file_role(r) != 'document']
        by_hash = collections.defaultdict(list)
        for row in locations:
            if row['kind'] == 'document' and row['sha256']:
                by_hash[row['sha256']].append(row)
        prefixes = collections.defaultdict(list)
        for b in source.execute('SELECT * FROM blocks WHERE ordinal<24 ORDER BY hash,ordinal'):
            if b['hash'] in by_hash:
                prefixes[b['hash']].append(dict(b))
        metadata = {sha: analyze(rows[0]['name'], prefixes[sha]) for sha, rows in by_hash.items()}
        history = historical_locations([{'locationId':r['id'], 'name':r['name'],
                   'availabilityState':'present', 'documentMetadata':metadata.get(r['sha256'], {})}
                   for r in locations])
        keys = {}
        for row in locations:
            key = row['sha256'] if row['kind'] == 'document' and row['sha256'] else 'metadata:' + row['resource_id']
            keys[row['id']] = key
            shadow.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?)',
                           (row['id'], key, row['name'], row['path'], row['resource_id'], row['version_id'], row['sha256'], int(row['id'] in history)))
        for r in source.execute('SELECT location_id,model,0 FROM models UNION SELECT location_id,model,1 FROM model_owners'):
            if r[0] in keys:
                shadow.execute('INSERT OR IGNORE INTO source_models VALUES(?,?,?)', tuple(r))
        product_pattern = re.compile(r'(?<![A-Za-z0-9])('+'|'.join(re.escape(x) for x in sorted(engine.known_product_models(),key=len,reverse=True))+r')(?![A-Za-z0-9])',re.I)
        for row in locations:
            if file_role(row) in ('firmware','software','video'):
                # Firmware uses underscores between product/FPGA/version fields.
                # Match a complete registered identity, never R712 inside R712S.
                for match in product_pattern.finditer(row['path']):
                    shadow.execute('INSERT OR IGNORE INTO source_models VALUES(?,?,0)',(row['id'],engine.normalize_model(match[1])))

        current_lookup = {}
        repeated_lines = set()
        def add(key, role, definition, name, paths, blocks=None, meta=False):
            spans = definition['spans']
            lookup = current_lookup
            body = '\n'.join(lookup[p['blockId']]['text'][p['start']:p['end']] for p in spans) if spans else ''
            # Repeated document headers/footers are navigation, not an answer to
            # a technical keyword (for example the company name contains 灰度).
            # Mask them for ranking while preserving literal source text/offsets.
            match_body = ''.join(ranking_line(line,repeated_lines) for line in body.splitlines(keepends=True))
            uid = hashlib.sha256(J([REVISION, key, role, spans, name if meta else None]).encode('utf8')).hexdigest()
            kind = 'file' if meta else 'passage'
            models = sorted(engine.model_tokens(body))
            shadow.execute('INSERT OR IGNORE INTO units(uid,doc_key,role,kind,heading,text,match_text,spans,models,complete,basis,toc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                (uid,key,role,kind,definition['heading'],body,match_body,J(spans),J(models),int(definition['complete']),definition['basis'],int(definition['toc'])))
            if not shadow.execute('SELECT changes()').fetchone()[0]:
                return
            unit = shadow.execute('SELECT id FROM units WHERE uid=?',(uid,)).fetchone()[0]
            shadow.execute('INSERT INTO unit_fts(rowid,title,path,heading,body,keywords) VALUES(?,?,?,?,?,?)',
                (unit,engine.fts_tokens(name),engine.fts_tokens(paths),engine.fts_tokens(definition['heading']),engine.fts_tokens(match_body),engine.fts_tokens(role)))
            counts[role] += 1

        for sha, iterator in itertools.groupby(source.execute('SELECT * FROM blocks ORDER BY hash,ordinal'), key=lambda r:r['hash']):
            blocks = [dict(r) for r in iterator]
            if sha not in by_hash:
                continue
            rows = by_hash[sha]
            current_lookup = {b['id']:b for b in blocks}
            line_counts = collections.Counter(line_identity(line) for b in blocks for line in b['text'].splitlines()
                                               if 8 <= len(line.strip()) <= 250)
            repeated_lines = {line for line,count in line_counts.items() if count >= max(3,len(blocks)//3)}
            name = rows[0]['name']
            paths = '\n'.join(r['path'] for r in rows)
            role = body_role(name, metadata[sha])
            for definition in units_for(blocks, role):
                add(sha, role, definition, name, paths, blocks)
        seen = set()
        for row in locations:
            key = keys[row['id']]
            if key in by_hash and prefixes.get(key):
                continue
            role = file_role(row)
            identity = (key, row['name'])
            if identity in seen:
                continue
            seen.add(identity)
            add(key, role, {'spans':[], 'heading':'', 'complete':False, 'basis':'registered-filename-and-directory;body-not-parsed;not-compatibility', 'toc':False},row['name'],row['path'],meta=True)
        after = fingerprint(work)
        after_sha = engine.digest(Path(work) / 'resources.db')
        if after != before or after_sha != source_sha:
            raise RuntimeError('source-index-changed-during-build')
        receipt = {'revision':REVISION, 'sourceWork':str(Path(work).resolve()), 'sourceFingerprint':before,
                   'sourceDBSha256':source_sha,'sourceDBUnchanged':True,
                   'sourceBlocks':source.execute('SELECT COUNT(*) FROM blocks').fetchone()[0],
                   'registeredLocations':len(locations),'registeredDocumentHashes':len(by_hash),
                   'parsedDocuments':sum(bool(prefixes.get(sha)) for sha in by_hash),
                   'units':sum(counts.values()),'roles':dict(counts),
                   'elapsedMs':round((time.perf_counter()-started)*1000,3),
                   'limits':['No source scan, OCR, model call or source modification.',
                             'Role and section boundaries are deterministic candidates, not reviewed engineering facts.',
                             'PDF parameter windows preserve literal text, not validated table geometry.',
                             'Unparsed images, missing pages and visual instructions remain unverified.']}
        shadow.execute('INSERT INTO meta VALUES(?,?)',('build',J(receipt)))
        shadow.commit()
        shadow.close()
        os.replace(temporary,target)
        receipt['indexBytes'] = target.stat().st_size
        return receipt
    finally:
        source.close()
        shadow.close()
        if temporary.exists():
            temporary.unlink()


def connect(folder, work):
    target = index_path(folder)
    if not target.is_file():
        raise FileNotFoundError('role-index-unavailable')
    db = sqlite3.connect(target.as_uri()+'?mode=ro',uri=True)
    db.row_factory = sqlite3.Row
    meta = json.loads(db.execute("SELECT value FROM meta WHERE key='build'").fetchone()[0])
    if meta['revision'] != REVISION or meta['sourceWork'] != str(Path(work).resolve()) or meta['sourceFingerprint'] != [list(x) for x in fingerprint(work)]:
        db.close()
        raise ValueError('role-index-stale')
    return db


def validated_list(values, label, maximum=20000):
    if values is not None and (not isinstance(values,list) or len(values)>maximum or
        any(not isinstance(x,str) or not x or len(x)>512 for x in values)):
        raise ValueError('invalid-'+label)
    return values


def source_where(models, documents, authorized_keys, version=None, include_history=False):
    where, args = [], []
    if not version and not documents and not include_history:
        where.append('s.history=0')
    if version:
        where.append('has_version(s.name,?)=1')
        args.append(version)
    if documents is not None:
        where.append('s.name IN ('+','.join('?' for _ in documents)+')' if documents else '0')
        args.extend(documents)
    if authorized_keys is not None:
        # Use a temporary read-only VALUES CTE? SQLite variable limits differ by
        # platform; a bound JSON array avoids any global Top N post-filter.
        where.append('(s.sha256 IN (SELECT value FROM json_each(?)) OR (\'metadata:\'||s.resource_id) IN (SELECT value FROM json_each(?)))')
        args.extend([J(authorized_keys),J(authorized_keys)])
    if models:
        placeholders = ','.join('?' for _ in models)
        where.append('EXISTS(SELECT 1 FROM source_models m WHERE m.location_id=s.id AND m.model IN ('+placeholders+'))')
        args.extend(models)
        where.append('(NOT EXISTS(SELECT 1 FROM source_models o WHERE o.location_id=s.id AND o.owner=1) OR EXISTS(SELECT 1 FROM source_models o WHERE o.location_id=s.id AND o.owner=1 AND o.model IN ('+placeholders+')))')
        args.extend(models)
    return ' AND '.join(where) or '1',args


def restore(db, source, row, where, args):
    sources = [dict(s) for s in db.execute('SELECT s.* FROM sources s WHERE s.doc_key=? AND '+where,[row['doc_key']]+args)]
    if not sources:
        raise PermissionError('role-unit-outside-authorized-scope')
    spans = json.loads(row['spans'])
    parts = []
    for p in spans:
        b = source.execute('SELECT * FROM blocks WHERE id=?',(p['blockId'],)).fetchone()
        if not b or b['hash']!=row['doc_key'] or b['text_hash']!=p['indexedTextHash'] or hashlib.sha256(b['text'].encode('utf8')).hexdigest()!=p['textHash']:
            raise ValueError('role-source-span-stale')
        if not 0 <= p['start'] < p['end'] <= len(b['text']):
            raise ValueError('role-invalid-source-span')
        parts.append({'blockId':b['id'],'locator':json.loads(b['locator']),
                      'charStart':p['start'],'charEnd':p['end'],'text':b['text'][p['start']:p['end']], 'role':p['role']})
    unit = {'id':row['uid'],'revision':REVISION,'documentId':row['doc_key'], 'kind':row['role'],
            'uses':[row['role']], 'boundaryBasis':row['basis'], 'complete':bool(row['complete']),
            'bodyParsed':bool(spans), 'compatibilityConfirmed':False,
            'sourceSpans':spans, 'readAuthority':'caller-scope-required;not-a-public-read-token'}
    return sources,parts,unit


def search(work, folder=DEFAULT_INDEX, query='', role='all', concepts=None, models=None,
           documents=None, authorized_keys=None, limit=4, version=None):
    started = time.perf_counter()
    if not isinstance(query,str) or not 1<=len(query)<=240 or role not in ROLES|{'all','text','products','cases'}:
        raise ValueError('invalid-role-query')
    models = [engine.normalize_model(x) for x in validated_list(models or [],'models',4)]
    documents = validated_list(documents,'documents',4)
    authorized_keys = validated_list(authorized_keys,'authorized-keys')
    groups = proximity.concepts_for(query, concepts)
    terms = list(dict.fromkeys(engine.fts_tokens(' '.join([query]+[word for group in groups for word in group])).split()))
    match = ' OR '.join('"'+t.replace('"','""')+'"' for t in terms)
    if not match:
        return {'results':[],'candidateCount':0,'elapsedMs':0,'semantics':REVISION}
    db = connect(folder,work)
    source = engine.connect(work,True)
    try:
        db.create_function('has_version',2,lambda name,wanted:int(str(wanted).upper() in {m.upper() for m in re.findall(r'(?i)V\d+(?:\.\d+)+(?!\d|\.\d)',name or '')}),deterministic=True)
        where,args = source_where(models,documents,authorized_keys,version)
        roles = ['parameter','operation','firmware','software','video','case','faq','document'] if role=='all' else ['parameter','operation','case','faq','document'] if role=='text' else ['parameter'] if role=='products' else ['case'] if role=='cases' else [role]
        role_clause = ','.join('?' for _ in roles)
        rows = db.execute('''SELECT u.*,bm25(unit_fts,5,1,7,2,3) rank FROM unit_fts JOIN units u ON u.id=unit_fts.rowid
          WHERE unit_fts MATCH ? AND u.role IN ('''+role_clause+''') AND EXISTS(SELECT 1 FROM sources s
          WHERE s.doc_key=u.doc_key AND '''+where+') ORDER BY u.toc,rank LIMIT 160',[match]+roles+args).fetchall()
        ranked = []
        for row in rows:
            sources,parts,unit = restore(db,source,row,where,args)
            text = '\n'.join(p['text'] for p in parts)
            if row['kind']=='file':
                text = sources[0]['name']+'\n'+sources[0]['path']
            window = proximity.best_window(row['match_text'] if parts else text,groups,900)
            coverage = window['coverage'] if window else 0
            # A matching model in a title is useful file navigation, but cannot
            # satisfy an unrelated operation/parameter body request by itself.
            if not coverage:
                continue
            present = engine.model_tokens(text) & engine.known_product_models()
            if models and present and not set(models).intersection(present):
                continue
            low = max(0,window['start']-200) if window else 0
            high = min(len(text),window['end']+600) if window else min(len(text),1000)
            anchor = next((p['start'] for p in unit['sourceSpans'] if p['role']=='body'),0)
            result = {'kind':row['kind'],'role':row['role'],'unitId':row['uid'],'sha256':sources[0]['sha256'],
                'name':sources[0]['name'],'resourceId':sources[0]['resource_id'],'versionId':sources[0]['version_id'],
                'text':text[low:high],'locator':parts[0]['locator'] if parts else None,
                'locations':[{'id':s['id'],'path':s['path'],'name':s['name'],'resource_id':s['resource_id'],'version_id':s['version_id']} for s in sources],
                'versions':re.findall(r'(?i)\bV\d+(?:\.\d+)+',sources[0]['name']),
                'mentionedModels':sorted(present),'knowledgeUnit':unit,'score':-row['rank'],
                'constraints':{'requestedModels':models,'mentionedModels':sorted(present),'compatibilityConfirmed':False},
                'proximity':{'conceptCount':len(groups),'matchedConcepts':coverage,'spanChars':window['span'] if window else 0,
                    'contextBoundary':row['basis'],'totalContextChars':len(text),'excerptStart':low,'excerptEnd':high,
                    'contextBlockIds':[p['blockId'] for p in parts],'boundaryWindowLimited':not bool(row['complete']),
                    'hits':[]}}
            if parts:
                result.update({'blockId':next((p['blockId'] for p in parts if p['role']=='body'),parts[0]['blockId']), 'readAnchor':anchor,
                               'readMore':'/role/read?unit='+row['uid']})
            else:
                result['locationId'] = sources[0]['id']
            ranked.append(((row['toc'],-coverage,row['rank']),result))
        ranked.sort(key=lambda item:item[0])
        return {'results':[r for _,r in ranked[:max(1,min(int(limit),10))]],'candidateCount':len(rows),
                'elapsedMs':round((time.perf_counter()-started)*1000,3),'semantics':REVISION+';source-role-fields;permission-before-limit;not-compatibility'}
    finally:
        source.close()
        db.close()


def read(work, folder=DEFAULT_INDEX, unit='', offset=0, authorized_keys=None):
    if not isinstance(unit,str) or not re.fullmatch(r'[a-f0-9]{64}',unit) or not isinstance(offset,int) or not 0<=offset<=100000:
        raise ValueError('invalid-role-read')
    authorized_keys = validated_list(authorized_keys,'authorized-keys')
    db = connect(folder,work)
    source = engine.connect(work,True)
    try:
        row = db.execute('SELECT * FROM units WHERE uid=?',(unit,)).fetchone()
        if not row:
            raise KeyError('unknown-role-unit')
        where,args = source_where([],None,authorized_keys,include_history=True)
        sources,parts,knowledge = restore(db,source,row,where,args)
        if row['kind']=='file':
            raise ValueError('role-file-has-no-body')
        total = sum(len(p['text']) for p in parts)+max(0,len(parts)-1)
        if offset>total:
            raise ValueError('offset-outside-context')
        end = min(total,offset+6000)
        output = []
        at = 0
        for p in parts:
            low,high = max(offset,at),min(end,at+len(p['text']))
            if high>low:
                output.append({**p,'text':p['text'][low-at:high-at],
                    'charStart':p['charStart']+low-at,'charEnd':p['charStart']+high-at})
            at += len(p['text'])+1
        return {'unitId':unit,'knowledgeUnit':knowledge,'blocks':output,'offset':offset,
                'nextOffset':end if end<total else None,'totalChars':total,
                'boundary':row['basis'],'boundaryWindowLimited':not bool(row['complete'])}
    finally:
        source.close()
        db.close()


def health(work, folder):
    try:
        db = connect(folder,work)
        try:
            return {'ready':True,'schemaVersion':REVISION,
                    'unitCount':db.execute('SELECT COUNT(*) FROM units').fetchone()[0],
                    'metadataCount':db.execute("SELECT COUNT(*) FROM units WHERE kind='file'").fetchone()[0]}
        finally:
            db.close()
    except (OSError, ValueError, sqlite3.DatabaseError):
        return {'ready':False,'schemaVersion':REVISION}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work',default=str(engine.DEFAULT_WORK))
    parser.add_argument('--index',default=str(DEFAULT_INDEX))
    parser.add_argument('--replace',action='store_true')
    args = parser.parse_args()
    print(json.dumps(build(args.work,args.index,args.replace),ensure_ascii=False,indent=2))
