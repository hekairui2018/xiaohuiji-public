"""Quick-mode file lookup over the existing SQL registry; no section/vector changes."""
import collections, json, re, sqlite3, time
from pathlib import Path
from section_search import tokens, modelkey, compact


class FileRegistry:
    def __init__(self, directory, canonical_work=None):
        db=sqlite3.connect((Path(directory)/'sections.db').resolve().as_uri()+'?mode=ro',uri=True)
        db.row_factory=sqlite3.Row
        try:self.files=[dict(r) for r in db.execute('SELECT * FROM files')]
        finally:db.close()
        for f in self.files:
            f['models']=json.loads(f['models']);f['attributes']=json.loads(f['attributes'])
        if canonical_work:
            # Wiki remains the authority for approvals and newly registered files.
            # Existing section metadata supplies attributes, not a second approval list.
            work=Path(canonical_work);db=sqlite3.connect((work/'resources.db').resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
            try:registered=[dict(r) for r in db.execute("SELECT l.*,a.type registry_type FROM locations l JOIN approved_files a ON a.sha256=l.sha256 WHERE l.state='present'")]
            finally:db.close()
            approved={r['sha256'] for r in registered}
            self.files=[f for f in self.files if f['kind']=='module-config' or f['sha256'] in approved]
            seen={f['sha256']:f for f in self.files}
            cached=work/'quick-catalog-metadata.json'
            cached=json.loads(cached.read_text(encoding='utf-8')).get('resources',[]) if cached.exists() else []
            metadata={r.get('locationId'):r for r in cached}
            from file_attributes import attributes
            for r in registered:
                if r['sha256'] in seen:
                    f=seen[r['sha256']];f.update(path=r['path'],size=r['bytes'],mtime_ns=r['mtime_ns']);continue
                meta=metadata.get(r['id'],{}).get('documentMetadata',{})
                kind=r['registry_type']
                if kind=='document':kind=meta.get('kind') or ('manual' if re.search('说明|手册|manual',r['name'],re.I) else 'spec' if re.search('规格|specification',r['name'],re.I) else 'document')
                attrs=attributes(r['name'],Path(r['path']).parts[:-1]);attrs.update(version=meta.get('version'),language='未注明')
                self.files.append(dict(id='wiki-'+r['sha256'],name=r['name'],kind=kind,path=r['path'],size=r['bytes'],mtime_ns=r['mtime_ns'],
                    sha256=r['sha256'],models=meta.get('coverModels',[]),attributes=attrs,download='/v2/offline/file?id='+str(r['id'])+'&download=1',
                    preview='/v2/offline/preview?id='+str(r['id']) if kind in ('manual','spec','document') else None))
                seen[r['sha256']]=self.files[-1]
        for f in self.files:
            f['models']=['HD-'+re.sub(r'^HD[-_ ]?','',m,flags=re.I).upper() if re.search(r'\d',m) else m for m in f['models']]
        self.known=sorted({modelkey(m) for f in self.files for m in f['models']},key=len,reverse=True)

    def search(self, query, limit=10):
        if not isinstance(query,str) or not query.strip() or len(query)>240 or not 1<=limit<=50:raise ValueError('invalid-file-query')
        started=time.perf_counter();upper=query.upper()
        requested=[m for m in self.known if re.search(r'(?<![A-Z0-9])(?:HD[-_ ]?)?'+re.escape(m)+r'(?![A-Z0-9+_-])',upper)]
        unknown=[modelkey(m) for m in re.findall(r'\bHD[-_ ]([A-Z][A-Z0-9-]*\d[A-Z0-9-]*)',upper) if modelkey(m) not in self.known]
        kinds=[k for p,k in [(r'规格书|参数表|datasheet','spec'),(r'说明书|手册|manual','manual'),(r'固件|升级包|\.bin','firmware'),(r'配置文件|模组配置|\.ss[rx]','module-config'),(r'视频|教程|录像','video'),(r'软件|安装包|\.exe|\.msi|\.apk','software')] if re.search(p,query,re.I)]
        literal=[f for f in self.files if query.casefold().endswith(f['name'].casefold())]
        if literal:kinds=list({f['kind'] for f in literal})
        versions=re.findall(r'(?i)V\d+(?:[._]\d+)*(?:[_-][A-Z0-9]+)*',query)
        software=[s for s in ['HDSet','HDPlayer','HDShow','HD2020','HDSign','屏掌控'] if s.lower() in query.lower()]
        focus=re.sub(r'规格书|参数表|说明书|用户手册|使用手册|操作手册|手册|固件|升级包|配置文件|模组配置|视频|教程|请|帮我|给我|发我|找一下|下载|一份|一个|的',' ',query)
        focus_terms={t for t in tokens(focus) if len(t)>1}-set(tokens(' '.join(requested)))
        ranked=[]
        for f in ([] if unknown else literal or self.files):
            if kinds and f['kind'] not in kinds:continue
            hay=f['name']+' '+json.dumps(f['attributes'],ensure_ascii=False)
            if requested and not any(modelkey(m) in requested for m in f['models']):
                if not (f['kind']=='video' and any(m in modelkey(f['name']) for m in requested)):continue
            if versions and not all(compact(v) in compact(hay) for v in versions):continue
            if software and not any(s.lower() in hay.lower() for s in software):
                related={'HDPlayer':('异步全彩',),'HDSet':('接收卡','视频处理','同步')}
                if f['kind']!='video' or not any(any(c in str(f['attributes'].get('category','')) for c in related.get(s,())) for s in software):continue
            if 'LCD' in upper and 'LCD' not in hay.upper():continue
            if 'LED' in upper and 'LCD' in hay.upper():continue
            score=sum(1 for t in focus_terms if t in set(tokens(hay)))
            approximate=False
            if f['kind']=='module-config':
                required=re.findall(r'(?i)\bP\d+(?:\.\d+)?\b|\b\d+S\b|\b(?:SM|ICN|ICND|FM|LS|MBI|DP)\d+[A-Z0-9]*\b',query)
                if required:
                    matched=sum(compact(v) in compact(hay) for v in required)
                    approximate=matched!=len(required);score+=matched*10
                    if not matched:continue
            if focus_terms and not requested and not software and score==0:continue
            ranked.append((score,not approximate,-len(f['models']),f,approximate))
        ranked.sort(key=lambda r:r[:3],reverse=True)
        results=[]
        for _,_,_,f,approximate in ranked:
            try:
                stat=Path(f['path']).stat()
                if (stat.st_size,stat.st_mtime_ns)!=(f['size'],f['mtime_ns']):continue
            except OSError:continue
            url=f['download'];preview=f.get('preview') or (url if f['kind'] in ('spec','manual','video') else None)
            if preview and f['name'].lower().endswith('.docx'):preview=preview.replace('/v2/curated-documents/','/v2/curated-documents-preview/',1)
            results.append(dict(name=f['name'],kind=f['kind'],models=f['models'],attributes=f['attributes'],sha256=f['sha256'],
                fileId=f['id'],download=url,previewUrl=preview,text='',resourceOnly=True,
                queryMatch={'exact':not approximate},matchStatus='candidate-not-compatibility-confirmation' if f['kind'] in ('firmware','module-config') else 'registered-file'))
            if len(results)>=limit:break
        return dict(results=results,retrievalBackend='file-registry-sql',vectorUsed=False,elapsedMs=round((time.perf_counter()-started)*1000,1),
            warnings=['未登记该完整型号，未以其他型号代替。'] if unknown else [],plan={'models':requested,'kinds':kinds,'versions':versions})
