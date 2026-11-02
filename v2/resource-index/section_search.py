"""SQL originals + BM25/RRF + cached CPU embedding. No generative answers."""
import sqlite3,json,re,html,math,collections,threading,time,hashlib
from pathlib import Path
import numpy as np
def plain(s):return html.unescape(re.sub(r'<[^>]+>',' ',s))
def tokens(s):
    s=plain(s).lower();out=re.findall(r'[a-z0-9]+(?:[.×*~-][a-z0-9]+)*',s)
    for seq in re.findall(r'[\u3400-\u9fff]+',s):
        out.extend(seq);out.extend(seq[i:i+2] for i in range(len(seq)-1))
    return out
def modelkey(s):return re.sub(r'[\s_]+','',re.sub(r'^HD[-_ ]?','',s.upper())).replace('×','X')
def compact(s):return re.sub(r'[^a-z0-9\u3400-\u9fff]','',s.lower().replace('×','x'))
class Embedder:
    def __init__(self,folder):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        folder=Path(folder);self.tokenizer=Tokenizer.from_file(str(folder/'tokenizer.json'));self.tokenizer.enable_truncation(max_length=512);self.tokenizer.enable_padding()
        opt=ort.SessionOptions();opt.intra_op_num_threads=4;opt.inter_op_num_threads=1
        self.session=ort.InferenceSession(str(folder/'model.onnx'),sess_options=opt,providers=['CPUExecutionProvider']);self.lock=threading.Lock()
    def encode(self,texts):
        result=[]
        with self.lock:
            for start in range(0,len(texts),8):
                batch=self.tokenizer.encode_batch(texts[start:start+8]);feed={'input_ids':np.array([e.ids for e in batch],dtype=np.int64),'attention_mask':np.array([e.attention_mask for e in batch],dtype=np.int64),'token_type_ids':np.array([e.type_ids for e in batch],dtype=np.int64)}
                a=self.session.run(None,{k:feed[k] for k in [i.name for i in self.session.get_inputs()]})[0]
                result.extend(a[:,0,:] if a.ndim==3 else a)
        a=np.asarray(result,dtype=np.float32);return a/np.maximum(np.linalg.norm(a,axis=1,keepdims=True),1e-12)
