"""Build the existing resource/role indexes from an explicit local release catalog.

Never traverses the source directory, changes approval, downloads or edits originals.
This derived local index is NOT automatically attached to a public server.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import engine
import paragraphs
import role_index


def catalog_records(catalog):
    catalog = Path(catalog).resolve()
    data = json.loads(catalog.read_text(encoding='utf-8-sig'))
    if data.get('schemaVersion') != 'xhj-local-public-files-1':
        raise ValueError('unsupported-release-catalog')
    root, seen, rows = catalog.parent, set(), []
    for entry in data['files']:
        sha = entry['sha256']
        if not re.fullmatch('[a-f0-9]{64}', sha):
            raise ValueError('invalid-release-sha256')
        for record in entry['records']:
            path = (root / record['relativePath']).resolve()
            if root not in path.parents or str(path) in seen:
                raise ValueError('duplicate-or-outside-release-root')
            seen.add(str(path))
            if record['category'] not in ('spec', 'manual', 'firmware', 'video', 'software'):
                raise ValueError('unsupported-release-category')
            rows.append({'path': str(path), 'sha256': sha, 'bytes': entry['sizeBytes'],
                         'category': record['category'], 'name': path.name})
    if len(rows) != data['recordCount'] or len({r['sha256'] for r in rows}) != data['uniqueContentCount']:
        raise ValueError('release-catalog-count-mismatch')
    return data, rows


def register(catalog, work):
    data, rows = catalog_records(catalog)
    db = engine.connect(work)
    old_manifest = db.execute("SELECT root FROM scans WHERE id='release-catalog'").fetchone()
    if old_manifest and old_manifest[0] != str(Path(catalog).resolve()):
        db.close()
        raise ValueError('refuse-mixed-release-catalogs')
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    checked = set()
    try:
        for row in rows:
            path = Path(row['path']); stat = path.stat()
            if stat.st_size != row['bytes']:
                raise ValueError('release-file-size-changed:' + path.name)
            old = db.execute('SELECT * FROM locations WHERE path=?', (str(path),)).fetchone()
            cached = old and old['sha256'] == row['sha256'] and old['bytes'] == stat.st_size and old['mtime_ns'] == stat.st_mtime_ns
            file_identity = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)
            if file_identity not in checked and not cached:
                if engine.digest(path) != row['sha256']:
                    raise ValueError('release-file-hash-mismatch:' + path.name)
                after = path.stat()
                if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                    raise ValueError('release-file-changed-during-hash')
                checked.add(file_identity)
            rid = engine.identifier('res-', row['sha256'])
            vid = engine.identifier('ver-', row['sha256'])
            kind = 'document' if row['category'] in ('spec', 'manual') else 'metadata-only'
            db.execute('INSERT OR IGNORE INTO resources VALUES(?,?)', (rid, stamp))
            db.execute('INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?)', (vid, rid, row['sha256'], stat.st_size, stat.st_mtime_ns))
            db.execute('''INSERT INTO locations(path,parent,name,extension,kind,resource_id,version_id,bytes,mtime_ns,sha256,state,scan_id)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET kind=excluded.kind,bytes=excluded.bytes,
                mtime_ns=excluded.mtime_ns,sha256=excluded.sha256,state=excluded.state''',
                (str(path), str(path.parent), path.name, path.suffix.lower(), kind, rid, vid, stat.st_size, stat.st_mtime_ns, row['sha256'], 'present', 'release-catalog'))
            lid = db.execute('SELECT id FROM locations WHERE path=?', (str(path),)).fetchone()[0]
            db.execute('DELETE FROM file_fts WHERE rowid=?', (lid,))
            db.execute('INSERT INTO file_fts(rowid,name,path,tokens) VALUES(?,?,?,?)',
                       (lid, engine.fts_tokens(path.name), engine.fts_tokens(str(path)), engine.fts_tokens(path.name)))
            db.execute('DELETE FROM models WHERE location_id=?', (lid,))
            db.execute('DELETE FROM model_owners WHERE location_id=?', (lid,))
            hints = engine.model_tokens(path.name)
            db.executemany('INSERT OR IGNORE INTO models VALUES(?,?,?)', [(lid, m, 'filename-hint-not-compatibility') for m in hints])
            db.executemany('INSERT OR IGNORE INTO model_owners VALUES(?,?)', [(lid, m) for m in hints & engine.known_product_models()])
        paths = {r['path'] for r in rows}
        for row in db.execute('SELECT id,path FROM locations').fetchall():
            if row['path'] not in paths:
                db.execute("UPDATE locations SET state='outside-current-catalog' WHERE id=?", (row['id'],))
        db.execute('INSERT OR REPLACE INTO scans VALUES(?,?,?,?,?)', ('release-catalog', str(Path(catalog).resolve()), stamp, stamp, '[]'))
        db.commit()
        return {'registeredRecords': len(rows), 'contentIdentities': len({r['sha256'] for r in rows}), 'verifiedHashes': len(checked)}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def parse_documents(work, contains=None, legacy=False, timeout=120):
    db = engine.connect(work)
    revision = engine.VERSION if legacy else paragraphs.REVISION + ':' + engine.digest(Path(paragraphs.__file__))[:16]
    selected = db.execute("SELECT sha256,MIN(path) path FROM locations WHERE kind='document' AND state='present' GROUP BY sha256 ORDER BY path").fetchall()
    counts = collections.Counter(); pending = []
    for item in selected:
        if contains and not any(word.lower() in item['path'].lower() for word in contains):
            continue
        old = db.execute('SELECT * FROM parses WHERE hash=?', (item['sha256'],)).fetchone()
        if old and old['parser'] == revision and old['state'] != 'failed':
            counts['cacheHits'] += 1
        else:
            pending.append(dict(item))
    def worker(item):
        try:
            path = Path(item['path']); before = path.stat()
            p = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--parse-one', str(path)] + (['--legacy'] if legacy else []),
                               capture_output=True, timeout=timeout, env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
            if p.returncode:
                raise ValueError(p.stderr.decode('utf-8', errors='replace')[-1200:])
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError('source-changed-during-parse')
            return item, before, json.loads(p.stdout.decode('utf-8')), None
        except Exception as error:
            return item, None, None, str(error)
    with ThreadPoolExecutor(max_workers=2) as pool:
        source = iter(pending); jobs = set()
        for item in source:
            jobs.add(pool.submit(worker, item))
            if len(jobs) == 2:
                break
        done = 0
        while jobs:
            completed, jobs = wait(jobs, return_when=FIRST_COMPLETED)
            for job in completed:
                item, stat, parsed, error = job.result()
                try:
                    if error:
                        raise ValueError(error)
                    current = db.execute('SELECT bytes,mtime_ns FROM locations WHERE path=?', (item['path'],)).fetchone()
                    if (stat.st_size, stat.st_mtime_ns) != tuple(current):
                        raise ValueError('source-changed-since-hash-check')
                    db.execute('DELETE FROM block_fts WHERE rowid IN (SELECT id FROM blocks WHERE hash=?)', (item['sha256'],))
                    db.execute('DELETE FROM blocks WHERE hash=?', (item['sha256'],))
                    for ordinal, block in enumerate(parsed['blocks']):
                        text = block['text']
                        cur = db.execute('INSERT INTO blocks(hash,ordinal,locator,text,text_hash,models) VALUES(?,?,?,?,?,?)',
                                         (item['sha256'], ordinal, engine.J(block['locator']), text,
                                          hashlib.sha256(re.sub(r'\s+', '', text).casefold().encode('utf-8')).hexdigest(), engine.J(sorted(engine.model_tokens(text)))))
                        db.execute('INSERT INTO block_fts(rowid,tokens) VALUES(?,?)', (cur.lastrowid, engine.fts_tokens(text)))
                    db.execute('INSERT OR REPLACE INTO parses VALUES(?,?,?,?,?,?)',
                               (item['sha256'], revision, parsed['state'], len(parsed['blocks']), None, engine.J(parsed.get('details', {}))))
                    counts[parsed['state']] += 1
                    db.commit()
                except Exception as exc:
                    db.rollback()
                    db.execute('INSERT OR REPLACE INTO parses VALUES(?,?,?,?,?,?)', (item['sha256'], revision, 'failed', 0, str(exc)[:1600], '{}'))
                    db.commit(); counts['failed'] += 1
                done += 1
                if done % 10 == 0:
                    print(engine.J({'processed': done, 'pendingTotal': len(pending), 'results': dict(counts)}), flush=True)
                item = next(source, None)
                if item:
                    jobs.add(pool.submit(worker, item))
    db.close()
    return dict(counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--work', default=str(engine.SOURCE_PROJECT / 'tmp/public-paragraph-20261023/catalog'))
    parser.add_argument('--contains', action='append')
    parser.add_argument('--legacy', action='store_true')
    parser.add_argument('--parse-one')
    args = parser.parse_args()
    if args.parse_one:
        print(engine.J(engine.extract(Path(args.parse_one)) if args.legacy else paragraphs.extract(args.parse_one)))
        return
    start = time.perf_counter()
    registered = register(args.catalog, args.work)
    print(engine.J({'registered': registered}), flush=True)
    counts = parse_documents(args.work, args.contains, args.legacy)
    # Body mentions support retrieval in shared manuals. The separate owner
    # index and per-unit model checks still prevent compatibility inference.
    db = engine.connect(args.work)
    db.execute("INSERT OR IGNORE INTO models(location_id,model,basis) SELECT DISTINCT l.id,j.value,'body-mention-not-compatibility' FROM locations l JOIN blocks b ON b.hash=l.sha256,json_each(b.models) j WHERE l.state='present' AND l.kind='document'")
    db.commit();db.close()
    built = role_index.build(args.work, Path(args.work).parent / (Path(args.work).name + '-roles'), replace=True)
    receipt = {**registered, 'parsed': counts, 'index': built, 'elapsedSeconds': round(time.perf_counter()-start, 3),
               'liveSourceSwitched': False, 'authorizationChanged': False}
    Path(args.work, 'build.private.json').write_text(engine.J(receipt), encoding='utf-8')
    print(engine.J(receipt), flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
