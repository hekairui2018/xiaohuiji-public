"""Explicit path updates; no implicit recursive scans and no original writes."""
import argparse,datetime,json,uuid
from pathlib import Path
import engine

def update(work,paths):
    db=engine.connect(work);db.executescript('''CREATE TABLE IF NOT EXISTS location_history(id INTEGER PRIMARY KEY,location_id INTEGER,recorded_at TEXT,record TEXT);
CREATE TABLE IF NOT EXISTS incremental_tasks(path TEXT PRIMARY KEY,state TEXT,error TEXT,attempts INTEGER,updated_at TEXT);''')
    roots=[Path(r[0]).resolve() for r in db.execute('SELECT DISTINCT root FROM scans WHERE finished IS NOT NULL')];results=[]
    for value in paths:
        p=Path(value).resolve();stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();old=db.execute('SELECT * FROM locations WHERE path=?',(str(p),)).fetchone()
        try:
            if p.is_symlink() or not any(p==root or root in p.parents for root in roots):raise ValueError('Path is outside registered source roots')
            if p.exists() and not p.is_file():raise ValueError('Explicit files required; directory traversal is not allowed')
            if old:db.execute('INSERT INTO location_history(location_id,recorded_at,record) VALUES(?,?,?)',(old['id'],stamp,engine.J(dict(old))))
            if not p.exists():
                if old:db.execute("UPDATE locations SET state='missing' WHERE id=?",(old['id'],))
                state='missing' if old else 'not-registered'
            else:
                stat=p.stat();kind=engine.kind(p)
                if stat.st_size>engine.byte_budget(p):raise ValueError('Explicit file exceeds bounded hashing budget')
                sha=old['sha256'] if old and old['sha256'] and (old['bytes'],old['mtime_ns'])==(stat.st_size,stat.st_mtime_ns) else engine.digest(p)
                after=p.stat()
                if (after.st_size,after.st_mtime_ns)!=(stat.st_size,stat.st_mtime_ns):raise ValueError('File changed during update')
                known=db.execute('SELECT resource_id FROM versions WHERE sha256=? LIMIT 1',(sha,)).fetchone()
                # A newly observed path with the same hash can relocate an old
                # missing path. Existing readable duplicates remain independent locations.
                if not old:
                    for previous in db.execute("SELECT * FROM locations WHERE sha256=? AND state='present'",(sha,)).fetchall():
                        if not Path(previous['path']).exists():
                            db.execute('INSERT INTO location_history(location_id,recorded_at,record) VALUES(?,?,?)',(previous['id'],stamp,engine.J(dict(previous))))
                            db.execute("UPDATE locations SET state='missing' WHERE id=?",(previous['id'],))
                rid=old['resource_id'] if old else known[0] if known else 'res-'+uuid.uuid4().hex;vid=engine.identifier('ver-',rid+'|'+sha)
                db.execute('INSERT OR IGNORE INTO resources VALUES(?,?)',(rid,stamp));db.execute('INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?)',(vid,rid,sha,stat.st_size,stat.st_mtime_ns))
                scan=db.execute('SELECT id,root FROM scans WHERE finished IS NOT NULL').fetchall();scan_id=next(r[0] for r in scan if Path(r[1]).resolve() in p.parents)
                state='partial-download' if p.name.lower().endswith(engine.PARTIAL) else 'empty-file' if not stat.st_size else 'present'
                db.execute('''INSERT INTO locations(path,parent,name,extension,kind,resource_id,version_id,bytes,mtime_ns,sha256,state,scan_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(path) DO UPDATE SET parent=excluded.parent,name=excluded.name,extension=excluded.extension,kind=excluded.kind,version_id=excluded.version_id,bytes=excluded.bytes,mtime_ns=excluded.mtime_ns,sha256=excluded.sha256,state=excluded.state''',(str(p),str(p.parent),p.name,p.suffix.lower(),kind,rid,vid,stat.st_size,stat.st_mtime_ns,sha,state,scan_id))
                lid=db.execute('SELECT id FROM locations WHERE path=?',(str(p),)).fetchone()[0]
                db.execute('DELETE FROM file_fts WHERE rowid=?',(lid,));db.execute('INSERT INTO file_fts(rowid,name,path,tokens) VALUES(?,?,?,?)',(lid,engine.fts_tokens(p.name),engine.fts_tokens(str(p)),engine.fts_tokens(p.name+' '+str(p.parent))))
                db.execute('DELETE FROM models WHERE location_id=?',(lid,));db.execute('DELETE FROM model_owners WHERE location_id=?',(lid,))
                db.executemany('INSERT OR IGNORE INTO models VALUES(?,?,?)',[(lid,m,'filename-or-path-hint-not-compatibility') for m in engine.model_tokens(str(p))])
                db.executemany('INSERT OR IGNORE INTO model_owners VALUES(?,?)',[(lid,m) for m in engine.model_tokens(str(p))&engine.known_product_models()])
                mentions=[r[0] for r in db.execute('SELECT DISTINCT j.value FROM blocks b,json_each(b.models) j WHERE b.hash=?',(sha,))]
                db.executemany('INSERT OR IGNORE INTO models VALUES(?,?,?)',[(lid,m,'body-mention-not-compatibility') for m in mentions])
            db.execute("INSERT INTO incremental_tasks VALUES(?,?,?,1,?) ON CONFLICT(path) DO UPDATE SET state=excluded.state,error=NULL,attempts=attempts+1,updated_at=excluded.updated_at",(str(p),'done',None,stamp));db.commit();results.append({'path':str(p),'state':state})
        except Exception as exc:
            db.rollback();db.execute("INSERT INTO incremental_tasks VALUES(?,?,?,1,?) ON CONFLICT(path) DO UPDATE SET state=excluded.state,error=excluded.error,attempts=attempts+1,updated_at=excluded.updated_at",(str(p),'failed',str(exc),stamp));db.commit();results.append({'path':str(p),'state':'failed','error':str(exc)})
    db.close();return results

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--work',default=str(engine.DEFAULT_WORK));parser.add_argument('--paths-json');parser.add_argument('--retry-failed',action='store_true');args=parser.parse_args()
    paths=json.loads(Path(args.paths_json).read_text(encoding='utf-8-sig')) if args.paths_json else []
    if args.retry_failed:
        db=engine.connect(args.work,True);paths.extend(r[0] for r in db.execute("SELECT path FROM incremental_tasks WHERE state='failed'"));db.close()
    results=update(args.work,list(dict.fromkeys(paths)))
    for result in results:
        if result['state']=='present' and engine.kind(Path(result['path']))=='document':
            result['parse']=engine.index_documents(args.work,limit=1,contains=result['path'],retry=args.retry_failed)
            if result['parse'].get('failed'):
                db=engine.connect(args.work);db.execute("UPDATE incremental_tasks SET state='failed',error='document-parse-failed' WHERE path=?",(result['path'],));db.commit();db.close();result['state']='failed';result['error']='document-parse-failed'
    print(engine.J(results))