class SectionIndex:
    def __init__(self,directory,model_folder):
        self.directory=Path(directory);self.dbfile=self.directory/'sections.db';self.embed=Embedder(model_folder)
        db=sqlite3.connect(self.dbfile);db.row_factory=sqlite3.Row
        self.files={r['id']:dict(r) for r in db.execute('SELECT * FROM files')}
        for f in self.files.values():f['models']=json.loads(f['models']);f['attributes']=json.loads(f['attributes'])
        self.rows=[dict(r) for r in db.execute('SELECT * FROM sections ORDER BY id')];db.close()
        for r in self.rows:r.update(models=self.files[r['file_id']]['models'],heading=json.loads(r['heading']),locator=json.loads(r['locator']),kind=self.files[r['file_id']]['kind'])
        self.doc_count=len(self.rows);self.search_rows=list(self.rows)
        for f in self.files.values():
            if f['kind'] in ('spec','manual'):continue
            att=f['attributes'];labels={'chips':'芯片','pitches':'点间距','scans':'扫描','hubs':'HUB接口','resolutions':'像素规格','decoders':'译码','software':'软件','manufacturer':'厂家','manufacturerAbbreviation':'厂家缩写','firmwareVersion':'固件版本','hardwareFamilies':'硬件系列','versionNote':'版本说明','category':'分类','chip':'登记芯片'}
            text=f['name']+'\n'+'\n'.join(labels[k]+'：'+('、'.join(str(x) for x in v) if isinstance(v,list) else str(v)) for k,v in att.items() if v and k in labels)
            self.search_rows.append({'id':f['id'],'file_id':f['id'],'heading':[],'text':text,'models':f['models'],'kind':f['kind'],'locator':{'section':'文件登记信息'}})
        self.counts=[];self.lengths=[];self.df=collections.Counter()
        for r in self.search_rows:
            f=self.files[r['file_id']];r['searchText']=' '.join(r['models'])+' '+f['name']+' '+' '.join(r['heading'])+' '+r['text']
            c=collections.Counter(tokens(r['searchText']));self.counts.append(c);self.lengths.append(sum(c.values()));self.df.update(c.keys())
        self.avg=sum(self.lengths)/max(1,len(self.lengths));self.known=sorted(set(modelkey(m) for f in self.files.values() for m in f['models']),key=len,reverse=True)
        data=np.load(self.directory/'vectors.npz');self.vectors=data['vectors'];self.owners=data['owners'];assert self.vectors.shape[0]==len(self.owners)
        manifest=json.loads((self.directory/'vectors.json').read_text(encoding='utf-8'));assert manifest['sectionIds']==[r['id'] for r in self.rows]
        self.cache={};self.cache_lock=threading.Lock()
        self.attribute_units=[]
        for field in ('chips','pitches','scans','hubs','resolutions','decoders'):
            for value in set(v for f in self.files.values() if f['kind']=='module-config' for v in f['attributes'].get(field,[])):
                self.attribute_units.append((field,compact(value),value))
        self.attribute_units.sort(key=lambda x:len(x[1]),reverse=True)
    def search(self,query,limit=10):
        if not isinstance(query,str) or not query.strip() or len(query)>240:raise ValueError('Invalid query')
        started=time.perf_counter();upper=query.upper();models=[m for m in self.known if re.search(r'(?<![A-Z0-9])(?:HD[-_ ]?)?'+re.escape(m)+r'(?![A-Z0-9])',upper)]
        explicit=[modelkey(m) for m in re.findall(r'\bHD[-_ ]([A-Z][A-Z0-9-]*\d[A-Z0-9-]*|\d+[A-Z][A-Z0-9-]*)',upper)]
        unknown=[m for m in explicit if m not in self.known]
        if unknown:return {'results':[],'elapsedMs':round((time.perf_counter()-started)*1000,1),'retrievalBackend':'sections-sql-bm25-vector','vectorUsed':False,'warnings':['未登记该完整型号，未用其他型号代替。'],'plan':{'models':models,'unresolvedModels':unknown,'kinds':[]},'sourceUnavailable':False}
        kinds=[]
        for pattern,kind in [(r'视频教程|教学视频|操作视频|演示视频|视频文件|(?:找|看一下|看个|下载|给我|发我|发一|给一).{0,32}视频','video'),(r'固件|升级包|烧录包','firmware'),(r'配置文件|接收卡配置|模组配置|\.ss[rx]','module-config'),(r'规格书','spec'),(r'说明书|用户手册|使用手册','manual')]:
            if re.search(pattern,query,re.I):kinds.append(kind)
        ids=[i for i,r in enumerate(self.search_rows) if (not kinds or r['kind'] in kinds) and (not models or any(modelkey(m) in models for m in r['models']))]
        # Explicit chip/config attributes can coexist with a receiver model that
        # is not encoded in config names; do not invent compatibility links.
        required_attributes={};approximate=False;metadata_scores={}
        if kinds==['module-config']:
            ids=[i for i,r in enumerate(self.search_rows) if r['kind']=='module-config']
            cq=compact(re.sub(r'配置文件|模组配置|接收卡配置|请|帮我|找一下|找|的','',query)).replace('扫描','s').replace('扫','s')
            for i in ids:
                f=self.files[self.search_rows[i]['file_id']];att=f['attributes'];units=[]
                for field in ('chips','pitches','scans','hubs','resolutions','decoders'):
                    units.extend(att.get(field,[]))
                units.extend(v for v in (att.get('manufacturer'),att.get('manufacturerAbbreviation')) if v)
                rest=cq
                for unit in sorted({compact(v).replace('扫','s') for v in units},key=len,reverse=True):
                    if len(unit)>=2 and unit in rest:rest=rest.replace(unit,'',1)
                metadata_scores[i]=(len(cq)-len(rest))/max(1,len(cq))
            exact=[i for i in ids if metadata_scores[i]>=1]
            if cq:
                if exact:ids=exact
                else:approximate=True;ids=sorted(ids,key=lambda i:metadata_scores[i],reverse=True)[:120]
        if kinds==['firmware']:
            versions=re.findall(r'(?i)(?:[A-Z0-9]+[_-])*V\d+(?:[._]\d+)+(?:[_-][A-Z0-9]+)*',query)
            if versions:
                exact=[i for i in ids if all(compact(v) in compact(self.search_rows[i]['text']) for v in versions)]
                if exact:ids=exact
                else:approximate=True
        query_terms=set(tokens(query));lex={};N=len(self.search_rows)
        for i in ids:
            c=self.counts[i];value=0
            for t in query_terms:
                f=c[t]
                if f:value+=math.log(1+(N-self.df[t]+.5)/(self.df[t]+.5))*f*2.2/(f+1.2*(.25+.75*self.lengths[i]/self.avg))
            lex[i]=value+metadata_scores.get(i,0)*100
        warnings=[];vscore=np.full(len(self.rows),-np.inf);vector_used=False
        if any(i<self.doc_count for i in ids):
            try:
                with self.cache_lock:cached=self.cache.get(query)
                qv=cached[1] if cached and time.monotonic()-cached[0]<300 else self.embed.encode([query])[0]
                with self.cache_lock:
                    self.cache={k:v for k,v in self.cache.items() if time.monotonic()-v[0]<300};self.cache[query]=(time.monotonic(),qv)
                    if len(self.cache)>256:self.cache.pop(next(iter(self.cache)))
                np.maximum.at(vscore,self.owners,self.vectors@qv);vector_used=True
            except Exception:warnings.append('向量暂不可用，本次仅使用关键词检索。')
        kw=sorted([i for i in ids if lex[i]>0],key=lambda i:lex[i],reverse=True);kr={i:p+1 for p,i in enumerate(kw)}
        vr=sorted([i for i in ids if i<self.doc_count and vscore[i]>=.35],key=lambda i:float(vscore[i]),reverse=True);vp={i:p+1 for p,i in enumerate(vr)}
        preferred='spec' if re.search(r'多少|几路|几个|范围|上限|最大|最小|电压|功耗|耗电|参数|规格',query) else 'manual' if re.search(r'如何|怎么|怎样|步骤|设置|操作',query) else None
        def rank(i):
            score=(1/(60+kr[i]) if i in kr else 0)+(1/(60+vp[i]) if i in vp else 0)
            return score*(1.2 if self.search_rows[i]['kind']==preferred else 1)
        ranked=sorted(set(kw[:120]+vr[:80]),key=rank,reverse=True)
        results=[];seen=collections.Counter()
        for i in ranked:
            row=self.search_rows[i];f=self.files[row['file_id']]
            if seen[f['id']]>=3:continue
            if not self.available(f):continue
            # Metadata matching is literal and must include supplied identifiers;
            # approximate entries are labelled rather than promoted to compatible.
            text=('章节：'+' → '.join(row['heading'])+'\n' if row['heading'] else '')+row['text']
            locator={'section':row['locator'].get('section') or ' → '.join(row['heading']) or '文件登记信息'}
            pages=sorted({p['page'] for p in row['locator'].get('positions',[]) if 'page' in p})
            if pages:locator['page']='、'.join(str(p) for p in pages)
            note='未找到所有条件一致的配置，以下为接近候选，请核对。\n' if approximate and f['kind']=='module-config' else '未找到完全对应版本，以下仅为相近固件候选，不能据此升级。\n' if approximate and f['kind']=='firmware' else ''
            preview=f['download'] if f['kind'] in ('spec','manual','video') else None
            if preview and f['kind'] in ('spec','manual') and Path(f['name']).suffix.lower()=='.docx':preview=preview.replace('/v2/curated-documents/','/v2/curated-documents-preview/',1)
            results.append({'name':f['name'],'kind':f['kind'],'sha256':f['sha256'],'fileId':f['id'],'evidenceId':row['id'],'text':note+text,'locator':locator,'sectionPath':row['heading'],'models':f['models'],'attributes':f['attributes'],'download':f['download'],'previewUrl':preview,'resourceOnly':f['kind'] not in ('spec','manual'),'queryMatch':{'exact':not approximate,'matched':list(required_attributes)},'scores':{'keyword':round(lex[i],4),'vector':round(float(vscore[i]),4) if i<self.doc_count and np.isfinite(vscore[i]) else None},'matchStatus':'candidate-not-compatibility-confirmation' if f['kind'] in ('firmware','module-config') else 'source-evidence'})
            seen[f['id']]+=1
            if len(results)>=limit:break
        return {'results':results,'elapsedMs':round((time.perf_counter()-started)*1000,1),'retrievalBackend':'sections-sql-bm25-vector','vectorUsed':vector_used,'warnings':warnings,'sourceUnavailable':False,'plan':{'models':models,'kinds':kinds},'scope':'current-approved-public-documents-and-file-registry','indexedDocuments':sum(f['kind'] in ('spec','manual') for f in self.files.values()),'indexedSections':len(self.rows)}
    @staticmethod
    def available(f):
        try:
            s=Path(f['path']).stat();return s.st_size==f['size'] and s.st_mtime_ns==f['mtime_ns']
        except OSError:return False
