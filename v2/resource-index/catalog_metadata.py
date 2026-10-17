"""Deterministic metadata from cached original passages, never an AI conclusion."""
import json,re,os,uuid
import collections,threading
from pathlib import Path

REVISION='quick-metadata-6'
_responses={}
_lock=threading.Lock()
def analyze(name,blocks):
    evidence=[{'blockId':b['id'],'locator':json.loads(b['locator']),'text':b['text']} for b in blocks]
    intro='\n'.join(b['text'] for b in blocks)[:12000]
    lines=[x.strip() for x in intro.splitlines() if x.strip()]
    certificate=bool(re.search(r'certificate|认证证书|认证报告|检测报告|合格证|test report',name,re.I) or any(re.fullmatch(r'(?:.*certificate(?:\s+of\s+.*)?|认证证书|检测报告|合格证)',x,re.I) for x in lines[:16]))
    titles=[x for x in lines[:24] if len(x)<=120 and not re.search(r'[。；;!?]|应当|请阅读|参阅|详见|应阅读|参考.*规格',x) and (re.fullmatch(r'.{0,70}(?:规格书|技术规格|使用说明书|用户手册|操作手册|产品说明书|操作说明|产品手册).{0,30}',x) or re.fullmatch(r'.{0,70}(?:PRODUCT SPECIFICATIONS?|USER MANUAL|PRODUCT MANUALS?|INSTRUCTION MANUAL|OPERATING INSTRUCTIONS).{0,30}',x,re.I))]
    title=titles[0] if titles else None
    kind='other' if certificate else 'manual' if title and re.search('说明|手册|MANUAL|INSTRUCTIONS',title,re.I) else 'spec' if title and re.search('规格|SPECIFICATION',title,re.I) else None
    models=[]
    for line in lines[:24]:
        if re.fullmatch(r'(?:HD[-_ ]?)?(?:[A-Z]{1,8}\d+[A-Z0-9]*(?:[-_][A-Z0-9]+)*|\d+[A-Z]{1,4})(?:\s+(?:Pro|Plus|Max|Mini))?',line,re.I) and not re.match(r'V\d|20\d{2}$',line,re.I):models.append(re.sub(r'^HD[-_ ]?','',line,flags=re.I).upper().replace(' ',''))
    versions=[]
    # Only a cover-like line or an explicit document-version label. Numbers
    # in technical prose, software requirements and version history do not qualify.
    for line in lines[:24]:
        m=re.fullmatch(r'(?:版本号|文档版本|手册版本|Version|Revision)?\s*[:：]?\s*V?(\d+(?:\.\d+){1,3})(?:\s+\d{8})?',line,re.I)
        if m:versions.append('V'+m[1])
    versions=list(dict.fromkeys(versions));version=versions[0] if len(versions)==1 else None
    conditions=[x for x in lines[:40] if re.search(r'硬件版本|软件版本|固件版本|适用型号|适用范围|(?:Hardware|Software|Firmware)\s+(?:version|revision)|Applicable\s+(?:model|version)',x,re.I)]
    return {'kind':kind,'classificationStatus':'original-title-confirmed' if kind else 'candidate','title':title,'coverModels':sorted(set(models)),'version':version,'versionStatus':'original-cover-version' if version else 'not-established','scopeEvidence':conditions,'evidence':evidence[:24],'certificate':certificate}

