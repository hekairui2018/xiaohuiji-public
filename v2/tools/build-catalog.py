#!/usr/bin/env python3
"""Build the approved-file catalogue. Never edits originals or the legacy index."""
import argparse
import collections
import copy
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TYPES = {'document': 'documents', 'video': 'videos', 'firmware': 'firmware'}
BASELINE = {'document': 391, 'video': 198, 'firmware': 108}
DIRECT = ('sha256', 'name', 'size', 'models', 'brand', 'language', 'version')
SIGNED = re.compile(r'已签章|盖章|已签字|签章版|signed', re.I)
SCHEMA = """
CREATE TABLE catalog(
 id INTEGER PRIMARY KEY, sha256 TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 size INTEGER NOT NULL, type TEXT NOT NULL, category TEXT,
 storage_kind TEXT NOT NULL, relative_path TEXT, source_root TEXT,
 brand TEXT, language TEXT, version TEXT,
 status TEXT NOT NULL, approval_at TEXT, approval_by TEXT, approval_basis TEXT,
 supersedes TEXT, superseded_by TEXT, content_blocks INTEGER, previewable INTEGER
);
CREATE TABLE catalog_models(sha256 TEXT NOT NULL, model TEXT NOT NULL, PRIMARY KEY(sha256,model));
CREATE TABLE catalog_consumers(sha256 TEXT NOT NULL, consumer TEXT NOT NULL, PRIMARY KEY(sha256,consumer));
CREATE TABLE catalog_software(sha256 TEXT PRIMARY KEY, software TEXT NOT NULL);
CREATE INDEX ix_catalog_status ON catalog(status);
"""


