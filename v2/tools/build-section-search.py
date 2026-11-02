"""Immutable public-original section and file-attribute index, no source writes."""
import argparse,pathlib,json,sys,sqlite3,hashlib,time,os
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'v2/resource-index'))
from document_sections import sections
from file_attributes import attributes
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def build(output,selection):
    output=pathlib.Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
    catalog=json.loads((ROOT/'v2/data/catalog/catalog.json').read_text(encoding='utf-8-sig'))
    items=catalog['items'];by_path={str(pathlib.Path(e['storage']['sourceRoot'])/pathlib.Path(e['storage']['relativePath'])):e for e in items}
    selected=json.loads(pathlib.Path(selection).read_text(encoding='utf-8'))
    db=sqlite3.connect(output/'sections.db');db.row_factory=sqlite3.Row
    db.executescript('''CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,kind TEXT,name TEXT,path TEXT,sha256 TEXT,size INTEGER,mtime_ns INTEGER,models TEXT,attributes TEXT,source_name TEXT,source_sha256 TEXT,source_path TEXT,download TEXT);
    CREATE TABLE IF NOT EXISTS sections(id TEXT PRIMARY KEY,file_id TEXT,heading TEXT,text TEXT,locator TEXT,ordinal INTEGER, FOREIGN KEY(file_id) REFERENCES files(id));
    CREATE TABLE IF NOT EXISTS progress(id TEXT PRIMARY KEY,status TEXT,details TEXT);
    CREATE INDEX IF NOT EXISTS section_file ON sections(file_id);''')
    report={'documents':[],'errors':[],'catalogSHA256':sha(ROOT/'v2/data/catalog/catalog.json')}
    for i,group in enumerate(selected):
        chosen=group['chosen'];public=pathlib.Path(chosen['public']);e=by_path.get(str(public))
        if not e:raise ValueError('Not owner-approved: '+str(public))
        source=pathlib.Path(chosen.get('source') or public)
        fid=e['sha256'];done=db.execute('SELECT * FROM progress WHERE id=?',(fid,)).fetchone()
        if done and done['status']=='done':report['documents'].append(json.loads(done['details']));continue
        try:
            assert sha(public)==fid
            source_sha=sha(source)
            if chosen.get('sha256'):assert source_sha==chosen['sha256']
            if source.suffix.lower() not in ('.docx','.pdf'):raise ValueError('Unsupported original type')
            rows,details=sections(source)
            if not rows:raise ValueError('No extractable text; OCR required')
            models=sorted(set(m for item in group.get('otherDocx',[]) for m in [])) or e['models']
            stat=public.stat();kind='spec' if group['kind']=='规格书' else 'manual'
            from urllib.parse import quote
            download='/v2/curated-documents/'+fid+'/'+quote(public.name)
            db.execute('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(fid,kind,public.name,str(public),fid,stat.st_size,stat.st_mtime_ns,json.dumps(models),json.dumps({'version':e.get('version'),'language':e.get('language'),'sourceBasis':'same-name-version-DOCX' if source!=public else 'public-original'},ensure_ascii=False),source.name,source_sha,str(source),download))
            db.execute('DELETE FROM sections WHERE file_id=?',(fid,))
            for j,s in enumerate(rows):
                sid=hashlib.sha256((fid+'|'+str(j)+'|'+s['text']).encode()).hexdigest()
                locator={'section':' → '.join(s['sectionPath']),'positions':s['locators'],'sourceFormat':source.suffix,'imageCount':s['imageCount']}
                db.execute('INSERT INTO sections VALUES(?,?,?,?,?,?)',(sid,fid,json.dumps(s['sectionPath'],ensure_ascii=False),s['text'],json.dumps(locator,ensure_ascii=False),j))
            details.update(name=public.name,subject=group['subject'],fileId=fid,kind=kind,sourceName=source.name,sourceSha256=source_sha)
            db.execute('INSERT OR REPLACE INTO progress VALUES(?,?,?)',(fid,'done',json.dumps(details,ensure_ascii=False)));db.commit();report['documents'].append(details)
            print('SECTIONED',i+1,len(selected),public.name,len(rows),flush=True)
        except Exception as ex:
            error={'name':public.name,'error':str(ex)};report['errors'].append(error);print('PARSE_ERROR',error,flush=True)
        (output/'build.private.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    for e in items:
        if e['type'] not in ('video','firmware'):continue
        file=pathlib.Path(e['storage']['sourceRoot'])/e['storage']['relativePath'];stat=file.stat();assert sha(file)==e['sha256']
        sf=e.get('sourceFields',{});folders=list(pathlib.Path(e['storage']['relativePath']).parts[1:-1]);att=attributes(e['name'],folders,sf)
        att.update(category=e.get('category'),software=att['software'],publishStatus=sf.get('publishStatus'),chip=sf.get('chip'))
        if sf.get('chip') and sf['chip'] not in att['chips']:att['chips'].append(sf['chip'])
        route='videos' if e['type']=='video' else 'firmware'
        from urllib.parse import quote
        download='/v2/curated-'+route+'/'+e['sha256']+'/'+quote(e['name'])
        db.execute('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(e['sha256'],e['type'],e['name'],str(file),e['sha256'],stat.st_size,stat.st_mtime_ns,json.dumps(e['models']),json.dumps(att,ensure_ascii=False),e['name'],e['sha256'],str(file),download))
    configroot=pathlib.Path('G:/公网发布资料/模组配置文件').resolve()
    for file in sorted(configroot.rglob('*')):
        if file.suffix.lower() not in ('.ssr','.ssx') or not file.is_file():continue
        if not file.resolve().is_relative_to(configroot):raise ValueError('Escaped configuration root')
        digest=sha(file);stat=file.stat();rel=file.relative_to(configroot);att=attributes(file.name,list(rel.parts[:-1]))
        fid='config-'+hashlib.sha256(str(rel).encode()).hexdigest()
        db.execute('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(fid,'module-config',file.name,str(file),digest,stat.st_size,stat.st_mtime_ns,'[]',json.dumps(att,ensure_ascii=False),file.name,digest,str(file),'/v2/fulltext-file/'+fid))
    db.commit();report.update(files=db.execute('SELECT COUNT(*) FROM files').fetchone()[0],sections=db.execute('SELECT COUNT(*) FROM sections').fetchone()[0],kinds=dict(db.execute('SELECT kind,COUNT(*) FROM files GROUP BY kind')),integrity=db.execute('PRAGMA integrity_check').fetchone()[0])
    (output/'build.private.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');db.close();print(json.dumps({k:v for k,v in report.items() if k not in ('documents','errors')},ensure_ascii=False))
if __name__=='__main__':
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--selection',required=True);a=p.parse_args();build(a.output,a.selection)