def catalog(db,work):
    key=str(Path(work).resolve());review_file=Path(work)/'quick-resource-reviews.json';files=[Path(work)/'resources.db',Path(work)/'resources.db-wal',review_file]
    signature=json.dumps([(p.stat().st_size,p.stat().st_mtime_ns) if p.exists() else None for p in files])
    artifact=Path(work)/'quick-catalog-metadata.json'
    with _lock:
        if key in _responses and _responses[key][0]==signature:return _responses[key][1]
    try:
        saved=json.loads(artifact.read_text(encoding='utf8'))
        if saved['revision']==REVISION and saved['signature']==signature:
            with _lock:_responses[key]=(signature,saved['resources'])
            return saved['resources']
    except (OSError,ValueError,KeyError):pass
    reviews={}
    if review_file.exists():
        reviews=json.loads(review_file.read_text(encoding='utf8'))
        if not isinstance(reviews,dict):raise ValueError('Invalid resource reviews')
    rows=[];cache=collections.defaultdict(list)
    parses={r['hash']:dict(r) for r in db.execute('SELECT hash,state,blocks,details FROM parses')}
    # Reuse existing parse blocks in one bounded-prefix query. Opening thousands
    # of tiny metadata cache files made cold catalogue delivery time out.
    for b in db.execute('SELECT hash,id,locator,text FROM blocks WHERE ordinal<24 ORDER BY hash,ordinal'):
        cache[b['hash']].append(dict(b))
    for r in db.execute("SELECT * FROM locations WHERE state IN ('present','missing') AND kind!='sensitive-metadata-only' AND lower(extension) IN ('.pdf','.docx','.doc','.pptx','.ppt','.xlsx','.xls','.wps','.txt','.md','.bin','.mp4','.webm','.exe','.msi','.apk')"):
        path=Path(r['path']);suffix=path.suffix.lower()
        item={'name':r['name'],'locationId':r['id'],'resourceId':r['resource_id'],'versionId':r['version_id'],'sha256':r['sha256'],'sizeBytes':r['bytes'],'availabilityState':r['state'],'folders':list(path.parts[1:-1]),'resourceType':'firmware' if suffix=='.bin' and re.search('固件|firmware',str(path),re.I) else 'software' if suffix in ('.exe','.msi','.apk') else 'file'}
        item['sourceDrive']=path.drive.upper() or None
        if r['kind']=='document':
            parsed=parses.get(r['sha256'],{});details=json.loads(parsed.get('details') or '{}')
            item['parseStatus']={'state':parsed.get('state','not-parsed'),'blockCount':parsed.get('blocks',0),'ocrPendingPages':details.get('ocrPendingPages',[]),'complete':parsed.get('state')=='parsed'}
            blocks=cache[r['sha256']];item['documentMetadata']=analyze(r['name'],blocks)
            review=reviews.get(r['sha256'])
            if review:
                if review.get('kind') not in ('spec','manual','other','pending') or not review.get('reviewId') or not review.get('basis'):raise ValueError('Review needs role, ID and evidence basis')
                if any(k in review and (not isinstance(review[k],list) or not all(isinstance(x,str) for x in review[k])) for k in ('coverModels','scopeEvidence')):raise ValueError('Review model/scope lists must contain strings')
                if review.get('version') is not None and not re.fullmatch(r'V\d+(?:\.\d+)+',str(review['version']),re.I):raise ValueError('Invalid reviewed document version')
                item['documentMetadata'].update({k:v for k,v in review.items() if k in ('kind','coverModels','version','scopeEvidence','familyId')})
                item['documentMetadata'].update({'classificationStatus':'manual-review','reviewId':review['reviewId'],'reviewBasis':review['basis']})
            item['documentMetadata']['evidence']=[{'blockId':b['blockId'],'locator':b['locator']} for b in item['documentMetadata']['evidence']]
            if item['documentMetadata']['kind'] in ('spec','manual') or re.search(r'规格书|specifications?',r['name'],re.I):item['documentIntro']='\n'.join(b['text'] for b in blocks)[:2400]
        rows.append(item)
    try:
        temporary=artifact.with_suffix('.'+uuid.uuid4().hex+'.tmp');temporary.write_text(json.dumps({'revision':REVISION,'signature':signature,'resources':rows},ensure_ascii=False),encoding='utf8');os.replace(temporary,artifact)
    except OSError:pass
    with _lock:_responses[key]=(signature,rows)
    return rows