def load(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'))


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def natural(value):
    return [(1, int(p)) if p.isdigit() else (0, p.casefold())
            for p in re.split(r'(\d+)', value or '')]


def entry_key(entry):
    return (list(TYPES).index(entry['type']), natural(entry['category']),
            natural(entry['name']), entry['name'], entry['sha256'])


def original(entry):
    """Lossless inverse mapping; approval lives only on the catalogue row."""
    category_key = 'kind' if entry['type'] == 'document' else 'category'
    values = {k: entry[k] for k in DIRECT}
    values[category_key] = entry['category']
    values['relativePath'] = entry['storage']['relativePath']
    values.update(entry['sourceFields'])
    return {k: values[k] for k in entry['sourceKeys']}


def legacy_index(file):
    connection = sqlite3.connect(Path(file).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        locations = {r[0] for r in connection.execute('SELECT sha256 FROM locations WHERE sha256 IS NOT NULL')}
        blocks = dict(connection.execute('SELECT hash, COUNT(*) FROM blocks GROUP BY hash'))
        samples = list(connection.execute('SELECT sha256, MIN(path) FROM locations WHERE sha256 IS NOT NULL GROUP BY sha256 ORDER BY sha256'))
        return locations, blocks, samples
    finally:
        connection.close()


def validate(data, args):
    if data.get('schemaVersion') != 1 or not isinstance(data.get('items'), list):
        raise ValueError('invalid catalog schema')
    if args.allow_count_change and not (args.reason or '').strip():
        raise ValueError('--allow-count-change requires --reason')
    counts = dict(collections.Counter(e.get('type') for e in data['items']))
    counts = {t: counts.get(t, 0) for t in TYPES} | {k: v for k, v in counts.items() if k not in TYPES}
    if counts != data.get('counts'):
        raise ValueError('count mismatch: actual=%s registered=%s' % (counts, data.get('counts')))
    if counts != BASELINE and not args.allow_count_change:
        raise ValueError('count mismatch: expected=%s actual=%s; explicit --allow-count-change --reason required' % (BASELINE, counts))
    official = {r['model'] for r in load(args.official_models)['rows'] if r.get('official') is True}
    hashes, identities = set(), set()
    for e in data['items']:
        name, sha = e.get('name'), e.get('sha256')
        if e.get('type') not in TYPES or not isinstance(name, str) or not name or re.search(r'[\\/\x00\r\n]', name):
            raise ValueError('invalid file identity: %s' % name)
        if not isinstance(sha, str) or not re.fullmatch('[0-9a-f]{64}', sha) or sha in hashes:
            raise ValueError('invalid or duplicate sha256: %s' % name)
        hashes.add(sha)
        if type(e.get('size')) is not int or e['size'] < 0 or (name, e['size']) in identities:
            raise ValueError('invalid size or duplicate (name,size): %s' % name)
        identities.add((name, e['size']))
        storage = e['storage']
        relative = storage.get('relativePath')
        if storage.get('kind') != 'local' or not isinstance(relative, str) or not relative:
            raise ValueError('invalid storage: %s' % name)
        if SIGNED.search(name) or SIGNED.search(relative):
            raise ValueError('signed file rejected: %s [%s]' % (name, relative))
        windows = PureWindowsPath(relative)
        if windows.drive or windows.root or '..' in windows.parts:
            raise ValueError('file outside source root: %s' % name)
        root = Path(storage['sourceRoot']).resolve(strict=True)
        file = root.joinpath(*windows.parts).resolve(strict=True)
        if not file.is_relative_to(root) or not file.is_file() or file.name != name:
            raise ValueError('file outside source root or name mismatch: %s' % name)
        before = file.stat()
        if before.st_size != e['size']:
            raise ValueError('size mismatch: %s' % name)
        if digest(file) != sha:
            raise ValueError('sha256 mismatch: %s' % name)
        after = file.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('file changed during verification: %s' % name)
        models = e.get('models')
        if not isinstance(models, list) or any(not isinstance(m, str) or not m for m in models) or len(models) != len(set(models)):
            raise ValueError('invalid model associations: %s' % name)
        software_manual = (e['type'] == 'document' and e['category'] == 'manual'
                           and e.get('sourceFields', {}).get('subjectType') == 'software'
                           and isinstance(e['sourceFields'].get('software'), str)
                           and bool(e['sourceFields']['software'].strip()) and not models)
        if e['type'] == 'document' and not software_manual and (not models or not set(models) <= official):
            raise ValueError('document models outside official catalogue: %s' % name)
        if e.get('status') not in ('approved', 'withdrawn', 'superseded'):
            raise ValueError('invalid status: %s' % name)
        approval = e.get('approval')
        if not isinstance(approval, dict) or any(not approval.get(k) for k in ('at', 'by', 'basis')):
            raise ValueError('missing approval provenance: %s' % name)
        category_key = 'kind' if e['type'] == 'document' else 'category'
        mapped = set(DIRECT) | {category_key, 'relativePath'}
        if mapped & set(e['sourceFields']) or len(e['sourceKeys']) != len(set(e['sourceKeys'])):
            raise ValueError('ambiguous original fields: %s' % name)
        if set(e['sourceKeys']) != set(original(e)) or any(k not in e['sourceKeys'] for k in e['sourceFields']):
            raise ValueError('invalid original field mapping: %s' % name)
        for k in DIRECT:
            if k not in e['sourceKeys'] and e[k] is not None:
                raise ValueError('invented original field %s: %s' % (k, name))
    if data['items'] != sorted(data['items'], key=entry_key):
        raise ValueError('catalogue order must be type/category/natural name/identity')
    for t in TYPES:
        meta = data['manifests'][t]
        expected = {e['sha256'] for e in data['items'] if e['type'] == t}
        if len(meta['order']) != len(set(meta['order'])) or set(meta['order']) != expected:
            raise ValueError('manifest ordering does not cover catalogue: %s' % t)
    return counts


def database(data, blocks):
    db = sqlite3.connect(':memory:')
    db.executescript(SCHEMA)
    for e in data['items']:
        s, a = e['storage'], e['approval']
        count = blocks.get(e['sha256'], 0)
        row = [e[k] for k in ('sha256', 'name', 'size', 'type', 'category')]
        row += [s['kind'], s['relativePath'], s['sourceRoot']]
        row += [e[k] for k in ('brand', 'language', 'version', 'status')]
        row += [a['at'], a['by'], a['basis'], e['supersedes'], e['supersededBy'], count,
                int(e['type'] == 'document' and count > 0)]
        db.execute('INSERT INTO catalog VALUES(NULL,' + ','.join('?' for _ in row) + ')', row)
        db.executemany('INSERT INTO catalog_models VALUES(?,?)', [(e['sha256'], m) for m in e['models']])
        if e.get('sourceFields', {}).get('subjectType') == 'software':
            db.execute('INSERT INTO catalog_software VALUES(?,?)', (e['sha256'], e['sourceFields']['software']))
        db.executemany('INSERT INTO catalog_consumers VALUES(?,?)', [(e['sha256'], c) for c in ('wiki', 'quick')])
    db.commit()
    return db


def generated(data, sha):
    by_sha = {e['sha256']: e for e in data['items']}
    result = {}
    for t, filename in TYPES.items():
        meta = data['manifests'][t]
        manifest = copy.deepcopy(meta['fields'])
        manifest['items'] = [original(by_sha[s]) for s in meta['order'] if by_sha[s]['status'] == 'approved']
        manifest['generatedAt'] = data['approvedAt'] + 'T00:00:00Z'
        manifest['sourceSha'] = sha
        result['curated-local-' + filename + '.json'] = json_bytes(manifest)
    return result


def differences(left, right, path='$'):
    if type(left) is not type(right):
        return [path]
    if isinstance(left, dict):
        return [path + '.' + k for k in left.keys() ^ right.keys()] + [p for k in left.keys() & right.keys() for p in differences(left[k], right[k], path + '.' + k)]
    if isinstance(left, list):
        if len(left) != len(right):
            return [path + '.length']
        return [p for i, (a, b) in enumerate(zip(left, right)) for p in differences(a, b, path + '[' + str(i) + ']')]
    return [] if left == right else [path]


def verify(data, counts, blocks, locations, samples, args, outputs, expected_db):
    db = sqlite3.connect(args.db.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        errors = []
        for table in ('catalog', 'catalog_models', 'catalog_consumers', 'catalog_software'):
            got = list(db.execute('SELECT * FROM ' + table + ' ORDER BY 1,2'))
            expected = list(expected_db.execute('SELECT * FROM ' + table + ' ORDER BY 1,2'))
            if got != expected:
                errors.append('SQLite rows differ: ' + table)
        if list(db.execute('PRAGMA integrity_check')) != [('ok',)]:
            errors.append('SQLite integrity_check failed')
        cross = {}
        for t, filename in TYPES.items():
            entries = [e for e in data['items'] if e['type'] == t]
            cross[t] = {'registered': counts[t], 'in_locations': sum(e['sha256'] in locations for e in entries),
                        'with_blocks': sum(blocks.get(e['sha256'], 0) > 0 for e in entries)}
            name = 'curated-local-' + filename + '.json'
            actual_bytes = (args.output / name).read_bytes()
            if actual_bytes != outputs[name]:
                errors.append('derived bytes differ: ' + name)
            actual = json.loads(actual_bytes)
            actual.pop('generatedAt', None)
            actual.pop('sourceSha', None)
            errors += [name + ':' + p for p in differences(load(args.legacy_directory / name), actual)]
        approved = {e['sha256'] for e in data['items']}
        unapproved = [{'sha256': s, 'path': p} for s, p in samples if s not in approved][:5]
        if errors:
            raise ValueError('verification failed: ' + json.dumps(errors, ensure_ascii=False))
        # Each trace entry identifies a fully checked original and its actual DB preview capability.
        trace = [[e['sha256'], e['status'], True, blocks.get(e['sha256'], 0),
                  bool(e['type'] == 'document' and blocks.get(e['sha256'], 0))] for e in data['items']]
        print('type       registered in_locations with_blocks')
        for t, row in cross.items():
            print('%-10s %10d %12d %11d' % (t, row['registered'], row['in_locations'], row['with_blocks']))
        print(json.dumps({'ok': True, 'checked': len(trace), 'fieldDifferences': 0,
                          'sqliteIntegrity': 'ok', 'sqliteRowsAndRelationsMatch': True,
                          'previewableBasis': 'document with indexed blocks; not native video/PDF rendering capability',
                          'cross': cross, 'unapprovedSamples': unapproved,
                          'traceColumns': ['sha256', 'status', 'foundAndSizeAndShaMatch', 'content_blocks', 'previewable'],
                          'trace': trace}, ensure_ascii=False, separators=(',', ':')))
    finally:
        db.close()


def atomic_write(file, payload):
    file.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + file.name + '.', dir=file.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(payload)
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=ROOT / 'v2/data/catalog/catalog.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'v2/data/catalog/generated')
    parser.add_argument('--db', type=Path)
    parser.add_argument('--official-models', type=Path, default=ROOT / 'v2/data/official-models-20261027.json')
    parser.add_argument('--legacy-index', type=Path, default=ROOT / 'tmp/resource-index-stage1-20261016/resources.db')
    parser.add_argument('--legacy-directory', type=Path, default=ROOT / 'tmp/v2-offline-runtime')
    parser.add_argument('--check', action='store_true', help='validate originals, write nothing')
    parser.add_argument('--verify', action='store_true', help='read-only verification of built outputs and old manifests')
    parser.add_argument('--allow-count-change', action='store_true')
    parser.add_argument('--reason')
    args = parser.parse_args()
    args.db = args.db or args.catalog.parent / 'catalog.db'
    raw = args.catalog.read_bytes()
    data = json.loads(raw.decode('utf-8-sig'))
    counts = validate(data, args)
    if args.check:
        print(json.dumps({'ok': True, 'checked': sum(counts.values()), 'counts': counts, 'writes': 0,
                          'countChangeReason': args.reason if args.allow_count_change else None}, ensure_ascii=False))
        return
    locations, blocks, samples = legacy_index(args.legacy_index)
    db = database(data, blocks)
    try:
        outputs = generated(data, hashlib.sha256(raw).hexdigest())
        if args.verify:
            verify(data, counts, blocks, locations, samples, args, outputs, db)
            return
        # All validation, SQLite construction and JSON generation finish before any output is touched.
        payload = db.serialize()
        atomic_write(args.db, payload)
        for name, content in outputs.items():
            atomic_write(args.output / name, content)
        print(json.dumps({'ok': True, 'counts': counts, 'sqliteRows': sum(counts.values()),
                          'sourceSha': hashlib.sha256(raw).hexdigest(), 'generated': list(outputs),
                          'countChangeReason': args.reason if args.allow_count_change else None}, ensure_ascii=False))
    finally:
        db.close()


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        print('catalog error: ' + str(error), file=sys.stderr)
        sys.exit(1)
