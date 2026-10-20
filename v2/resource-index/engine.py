"""Isolated, offline resource candidate. Original roots are NEVER written.

SQLite is the catalogue and exact evidence store, not a generated FAQ corpus.
Run `python engine.py --help`. No existing application imports this module.
"""
import argparse
import collections
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import csv
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
import uuid
import zipfile
from functools import lru_cache
from xml.etree import ElementTree as ET

VERSION = 'resource-parser-1'
PROJECT = Path(__file__).resolve().parents[2]
DEFAULT_WORK = PROJECT / 'tmp/resource-index-stage1-20261016'
SUPPORTED = {'.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv', '.html', '.htm', '.log', '.rtf'}
LEGACY = {'.doc', '.ppt', '.xls', '.wps', '.chm'}
DOCS = SUPPORTED | LEGACY
PARTIAL = ('.drivedownload', '.folderdownload', '.part', '.crdownload', '.tmp')
EXCLUDE = {'$RECYCLE.BIN', 'System Volume Information', '.git'}
SECRET = {'.pem', '.key', '.pfx', '.p12', '.jks', '.pk8', '.env'}
MAX_FILE = 256 * 1024**2
MAX_XML = 64 * 1024**2
MAX_CHARS = 6_000_000
J = lambda x: json.dumps(x, ensure_ascii=False, separators=(',', ':'))


