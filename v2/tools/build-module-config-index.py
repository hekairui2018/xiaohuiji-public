"""Build a separate SQLite catalog of copied public module configurations."""
from pathlib import Path
import argparse
import hashlib
import sqlite3

def build(root, output):
    root = Path(root).resolve(strict=True)
    output = Path(output)
    if output.exists():
        raise ValueError('Choose a new config catalog; existing catalog is immutable')
    rows = []
    for file in sorted(root.rglob('*')):
        if not file.is_file() or not file.name.lower().endswith(('.ssr', '.ssx')):
            continue
        resolved = file.resolve(strict=True)
        if not resolved.is_relative_to(root) or file.stat().st_size <= 1:
            raise ValueError('Invalid configuration file')
        stat = file.stat()
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        identity = int(hashlib.sha256(file.relative_to(root).as_posix().encode()).hexdigest()[:12], 16)
        rows.append((identity, str(resolved), file.name, stat.st_size, stat.st_mtime_ns, digest))
    if not rows:
        raise ValueError('No module configurations')
    output.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(output)
    try:
        db.execute('CREATE TABLE configurations(id INTEGER PRIMARY KEY,path TEXT UNIQUE,name TEXT,bytes INTEGER,mtime_ns INTEGER,sha256 TEXT)')
        db.executemany('INSERT INTO configurations VALUES(?,?,?,?,?,?)', rows)
        db.commit()
        print('module-configs=' + str(len(rows)) + ' integrity=' + db.execute('PRAGMA integrity_check').fetchone()[0])
    finally:
        db.close()

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--root', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    build(args.root, args.output)