def digest(p):
    with open(p, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def byte_budget(path):
    # Media-heavy Office files can be large while their XML is small. Only XML
    # is extracted, with a separate strict expansion cap; embedded media stays untouched.
    return 1024**3 if Path(path).suffix.lower() in {'.docx','.pptx','.xlsx'} else MAX_FILE


def identifier(prefix, value):
    return prefix + hashlib.sha256(value.encode('utf8')).hexdigest()[:32]


def normalize_model(s):
    return re.sub(r'^HD[-_ ]?', '', str(s).strip().upper())


def model_tokens(s):
    # Keep suffixes atomic. A3 is never a prefix match for A3L.
    return set(normalize_model(m.group()) for m in re.finditer(
        r'(?<![A-Z0-9])(?:HD[-_ ]?)?(?:[A-Z]{1,8}\d[A-Z0-9]*(?:[-_][A-Z0-9]+)*|\d+[A-Z][A-Z0-9]*)(?![A-Z0-9])', s.upper()))


@lru_cache(maxsize=1)
def known_product_models():
    folder=PROJECT/'v2/data/knowledge-next'
    manifest=json.loads((folder/'candidate-manifest.json').read_text(encoding='utf8'))
    raw=json.loads((folder/manifest['versionId']/'index.json').read_text(encoding='utf8'))
    return {normalize_model(p['modelId']) for p in raw['products'] if p.get('modelId')}


def fts_tokens(text):
    # Chinese bi-grams provide short-term recall without business intent rules.
    out = []
    for token in re.findall(r'[A-Za-z0-9]+(?:[-_.+][A-Za-z0-9]+)*|[\u3400-\u9fff]+', str(text)):
        if re.match(r'[\u3400-\u9fff]', token):
            out.extend(token[i:i+2] for i in range(len(token)-1))
            if len(token) == 1:
                out.append(token)
        else:
            out.append(token.lower())
    return ' '.join(out)


def kind(path):
    e = path.suffix.lower()
    if e in SECRET or path.name.lower().startswith('.env'):
        return 'sensitive-metadata-only'
    if e in DOCS:
        return 'document'
    if e in {'.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'}:
        return 'archive'
    if e in {'.mp4', '.avi', '.mov', '.mkv', '.wmv'}:
        return 'video'
    if e in {'.exe', '.msi', '.apk', '.bin', '.img', '.zbin', '.dll'}:
        return 'software-firmware'
    return 'other'


def safe_work(work, root):
    work, root = Path(work).resolve(), Path(root).resolve()
    if work == root or root in work.parents:
        raise ValueError('Outputs must be outside the original source root')
    return work, root


def connect(work, readonly=False):
    work = Path(work).resolve()
    allowed=(PROJECT/'tmp').resolve()
    if work!=allowed and allowed not in work.parents:
        raise ValueError('Candidate index must stay under project tmp, never in original roots')
    if not readonly:
        work.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect((work/'resources.db').as_uri()+'?mode=ro', uri=True) if readonly else sqlite3.connect(work/'resources.db')
    db.row_factory = sqlite3.Row
    db.create_function('has_version',2,lambda name,wanted: int(str(wanted).upper() in {m.upper() for m in re.findall(r'(?i)V\d+(?:\.\d+)+(?!\d|\.\d)',name or '')}),deterministic=True)
    if not readonly:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,root TEXT,started TEXT,finished TEXT,errors TEXT);
        CREATE TABLE IF NOT EXISTS folders(path TEXT PRIMARY KEY,parent TEXT,scan_id TEXT);
        CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,created TEXT);
        CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,resource_id TEXT,sha256 TEXT,bytes INTEGER,mtime_ns INTEGER);
        CREATE INDEX IF NOT EXISTS versions_hash ON versions(sha256);
        CREATE TABLE IF NOT EXISTS locations(id INTEGER PRIMARY KEY,path TEXT UNIQUE,parent TEXT,name TEXT,extension TEXT,kind TEXT,resource_id TEXT,version_id TEXT,bytes INTEGER,mtime_ns INTEGER,sha256 TEXT,state TEXT,scan_id TEXT,cloud_id TEXT,cloud_url TEXT,cloud_version TEXT);
        CREATE INDEX IF NOT EXISTS locations_hash ON locations(sha256);
        CREATE INDEX IF NOT EXISTS locations_version ON locations(version_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(name,path,tokens);
        CREATE TABLE IF NOT EXISTS parses(hash TEXT PRIMARY KEY,parser TEXT,state TEXT,blocks INTEGER,error TEXT,details TEXT);
        CREATE TABLE IF NOT EXISTS blocks(id INTEGER PRIMARY KEY,hash TEXT,ordinal INTEGER,locator TEXT,text TEXT,text_hash TEXT,models TEXT, UNIQUE(hash,ordinal));
        CREATE INDEX IF NOT EXISTS blocks_hash ON blocks(hash);
        CREATE INDEX IF NOT EXISTS blocks_text_hash ON blocks(text_hash);
        CREATE VIRTUAL TABLE IF NOT EXISTS block_fts USING fts5(tokens);
        CREATE TABLE IF NOT EXISTS models(location_id INTEGER,model TEXT,basis TEXT, UNIQUE(location_id,model,basis));
        CREATE INDEX IF NOT EXISTS models_value ON models(model,location_id);
        CREATE TABLE IF NOT EXISTS model_owners(location_id INTEGER,model TEXT, UNIQUE(location_id,model));
        CREATE TABLE IF NOT EXISTS classifications(hash TEXT,category TEXT,block_id INTEGER,basis TEXT, UNIQUE(hash,category));
        CREATE TABLE IF NOT EXISTS reference_repairs(old_path TEXT,sha256 TEXT,status TEXT,locations TEXT,source TEXT, UNIQUE(old_path,sha256));
        CREATE TABLE IF NOT EXISTS old_coverage(case_id TEXT,hash TEXT,block_id INTEGER,basis TEXT, UNIQUE(case_id,hash,block_id));
        ''')
    return db


def scan(root, work, hash_cache=None):
    work, root = safe_work(work, root)
    db = connect(work)
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    scan_id = uuid.uuid4().hex
    db.execute('INSERT INTO scans VALUES(?,?,?,?,?)', (scan_id,str(root),stamp,None,'[]'))
    cached = {}
    if hash_cache and Path(hash_cache).is_file():
        try:
            data = json.loads(Path(hash_cache).read_text(encoding='utf8'))
            cached = {x['path']:x for x in data.get('files',[]) if x.get('sha256') and x.get('hashStatus')=='已核SHA256'}
        except (ValueError,KeyError):
            pass
    errors, count, hashes, reused = [], 0, 0, 0
    for base, dirs, names in os.walk(root, followlinks=False, onerror=lambda e: errors.append(str(e))):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDE and not (Path(base)/d).is_symlink() and not (hasattr(os.path,'isjunction') and os.path.isjunction(Path(base)/d)))
        db.execute('INSERT OR REPLACE INTO folders VALUES(?,?,?)',(base,str(Path(base).parent),scan_id))
        for name in sorted(names):
            p = Path(base)/name
            if p.is_symlink():
                errors.append('Skipped symlink '+str(p)); continue
            try:
                s=p.stat(); e=p.suffix.lower(); k=kind(p); old=db.execute('SELECT * FROM locations WHERE path=?',(str(p),)).fetchone()
                state='partial-download' if name.lower().endswith(PARTIAL) else 'office-lock-file' if name.startswith('~$') else 'empty-file' if not s.st_size else 'present'
                sha=None
                if k=='document' and state=='present':
                    previous = old if old else cached.get(str(p))
                    old_size=previous['bytes'] if previous else None
                    old_time=(previous['mtime_ns'] if old else previous.get('mtimeNs')) if previous else None
                    if previous and old_size==s.st_size and old_time==s.st_mtime_ns and previous['sha256']:
                        sha=previous['sha256']; reused+=1
                    elif s.st_size<=byte_budget(p):
                        sha=digest(p); hashes+=1
                    else:
                        state='deferred-size-limit'
                    after=p.stat()
                    if (after.st_size,after.st_mtime_ns)!=(s.st_size,s.st_mtime_ns):
                        sha=None;state='changed-during-scan'
                elif old and old['sha256'] and (old['bytes'],old['mtime_ns'])==(s.st_size,s.st_mtime_ns) and state=='present':
                    sha=old['sha256']
                if old:
                    rid=old['resource_id']
                else:
                    match=db.execute('SELECT resource_id FROM versions WHERE sha256=? LIMIT 1',(sha,)).fetchone() if sha else None
                    rid=match[0] if match else 'res-'+uuid.uuid4().hex
                vid=identifier('ver-',rid+'|'+(sha or str(s.st_size)+'|'+str(s.st_mtime_ns)))
                db.execute('INSERT OR IGNORE INTO resources VALUES(?,?)',(rid,stamp))
                db.execute('INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?)',(vid,rid,sha,s.st_size,s.st_mtime_ns))
                db.execute('''INSERT INTO locations(path,parent,name,extension,kind,resource_id,version_id,bytes,mtime_ns,sha256,state,scan_id)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET parent=excluded.parent,name=excluded.name,extension=excluded.extension,kind=excluded.kind,resource_id=excluded.resource_id,version_id=excluded.version_id,bytes=excluded.bytes,mtime_ns=excluded.mtime_ns,sha256=excluded.sha256,state=excluded.state,scan_id=excluded.scan_id''',
                   (str(p),base,name,e,k,rid,vid,s.st_size,s.st_mtime_ns,sha,state,scan_id))
                lid=db.execute('SELECT id FROM locations WHERE path=?',(str(p),)).fetchone()[0]
                db.execute('DELETE FROM file_fts WHERE rowid=?',(lid,))
                db.execute('INSERT INTO file_fts(rowid,name,path,tokens) VALUES(?,?,?,?)',(lid,fts_tokens(name),fts_tokens(str(p)),fts_tokens(name+' '+str(p.parent))))
                if old and old['sha256']==sha:
                    db.execute("DELETE FROM models WHERE location_id=? AND basis='filename-or-path-hint-not-compatibility'",(lid,))
                else:
                    db.execute('DELETE FROM models WHERE location_id=?',(lid,))
                    if sha:
                        cached_mentions=[r[0] for r in db.execute('SELECT DISTINCT j.value FROM blocks b,json_each(b.models) j WHERE b.hash=?',(sha,))]
                        db.executemany('INSERT OR IGNORE INTO models VALUES(?,?,?)',[(lid,m,'body-mention-not-compatibility') for m in cached_mentions])
                db.executemany('INSERT OR IGNORE INTO models VALUES(?,?,?)',[(lid,m,'filename-or-path-hint-not-compatibility') for m in model_tokens(str(p))])
                db.execute('DELETE FROM model_owners WHERE location_id=?',(lid,))
                db.executemany('INSERT OR IGNORE INTO model_owners VALUES(?,?)',[(lid,m) for m in model_tokens(str(p)) & known_product_models()])
                # Preserve literal .url targets, never invent IDs or versions from names.
                if e=='.url' and s.st_size<64*1024:
                    text=p.read_text(encoding='utf-8-sig',errors='replace')
                    url=re.search(r'^URL=(https?://[^\r\n]+)',text,re.M|re.I)
                    if url and re.match(r'https?://[^/]*(?:feishu\.cn|larksuite\.com|larkoffice\.com)/',url[1],re.I):
                        token=re.search(r'/(?:wiki|docx|docs|file|sheets|base)/([A-Za-z0-9]+)',url[1])
                        db.execute('UPDATE locations SET cloud_url=?,cloud_id=? WHERE id=?',(url[1],token[1] if token else None,lid))
                count+=1
                if count%250==0:db.commit()
            except (OSError,ValueError) as exc:
                errors.append(str(p)+': '+str(exc))
        db.commit()
    # Absence is only recorded after a complete, error-free traversal. No originals are removed.
    if not errors:
        db.execute('UPDATE locations SET state=? WHERE scan_id!=? AND (path=? OR path LIKE ?)',('missing',scan_id,str(root),str(root)+os.sep+'%'))
    db.execute('UPDATE scans SET finished=?,errors=? WHERE id=?',(datetime.datetime.now(datetime.timezone.utc).isoformat(),J(errors),scan_id))
    db.commit(); db.close()
    return {'scanId':scan_id,'files':count,'newHashes':hashes,'cachedHashes':reused,'errors':errors}


def decode(raw):
    encodings=['utf-16'] if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else []
    for enc in encodings+['utf-8-sig','gb18030']:
        try:return raw.decode(enc)
        except UnicodeError:pass
    raise ValueError('Unrecognized text encoding')


def extract(path):
    path=Path(path); e=path.suffix.lower(); blocks=[]; chars=0; details={'images':'not-OCRed','tables':'native-office-rows; PDF text layout not validated'}
    def add(text, **locator):
        nonlocal chars
        text=str(text).strip()
        if any(0xD800<=ord(ch)<=0xDFFF for ch in text):
            # Recover valid UTF-16 pairs emitted by some PDF fonts. Lone halves
            # are marked, never guessed as an engineering character.
            repaired=text.encode('utf-16-le','surrogatepass').decode('utf-16-le','replace')
            details.setdefault('encodingRepairs',[]).append({'locator':locator,'replacementCharacters':repaired.count('\ufffd')})
            text=repaired
        if not text:return
        if len(text)>100_000:
            for i in range(0,len(text),50_000):add(text[i:i+50_000],**locator,part=i//50_000)
            return
        chars+=len(text)
        if chars>MAX_CHARS or len(blocks)>50000:raise ValueError('Document extraction budget exceeded')
        blocks.append({'text':text,'locator':locator})
    if path.stat().st_size>byte_budget(path):raise ValueError('Document byte limit exceeded')
    if e=='.pdf':
        from pypdf import PdfReader
        reader=PdfReader(str(path),strict=False)
        if reader.is_encrypted and not reader.decrypt(''):return {'state':'encrypted','blocks':[],'details':details}
        if len(reader.pages)>1000:raise ValueError('PDF page limit exceeded')
        image_pages=[]
        for page_no,page in enumerate(reader.pages,1):
            text=page.extract_text() or ''
            if len(re.sub(r'\s','',text))<15:image_pages.append(page_no)
            # Original offsets within the extracted page, not fabricated paragraph numbers.
            for start in range(0,len(text),1800):add(text[start:start+1800],page=page_no,charStart=start,charEnd=min(start+1800,len(text)))
        details['ocrPendingPages']=image_pages;details['pageCount']=len(reader.pages)
        details['pageCoordinates']='text offsets only; no image/table geometry claim'
    elif e in {'.docx','.pptx','.xlsx'}:
        if not zipfile.is_zipfile(path):
            with path.open('rb') as f:signature=f.read(8)
            if signature==bytes.fromhex('d0cf11e0a1b11ae1'):
                return {'state':'misnamed-legacy-office','blocks':[],'details':{**details,'signature':'OLE compound document; extension is not OOXML'}}
        with zipfile.ZipFile(path) as z:
            xmls=[i for i in z.infolist() if i.filename.endswith('.xml')]
            if sum(i.file_size for i in xmls)>MAX_XML or any(i.file_size>MAX_XML for i in xmls):raise ValueError('OOXML expansion limit exceeded')
            if e=='.docx':
                ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                root=ET.fromstring(z.read('word/document.xml')); body=root.find('w:body',ns); section='';paragraph=table=0
                for node in body:
                    if node.tag.endswith('}p'):
                        paragraph+=1;text=''.join(x.text or '' for x in node.iter() if x.tag.endswith('}t'))
                        style=node.find('w:pPr/w:pStyle',ns)
                        if style is not None and re.search('heading|标题',str(list(style.attrib.values())),re.I):section=text
                        add(text,part='word/document.xml',paragraph=paragraph,section=section)
                    elif node.tag.endswith('}tbl'):
                        table+=1
                        for ri,row in enumerate(node.findall('w:tr',ns),1):
                            cells=[''.join(x.text or '' for x in cell.iter() if x.tag.endswith('}t')) for cell in row.findall('w:tc',ns)]
                            if any(c.strip() for c in cells):add(' | '.join(cells),part='word/document.xml',table=table,row=ri,cells=cells,section=section)
                details['limitations']='body paragraphs/tables; embedded images and headers not OCRed'
            elif e=='.pptx':
                ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
                names=sorted((n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml',n)),key=lambda n:int(re.search(r'(\d+)\.xml',n)[1]))
                for name in names:
                    root=ET.fromstring(z.read(name)); slide=int(re.search(r'(\d+)\.xml',name)[1])
                    for pi,p in enumerate(root.findall('.//a:p',ns),1):add(''.join(t.text or '' for t in p.findall('.//a:t',ns)),slide=slide,paragraph=pi,part=name)
                    # Notes are attached via the slide relation; numbering alone is not reliable.
                    relname='ppt/slides/_rels/'+Path(name).name+'.rels'
                    if relname in z.namelist():
                        for rel in ET.fromstring(z.read(relname)):
                            if rel.attrib.get('Type','').endswith('/notesSlide') and rel.attrib.get('TargetMode')!='External':
                                import posixpath
                                target=posixpath.normpath(posixpath.join('ppt/slides',rel.attrib['Target']))
                                if target in z.namelist():
                                    note=ET.fromstring(z.read(target))
                                    for pi,p in enumerate(note.findall('.//a:p',ns),1):add(''.join(t.text or '' for t in p.findall('.//a:t',ns)),slide=slide,noteParagraph=pi,part=target)
                details['limitations']='slide text/table-cell paragraphs and speaker notes; images not OCRed'
        if e=='.xlsx':
            from openpyxl import load_workbook
            wb=load_workbook(path,read_only=True,data_only=False,keep_links=False)
            try:
                for sheet in wb:
                    # Some downloaded sheets falsely declare A1:A1 despite having many rows.
                    # Stream the actual worksheet XML instead of trusting its dimension hint.
                    sheet.reset_dimensions()
                    for row_number,row in enumerate(sheet.iter_rows(),1):
                        if row_number>100000:raise ValueError('Worksheet row budget exceeded')
                        cells=[{'cell':c.coordinate,'value':str(c.value)} for c in row if c.value is not None]
                        if cells:add(' | '.join(c['value'] for c in cells),sheet=sheet.title,row=row_number,cells=cells)
            finally:wb.close()
            details['limitations']='formulas retained, not recalculated; images not OCRed; merged layout not reconstructed'
    elif e in {'.csv','.txt','.md','.html','.htm','.log','.rtf'}:
        text=decode(path.read_bytes())
        if e=='.csv':
            for ri,row in enumerate(csv.reader(io.StringIO(text)),1):add(' | '.join(row),row=ri,cells=row)
        else:
            for li,line in enumerate(text.splitlines(),1):add(line,line=li)
            if e in {'.html','.htm','.rtf'}:details['limitations']='source text with markup; not visual document rendering'
    else:return {'state':'unsupported-legacy','blocks':[],'details':details}
    return {'state':'parsed' if blocks else 'ocr-pending' if e in {'.pdf','.docx','.pptx'} else 'empty-text','blocks':blocks,'details':details}


CONTENT_PATTERNS = {
    'technical-parameters':r'规格书|技术参数|最大带载|控制范围|Specification|分辨率',
    'operation-method':r'操作步骤|操作说明|点击.{0,12}设置|用户手册|User Manual',
    'aftersales-experience':r'故障现象|问题现象|客户反馈|解决方法|解决方案|排查|维修|黑屏|花屏|闪屏',
    'manual-knowledge':r'常见问题|问题解答|FAQ|FQA|经验分享|经验总结|调试心得',
    'training-project':r'培训|工程方案|现场环境|项目案例|施工|技术分享',
    'ai-secondary-clue':r'(?:豆包|ChatGPT|AI|大模型).{0,8}(?:生成|整理|总结)',
}


def index_documents(work, limit=0, contains='', timeout=60, retry=False):
    db=connect(work); results=collections.Counter()
    rows=db.execute("SELECT sha256,MIN(path) path FROM locations WHERE kind='document' AND state='present' AND sha256 IS NOT NULL GROUP BY sha256 ORDER BY CASE WHEN path LIKE '%知识库%' THEN 0 WHEN path LIKE '%规格书%' THEN 1 ELSE 2 END,path").fetchall()
    done=0;pending=[]
    for item in rows:
        if contains and contains.lower() not in item['path'].lower():continue
        old=db.execute('SELECT * FROM parses WHERE hash=?',(item['sha256'],)).fetchone()
        if old and old['parser']==VERSION and not (retry and old['state']=='failed'):
            results['cacheHits']+=1;continue
        if limit and len(pending)>=limit:break
        pending.append(item)

    def parse_worker(item):
        before=Path(item['path']).stat(); started=time.monotonic()
        try:
            process=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--parse-one',item['path']],capture_output=True,timeout=timeout,env={**os.environ,'PYTHONIOENCODING':'utf-8'})
            if process.returncode:raise ValueError(process.stderr.decode('utf8',errors='replace')[-1600:])
            parsed=json.loads(process.stdout.decode('utf8')); after=Path(item['path']).stat()
            if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('Source changed during parsing')
            return item,before,started,parsed,None
        except Exception as exc:return item,before,started,None,exc

    def bounded_workers():
        # At most two parser processes and two returned payloads in memory.
        with ThreadPoolExecutor(max_workers=2) as pool:
            source=iter(pending);jobs=set()
            for item in source:
                jobs.add(pool.submit(parse_worker,item))
                if len(jobs)==2:break
            while jobs:
                complete,jobs=wait(jobs,return_when=FIRST_COMPLETED)
                for job in complete:
                    yield job.result()
                    item=next(source,None)
                    if item is not None:jobs.add(pool.submit(parse_worker,item))

    for item,before,started,parsed,error in bounded_workers():
        try:
            if error:raise error
            current=db.execute('SELECT bytes,mtime_ns FROM locations WHERE path=?',(item['path'],)).fetchone()
            if (before.st_size,before.st_mtime_ns)!=(current[0],current[1]):raise ValueError('Source changed since hash scan')
            db.execute('DELETE FROM block_fts WHERE rowid IN (SELECT id FROM blocks WHERE hash=?)',(item['sha256'],))
            db.execute('DELETE FROM blocks WHERE hash=?',(item['sha256'],));db.execute('DELETE FROM classifications WHERE hash=?',(item['sha256'],))
            for ordinal,b in enumerate(parsed['blocks']):
                text=b['text']; models=sorted(model_tokens(text)); canonical=re.sub(r'\s+','',text).casefold()
                cur=db.execute('INSERT INTO blocks(hash,ordinal,locator,text,text_hash,models) VALUES(?,?,?,?,?,?)',(item['sha256'],ordinal,J(b['locator']),text,hashlib.sha256(canonical.encode()).hexdigest(),J(models)))
                db.execute('INSERT INTO block_fts(rowid,tokens) VALUES(?,?)',(cur.lastrowid,fts_tokens(text)))
                for category,pattern in CONTENT_PATTERNS.items():
                    match=re.search(pattern,text,re.I)
                    if match:db.execute('INSERT OR IGNORE INTO classifications VALUES(?,?,?,?)',(item['sha256'],category,cur.lastrowid,J({'matched':match[0],'offset':match.start(),'authorshipVerified':False})))
            mentioned=set(m for b in parsed['blocks'] for m in model_tokens(b['text']))
            ids=[r[0] for r in db.execute('SELECT id FROM locations WHERE sha256=?',(item['sha256'],))]
            for lid in ids:db.execute("DELETE FROM models WHERE location_id=? AND basis='body-mention-not-compatibility'",(lid,))
            db.executemany('INSERT OR IGNORE INTO models VALUES(?,?,?)',[(lid,m,'body-mention-not-compatibility') for lid in ids for m in mentioned])
            state=parsed['state']; details=parsed.get('details',{})
            if state=='parsed' and details.get('ocrPendingPages'):state='parsed-ocr-pending'
            details['seconds']=round(time.monotonic()-started,3)
            db.execute('INSERT OR REPLACE INTO parses VALUES(?,?,?,?,?,?)',(item['sha256'],VERSION,state,len(parsed['blocks']),None,J(details)))
            results[state]+=1
        except Exception as exc:
            db.rollback();db.execute('INSERT OR REPLACE INTO parses VALUES(?,?,?,?,?,?)',(item['sha256'],VERSION,'failed',0,str(exc)[:1800],J({'seconds':round(time.monotonic()-started,3)})));results['failed']+=1
        db.commit(); done+=1
        if done%25==0:print(J({'processed':done,'results':dict(results)}),flush=True)
    db.close();return dict(results)


def group_document_hits(hits):
    """Return one best-scoring hit per actual content identity (browse-only).

    Caller sorts hits best-first. Preserve the best original hit and enrich it
    with the best available passage. This does NOT claim an exhaustive number
    of matches and does not infer model/firmware compatibility.
    """
    grouped = {}
    for hit in hits:
        identity = (hit.get('sha256') or hit.get('versionId') or
                    'location:' + str(hit.get('locationId') or hit.get('blockId')))
        record = grouped.get(identity)
        if record is None:
            record = dict(hit)
            record['candidatePassages'] = 0
            record['matchedFileName'] = False
            record['matchedLocations'] = []
            grouped[identity] = record
        if hit.get('kind') == 'file':
            record['matchedFileName'] = True
        if hit.get('kind') == 'passage':
            record['candidatePassages'] += 1
            # Keep independent original positions; never concatenate unrelated cases.
            if len(record['matchedLocations']) < 24:
                record['matchedLocations'].append({k:hit[k] for k in ('blockId','ordinal','locator') if k in hit})
            record['locationsTruncated'] = record['candidatePassages'] > len(record['matchedLocations'])
            if not record.get('text'):
                for field in ('text', 'blockId', 'ordinal', 'locator', 'mentionedModels'):
                    if field in hit:
                        record[field] = hit[field]
    return list(grouped.values())


def query(work, text, mode='all', model=None, limit=10, version=None, authorized_keys=None, include_history=False, group_documents=False):
    started=time.perf_counter();db=connect(work,True);limit=max(1,min(int(limit),50));terms=list(dict.fromkeys(fts_tokens(text).split()))
    requested={normalize_model(model)} if model else model_tokens(text)
    # Long firmware identifiers are not treated as known product aliases.
    known={r[0] for r in db.execute('SELECT DISTINCT model FROM models')}
    requested={m for m in requested & known if not re.fullmatch(r'V\d+',m)} if not model else requested
    generic={'规格','格书','说明','明书','固件','软件','下载','参数','资料','教程','视频'}
    meaningful=[t for t in terms if t not in generic and normalize_model(t) not in requested]
    search_terms=meaningful or terms
    match=' OR '.join('"'+t.replace('"','""')+'"' for t in search_terms)
    if not match and not requested:db.close();return {'query':text,'results':[],'elapsedMs':0}
    conditions=["l.state='present'", "l.kind!='sensitive-metadata-only'"]
    args=[]
    from current_documents import excluded_locations
    excluded = frozenset() if include_history or version or re.search(r'\bV\d+(?:\.\d+)+\b', text, re.I) else excluded_locations(db, work)
    if excluded:
        # Internal integer identities, applied BEFORE FTS/file candidate limits.
        conditions.append('l.id NOT IN ('+','.join(str(int(i)) for i in sorted(excluded))+')')
    # Apply caller authorization BEFORE either candidate limit. Post-filtering a
    # global Top N can hide permitted evidence behind unrelated/private hits.
    # None preserves the ordinary standalone catalogue search unchanged.
    if authorized_keys is not None:
        hashes=sorted(k for k in authorized_keys if not k.startswith('metadata:'))
        resource_ids=sorted(k[len('metadata:'):] for k in authorized_keys if k.startswith('metadata:'))
        clauses=[]
        for column,values in [('l.sha256',hashes),('l.resource_id',resource_ids)]:
            if values:
                clauses.append(column+' IN ('+','.join('?' for _ in values)+')')
                args.extend(values)
        conditions.append('('+(' OR '.join(clauses) if clauses else '0')+')')
    if requested:
        conditions.append('EXISTS(SELECT 1 FROM models m WHERE m.location_id=l.id AND m.model IN ('+','.join('?' for _ in requested)+'))');args.extend(sorted(requested))
        conditions.append('(NOT EXISTS(SELECT 1 FROM model_owners o WHERE o.location_id=l.id) OR EXISTS(SELECT 1 FROM model_owners o WHERE o.location_id=l.id AND o.model IN ('+','.join('?' for _ in requested)+')))');args.extend(sorted(requested))
    if version:conditions.append('has_version(l.name,?)=1');args.append(version)
    where=' AND '.join(conditions);hits=[]
    if mode in {'all','files'}:
        file_where=where
        file_args=list(args)
        if match and not requested:
            file_where+=' AND file_fts MATCH ?';file_args.append(match)
            rows=db.execute('SELECT l.* FROM file_fts JOIN locations l ON l.id=file_fts.rowid WHERE '+file_where+' ORDER BY bm25(file_fts,8,2,1) LIMIT 1000',file_args).fetchall()
        else:
            rows=db.execute('SELECT l.* FROM locations l WHERE '+file_where+' LIMIT 1000',file_args).fetchall()
        for r in rows:
            score=sum(1 for t in terms if t in fts_tokens(r['name']).split())*6+sum(1 for t in terms if t in fts_tokens(r['parent']).split())
            if re.sub(r'\s+','',text).casefold() in re.sub(r'\s+','',r['name']).casefold():score+=50
            # Do not make a binary resource outrank a requested document type.
            if '规格书' in text and '规格书' in r['name'] or '说明书' in text and '说明书' in r['name']:score+=30
            hits.append({'kind':'file','locationId':r['id'],'resourceId':r['resource_id'],'versionId':r['version_id'],'sha256':r['sha256'],'name':r['name'],'score':score,'text':None,'locator':None})
    if mode in {'all','text'} and match:
        # SQL model filtering happens before the candidate limit.
        rows=db.execute('''SELECT b.*,bm25(block_fts) rank FROM block_fts JOIN blocks b ON b.id=block_fts.rowid
            WHERE block_fts MATCH ? AND EXISTS(SELECT 1 FROM locations l WHERE l.sha256=b.hash AND '''+where+''') ORDER BY rank LIMIT 600''',[match]+args).fetchall()
        for r in rows:
            block_models=set(json.loads(r['models']))
            # Explicitly different product in the matching passage is not scope evidence.
            if requested and block_models and not requested.intersection(block_models):continue
            tokens=set(fts_tokens(r['text']).split());matched=sum(t in tokens for t in search_terms)
            hits.append({'kind':'passage','blockId':r['id'],'sha256':r['hash'],'ordinal':r['ordinal'],'text':r['text'],'locator':json.loads(r['locator']),'score':matched*4+max(0,-r['rank']),'mentionedModels':sorted(block_models)})
    hits.sort(key=lambda h:(-h['score'],h.get('blockId',0),h.get('locationId',0)))
    # Only the employee document-browser opts in. Other search clients retain
    # their original fine-grained passage ranking and response shape.
    if group_documents:
        hits = group_document_hits(hits)
    seen=set();out=[]
    for hit in hits:
        key=(hit['kind'],hit.get('sha256') or hit.get('locationId'),hit.get('ordinal'))
        if key in seen:continue
        seen.add(key)
        locations=db.execute('SELECT id,path,name,resource_id,version_id,mtime_ns,cloud_id,cloud_url FROM locations WHERE '+('sha256=?' if hit.get('sha256') else 'id=?')+" AND state='present'",(hit.get('sha256') or hit.get('locationId'),)).fetchall()
        locations=[l for l in locations if l['id'] not in excluded]
        if requested:
            locations=[l for l in locations if db.execute('SELECT 1 FROM models WHERE location_id=? AND model IN ('+','.join('?' for _ in requested)+')',[l['id']]+sorted(requested)).fetchone()]
        if not locations:continue
        hit['locations']=[dict(l) for l in locations];hit['name']=locations[0]['name'];hit['versionId']=locations[0]['version_id'];hit['resourceId']=locations[0]['resource_id']
        hit['sourceType']='unknown';hit['scopeStatus']='model-mention-or-path-hint-not-compatibility';hit['versions']=re.findall(r'(?i)\bV\d+(?:\.\d+)+',hit['name'])
        hit['readMore']='/read?block='+str(hit['blockId']) if hit['kind']=='passage' else '/resource?id='+str(locations[0]['id'])
        out.append(hit)
        if len(out)>=limit:break
    db.close();return {'query':text,'requestedModels':sorted(requested),'results':out,'returnedCount':len(out),'limitReached':len(out)>=limit,'countScope':'returned-candidates-not-total','elapsedMs':round((time.perf_counter()-started)*1000,3)}


def document_filename_identity(name):
    # Presentation syntax only: keep suffixes, versions, language and extension.
    # Never remove arbitrary punctuation or perform partial/fuzzy model matching.
    name=re.sub(r'^HD(?:[-_ ]|(?=[A-Z]+\d))', '', name, flags=re.I)
    return re.sub(r'\s+', ' ', re.sub(r'\s*&\s*', ' ', name)).strip().casefold()


def resolve_documents(work, items):
    """Resolve registered originals only. Never fuzzy-match a model/version or rescan data."""
    if not isinstance(items,list) or len(items)>1024:
        raise ValueError('invalid-document-list')
    db=connect(work,True)
    try:
        roots=[Path(r[0]).resolve() for r in db.execute('SELECT DISTINCT root FROM scans WHERE finished IS NOT NULL')]
        # The existing catalogue has no name index. Fetch the requested names in
        # bounded batches, instead of scanning all locations once per document.
        # No index/schema writes or cached filesystem decisions are introduced.
        names=sorted({item['name'] for item in items if isinstance(item,dict) and isinstance(item.get('name'),str) and item['name'] and len(item['name'])<=512 and not any(c in item['name'] for c in ('/','\\','\0'))})
        by_name=collections.defaultdict(list)
        for offset in range(0,len(names),500):
            batch=names[offset:offset+500]
            rows=db.execute("SELECT id,path,name,resource_id,version_id,sha256,bytes,mtime_ns FROM locations WHERE name IN ("+','.join('?' for _ in batch)+") AND state='present' AND kind='document'",batch).fetchall()
            for row in rows:by_name[row['name']].append(row)
        missing={document_filename_identity(name) for name in names if name not in by_name}
        alternatives=collections.defaultdict(list)
        relocated=collections.defaultdict(list)
        if missing:
            current_by_hash=collections.defaultdict(list);historical=[]
            for row in db.execute("SELECT id,path,name,resource_id,version_id,sha256,bytes,mtime_ns,state FROM locations WHERE state IN ('present','missing') AND kind='document'"):
                if row['state']=='missing':
                    if row['name'] in names and row['sha256']:historical.append(row)
                    continue
                current_by_hash[row['sha256']].append(row)
                identity=document_filename_identity(row['name'])
                if identity in missing:alternatives[identity].append(row)
            for row in historical:relocated[row['name']].extend(current_by_hash.get(row['sha256'],[]))
        # A registered missing location is an identity record, not an absent
        # filename guess. Relocate only the same known hash; never substitute
        # a newer/different content version just because its name resembles it.
        results=[]
        for item in items:
            name=item.get('name') if isinstance(item,dict) else None
            expected=item.get('sha256') if isinstance(item,dict) else None
            if not isinstance(name,str) or not name or len(name)>512 or any(c in name for c in ('/','\\','\0')) or (expected is not None and not re.fullmatch(r'[a-f0-9]{64}',str(expected))):
                results.append({'available':False,'reason':'invalid-document-identity'});continue
            rows=by_name.get(name,[]) or alternatives.get(document_filename_identity(name),[]) or relocated.get(name,[])
            if not rows:
                results.append({'available':False,'reason':'original-not-registered'});continue
            # Website policy excludes signed editions, including files whose
            # edition is recorded only by their containing folder.
            def edition(row):
                label=re.sub(r'未签章|未盖章|未签字|unsigned','',row['path'],flags=re.I)
                if re.search(r'签章|盖章|签字|(?:^|[\\/\s_.(-])signed(?:[\\/\s_.)-]|$)',label,re.I):return 'signed'
                return 'neutral' if re.search(r'中性|(?:^|[\\/\s_.(-])neutral(?:[\\/\s_.)-]|$)',label,re.I) else 'standard'
            rows=[r for r in rows if edition(r)!='signed']
            if not rows:
                results.append({'available':False,'reason':'signed-edition-hidden'});continue
            if expected:
                rows=[r for r in rows if r['sha256']==expected]
                if not rows:
                    results.append({'available':False,'reason':'registered-content-does-not-match-source'});continue
            else:
                # Branded and neutral manuals are different presentation editions,
                # not content duplicates. Default catalogue chooses the standard
                # edition only when explicitly labelled alternatives coexist.
                standard=[r for r in rows if edition(r)=='standard']
                if standard:rows=standard
            hashes={r['sha256'] for r in rows}
            if None in hashes or len(hashes)!=1:
                results.append({'available':False,'reason':'same-name-content-conflict' if len(hashes)>1 else 'registered-content-hash-missing'});continue
            selected=None
            for row in rows:
                try:
                    p=Path(row['path']).resolve()
                    if not any(p==root or root in p.parents for root in roots):continue
                    stat=p.stat()
                    if (stat.st_size,stat.st_mtime_ns)==(row['bytes'],row['mtime_ns']):
                        selected=row;break
                except OSError:continue
            if selected:
                results.append({'available':True,'name':name,'originalName':selected['name'],'documentEdition':edition(selected),'resolutionBasis':'registered-missing-location-same-hash' if relocated.get(name) else 'registered-exact-name-and-content-identity' if selected['name']==name else 'registered-filename-format-and-content-identity','locationId':selected['id'],'resourceId':selected['resource_id'],'versionId':selected['version_id'],'sha256':selected['sha256']})
            else:
                results.append({'available':False,'reason':'registered-original-unavailable-or-changed'})
        return {'results':results}
    finally:db.close()


@lru_cache(maxsize=4096)
def asset_digest(path, size, mtime_ns):
    # Independent runtime cache, not the source index or original drive. Reuse
    # only the exact path/size/mtime identity already used by the in-memory cache.
    cache=PROJECT/'tmp/v2-resource-hash-cache';key=hashlib.sha256((path+'\0'+str(size)+'\0'+str(mtime_ns)).encode('utf8')).hexdigest();entry=cache/(key+'.json')
    try:
        saved=json.loads(entry.read_text(encoding='utf8'))
        if saved.get('path')==path and saved.get('bytes')==size and saved.get('mtime_ns')==mtime_ns and re.fullmatch('[a-f0-9]{64}',saved.get('sha256','')):return saved['sha256']
    except (OSError,ValueError):pass
    result=digest(Path(path));after=Path(path).stat()
    if (after.st_size,after.st_mtime_ns)!=(size,mtime_ns):raise OSError('asset changed during verification')
    try:
        cache.mkdir(parents=True,exist_ok=True);temporary=entry.with_suffix('.'+uuid.uuid4().hex+'.tmp');temporary.write_text(J({'path':path,'bytes':size,'mtime_ns':mtime_ns,'sha256':result}),encoding='utf8');os.replace(temporary,entry)
    except OSError:pass
    return result


def resolve_assets(work, items):
    """Exact registered binary identities only; no inferred firmware compatibility."""
    if not isinstance(items,list) or len(items)>512:raise ValueError('invalid-asset-list')
    db=connect(work,True)
    try:
        roots=[Path(r[0]).resolve() for r in db.execute('SELECT DISTINCT root FROM scans WHERE finished IS NOT NULL')]
        names={i.get('name') for i in items if isinstance(i,dict) and isinstance(i.get('name'),str) and len(i['name'])<=512 and not any(c in i['name'] for c in ('/','\\','\0'))}
        names=sorted(names);by_name=collections.defaultdict(list)
        if names:
            for row in db.execute("SELECT * FROM locations WHERE name IN ("+','.join('?' for _ in names)+") AND state='present'",names):by_name[row['name']].append(row)
        results=[]
        for item in items:
            name=item.get('name','') if isinstance(item,dict) else '';expected=item.get('sha256') if isinstance(item,dict) else None
            if expected and not re.fullmatch('[a-f0-9]{64}',str(expected)):results.append({'available':False,'reason':'invalid-resource-hash'});continue
            candidates=[]
            for row in by_name.get(name,[]):
                if Path(name).suffix.lower() not in ('.bin','.mp4','.webm','.mov'):continue
                try:
                    p=Path(row['path']).resolve();s=p.stat()
                    if not any(root in p.parents for root in roots) or (s.st_size,s.st_mtime_ns)!=(row['bytes'],row['mtime_ns']):continue
                    sha=row['sha256']
                    duplicates=by_name[name]
                    verify_duplicate_video=p.suffix.lower() in ('.mp4','.webm','.mov') and len(duplicates)>1 and len({r['bytes'] for r in duplicates})==1 and sum(r['bytes'] for r in duplicates)<=512*1024*1024
                    if (p.suffix.lower()=='.bin' and (expected or len(duplicates)>1)) or verify_duplicate_video:sha=asset_digest(str(p),s.st_size,s.st_mtime_ns)
                    if expected and sha!=expected:continue
                    candidates.append((row,sha))
                except OSError:continue
            if not candidates:results.append({'available':False,'reason':'local-original-not-confirmed'});continue
            identities={sha for row,sha in candidates}
            if len(candidates)>1 and (None in identities or len(identities)!=1):results.append({'available':False,'reason':'same-name-content-unverified' if None in identities else 'same-name-content-conflict'});continue
            row,sha=candidates[0];results.append({'available':True,'locationId':row['id'],'resourceId':row['resource_id'],'versionId':row['version_id'],'sizeBytes':row['bytes'],'sha256':sha,'resolutionBasis':'registered-name-and-source-hash' if expected else 'registered-exact-name-not-compatibility-verification'})
        return {'results':results}
    finally:db.close()


def read_block(work, block_id, radius=2):
    db=connect(work,True); b=db.execute('SELECT * FROM blocks WHERE id=?',(int(block_id),)).fetchone()
    if not b:raise KeyError('Unknown block')
    neighbors=db.execute('SELECT id,ordinal,locator,text FROM blocks WHERE hash=? AND ordinal BETWEEN ? AND ? ORDER BY ordinal',(b['hash'],b['ordinal']-min(radius,5),b['ordinal']+min(radius,5))).fetchall()
    locations=[dict(r) for r in db.execute("SELECT id,path,sha256 FROM locations WHERE sha256=? AND state='present'",(b['hash'],))]
    result={'sha256':b['hash'],'locations':locations,'blocks':[{**dict(r),'locator':json.loads(r['locator'])} for r in neighbors]};db.close();return result


def repair_references(work):
    db=connect(work); bundles=list((PROJECT/'v2/data/evidence').glob('knowledge-source-batch-*.json'));rows=[]
    for p in bundles:
        bundle=json.loads(p.read_text(encoding='utf8'))
        for d in bundle.get('documents',[])+bundle.get('firmware',[])+bundle.get('software',[]):
            old=d.get('originalPath') or d.get('path'); sha=d.get('sha256')
            if not old or not sha:continue
            matches=[dict(r) for r in db.execute("SELECT id,path FROM locations WHERE sha256=? AND state='present'",(sha,))]
            status='resolved-by-content-hash' if matches else 'not-located-in-local-index'
            db.execute('INSERT OR REPLACE INTO reference_repairs VALUES(?,?,?,?,?)',(old,sha,status,J(matches),str(p.relative_to(PROJECT))))
    # Index-only original references remain unverified; don't infer they are missing globally.
    db.commit();result={'total':db.execute('SELECT count(*) FROM reference_repairs').fetchone()[0],'status':{r[0]:r[1] for r in db.execute('SELECT status,count(*) FROM reference_repairs GROUP BY status')}};db.close();return result


def verify_small_referenced_files(work, total_budget=256*1024**2):
    """Hash only explicitly referenced small binaries, not the bulk resource drive."""
    repair_references(work);db=connect(work);checked=used=0;matched=set()
    refs=db.execute("SELECT old_path,sha256 FROM reference_repairs WHERE status='not-located-in-local-index'").fetchall()
    for ref in refs:
        if Path(ref['old_path']).suffix.lower()!='.bin':continue
        for row in db.execute("SELECT * FROM locations WHERE lower(name)=lower(?) AND sha256 IS NULL AND state='present' AND bytes<=?",(Path(ref['old_path']).name,64*1024**2)).fetchall():
            if used+row['bytes']>total_budget:continue
            p=Path(row['path']);s=p.stat()
            if (s.st_size,s.st_mtime_ns)!=(row['bytes'],row['mtime_ns']):continue
            sha=digest(p);after=p.stat()
            if (s.st_size,s.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):continue
            db.execute('UPDATE locations SET sha256=? WHERE id=?',(sha,row['id']));db.execute('UPDATE versions SET sha256=? WHERE id=?',(sha,row['version_id']))
            checked+=1;used+=row['bytes']
            if sha==ref['sha256']:matched.add(ref['sha256'])
    db.commit();db.close();return {'filesChecked':checked,'bytesRead':used,'referencedContentsMatched':len(matched),'hardwareCompatibilityInferred':False}


def report(work):
    db=connect(work,True)
    scalar=lambda sql:db.execute(sql).fetchone()[0]
    pairs=lambda sql:{r[0]:r[1] for r in db.execute(sql)}
    result={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'resources':scalar("SELECT count(*) FROM locations WHERE state!='missing'"),'folders':scalar('SELECT count(*) FROM folders'),
        'bytes':scalar("SELECT coalesce(sum(bytes),0) FROM locations WHERE state!='missing'"),'extensions':pairs("SELECT extension,count(*) FROM locations WHERE state!='missing' GROUP BY extension"),
        'kinds':pairs("SELECT kind,count(*) FROM locations WHERE state!='missing' GROUP BY kind"),'states':pairs('SELECT state,count(*) FROM locations GROUP BY state'),
        'parses':pairs("SELECT p.state,count(*) FROM parses p WHERE EXISTS(SELECT 1 FROM locations l WHERE l.sha256=p.hash AND l.state='present') GROUP BY p.state"),'blocks':scalar('SELECT count(*) FROM blocks'),
        'classificationUniqueContent':pairs('SELECT category,count(*) FROM classifications GROUP BY category'),
        'classificationFiles':pairs("SELECT c.category,count(DISTINCT l.id) FROM classifications c JOIN locations l ON l.sha256=c.hash WHERE l.state='present' GROUP BY c.category"),
        'knownCloudLinks':scalar('SELECT count(*) FROM locations WHERE cloud_url IS NOT NULL'),
        'duplicateGroups':scalar("SELECT count(*) FROM (SELECT sha256 FROM locations WHERE sha256 IS NOT NULL AND state='present' GROUP BY sha256 HAVING count(*)>1)"),
        'duplicateExtraFiles':scalar("SELECT coalesce(sum(n-1),0) FROM (SELECT count(*) n FROM locations WHERE sha256 IS NOT NULL AND state='present' GROUP BY sha256 HAVING count(*)>1)"),
        'sameNameDifferentContent':scalar("SELECT count(*) FROM (SELECT lower(name) FROM locations WHERE sha256 IS NOT NULL AND state='present' GROUP BY lower(name) HAVING count(DISTINCT sha256)>1)"),
        'exactRepeatedPassageGroups':scalar('SELECT count(*) FROM (SELECT text_hash FROM blocks WHERE length(text)>=30 GROUP BY text_hash HAVING count(DISTINCT hash)>1)'),
        'indexBytes':sum(p.stat().st_size for p in Path(work).glob('resources.db*')),
        'limitations':['Large non-documents metadata only; no binary content duplicate claims','Content categories are discovery clues, not verified authorship','No AI/FAQ generation; no active knowledge changed']}
    db.close();return result


def main():
    p=argparse.ArgumentParser();p.add_argument('--work',default=str(DEFAULT_WORK));p.add_argument('--parse-one');sub=p.add_subparsers(dest='command')
    s=sub.add_parser('scan');s.add_argument('--root',default='G:/');s.add_argument('--hash-cache')
    s=sub.add_parser('index');s.add_argument('--limit',type=int,default=0);s.add_argument('--contains',default='');s.add_argument('--timeout',type=int,default=60);s.add_argument('--retry',action='store_true')
    s=sub.add_parser('search');s.add_argument('text');s.add_argument('--mode',choices=['all','files','text'],default='all');s.add_argument('--model');s.add_argument('--version');s.add_argument('--limit',type=int,default=10)
    s=sub.add_parser('read');s.add_argument('block',type=int)
    sub.add_parser('repair');sub.add_parser('report')
    sub.add_parser('verify-referenced')
    a=p.parse_args()
    if a.parse_one:print(J(extract(a.parse_one)));return
    if a.command=='scan':r=scan(a.root,a.work,a.hash_cache)
    elif a.command=='index':r=index_documents(a.work,a.limit,a.contains,a.timeout,a.retry)
    elif a.command=='search':r=query(a.work,a.text,a.mode,a.model,a.limit,a.version)
    elif a.command=='read':r=read_block(a.work,a.block)
    elif a.command=='repair':r=repair_references(a.work)
    elif a.command=='verify-referenced':r=verify_small_referenced_files(a.work)
    elif a.command=='report':r=report(a.work)
    else:p.print_help();return
    print(J(r))


if __name__=='__main__':main()
