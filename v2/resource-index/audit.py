"""Evidence-only reports over the isolated index. No model or original writes."""
import collections
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
import engine as e


def save(p,obj):p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


def table(db,path,sql):
    with path.open('w',encoding='utf-8-sig',newline='') as f:
        cur=db.execute(sql);writer=csv.writer(f);writer.writerow([d[0] for d in cur.description])
        for row in cur:
            # Do not let a path or original text become an Excel formula when browsing CSV.
            writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in row])


def normalized(s):return re.sub(r'\s+','',str(s)).casefold()


class Anchors:
    """Aho-Corasick literal anchors; full excerpts are checked after an anchor hit."""
    def __init__(self,patterns):
        self.nodes=[{}];self.fail=[0];self.outputs=[set()]
        for word,key in patterns:
            n=0
            for ch in word:
                if ch not in self.nodes[n]:self.nodes[n][ch]=len(self.nodes);self.nodes.append({});self.fail.append(0);self.outputs.append(set())
                n=self.nodes[n][ch]
            self.outputs[n].add(key)
        queue=collections.deque(self.nodes[0].values())
        while queue:
            n=queue.popleft()
            for ch,child in self.nodes[n].items():
                queue.append(child);f=self.fail[n]
                while f and ch not in self.nodes[f]:f=self.fail[f]
                self.fail[child]=self.nodes[f].get(ch,0);self.outputs[child].update(self.outputs[self.fail[child]])
    def find(self,text):
        n=0;found=set()
        for ch in text:
            while n and ch not in self.nodes[n]:n=self.fail[n]
            n=self.nodes[n].get(ch,0)
            found.update(self.outputs[n])
        return found


def coverage(db):
    directory=e.PROJECT/'v2/data/knowledge-next/aftersales-reextract-20261015'
    manifest=json.loads((directory/'candidate-manifest.json').read_text(encoding='utf8'))
    raw=json.loads((directory/manifest['versionId']/'index.json').read_text(encoding='utf8'))
    cases=raw['cases'];patterns=[];needles={}
    for case in cases:
        full=normalized(case.get('sourceExcerpt',''));phrase=normalized(case.get('phenomenon',''))
        for role,text in [('sourceExcerpt',full),('phenomenon',phrase)]:
            if len(text)>=20:
                key=(case['stableId'],role);needles[key]=text;patterns.append((text[:24],key))
    automaton=Anchors(patterns);matched=collections.defaultdict(list)
    for (sha,) in db.execute("SELECT hash FROM parses WHERE state IN ('parsed','parsed-ocr-pending')"):
        blocks=db.execute('SELECT id,text,locator FROM blocks WHERE hash=? ORDER BY ordinal',(sha,)).fetchall()
        def literal(b):
            loc=json.loads(b['locator'])
            # Pipe separators are presentation, not characters in Word source cells.
            if loc.get('part')=='word/document.xml' and 'cells' in loc:return ''.join(loc['cells'])
            return b['text']
        text=normalized('\n'.join(literal(b) for b in blocks))
        for key in automaton.find(text):
            needle=needles[key]
            if needle in text:
                # If the excerpt spans paragraphs, its first matching paragraph is only an anchor.
                anchor=next((b['id'] for b in blocks if needle[:min(20,len(needle))] in normalized(b['text'])),None)
                matched[key].append({'sha256':sha,'anchorBlockId':anchor,'basis':'literal-source-excerpt' if key[1]=='sourceExcerpt' else 'literal-phenomenon-only-not-full-case'})
    records=[]
    for c in cases:
        full=matched.get((c['stableId'],'sourceExcerpt'),[]);part=matched.get((c['stableId'],'phenomenon'),[])
        records.append({'caseId':c['stableId'],'legacyId':c.get('legacyId'),'status':'literal-source-excerpt-found' if full else 'phenomenon-only-found' if part else 'not-literally-matched','sourceMatches':full,'phenomenonMatches':part})
    return {'oldCandidate':manifest['versionId'],'totalCases':len(cases),'counts':dict(collections.Counter(r['status'] for r in records)),'records':records,'meaning':'Literal discovery only; a sourceExcerpt may itself be brief. No compatibility or engineering success is inferred.'}


def build(work,with_coverage=True):
    work=Path(work);db=e.connect(work)
    summary=e.report(work);summary['referenceRepairs']=e.repair_references(work)
    oldfile=e.PROJECT/'docs/v2/全量资料目录与关系地图-20261015/完整目录数据.json'
    previous=json.loads(oldfile.read_text(encoding='utf8'));old_hashes={r.get('sha256') for r in previous.get('files',[]) if r.get('sha256')}
    rows=db.execute("SELECT l.*,p.state parse_state FROM locations l LEFT JOIN parses p ON l.sha256=p.hash WHERE l.kind='document' AND l.state='present'").fetchall()
    newly=[r for r in rows if r['sha256'] and r['sha256'] not in old_hashes]
    summary['versus20261015Catalogue']={'priorDocumentHashes':len(old_hashes),'currentDocumentFilesWithUnseenHash':len(newly),'uniqueUnseenContent':len({r['sha256'] for r in newly}),'meaning':'Not present by hash in that prior catalogue; not proof of download date or previous business coverage'}
    table(db,work/'resources.csv','SELECT * FROM locations ORDER BY path')
    table(db,work/'folders.csv','SELECT * FROM folders ORDER BY path')
    table(db,work/'classification-evidence.csv',"SELECT c.category,l.path,c.hash,c.block_id,b.locator,b.text,c.basis FROM classifications c JOIN blocks b ON b.id=c.block_id JOIN locations l ON l.sha256=c.hash WHERE l.state='present' ORDER BY c.category,l.path")
    table(db,work/'parse-failures-and-pending.csv',"SELECT p.hash,l.path,p.state,p.error,p.details FROM parses p JOIN locations l ON l.sha256=p.hash WHERE p.state!='parsed' ORDER BY p.state,l.path")
    table(db,work/'duplicate-content.csv',"SELECT l.sha256,l.path,l.resource_id,l.version_id FROM locations l WHERE l.state='present' AND l.sha256 IN (SELECT sha256 FROM locations WHERE state='present' AND sha256 IS NOT NULL GROUP BY sha256 HAVING count(*)>1) ORDER BY l.sha256,l.path")
    table(db,work/'same-name-different-content.csv',"SELECT name,path,sha256 FROM locations WHERE sha256 IS NOT NULL AND lower(name) IN (SELECT lower(name) FROM locations WHERE sha256 IS NOT NULL GROUP BY lower(name) HAVING count(DISTINCT sha256)>1) ORDER BY lower(name),sha256")
    table(db,work/'repeated-technical-passages.csv',"SELECT b.text_hash,b.hash,b.id,b.locator,b.text FROM blocks b WHERE length(b.text) BETWEEN 30 AND 2000 AND b.text_hash IN (SELECT text_hash FROM blocks WHERE length(text) BETWEEN 30 AND 2000 AND (text LIKE '%检查%' OR text LIKE '%故障%' OR text LIKE '%带载%' OR text LIKE '%接口%' OR text LIKE '%支持%') GROUP BY text_hash HAVING count(DISTINCT hash)>1) ORDER BY b.text_hash,b.hash")
    repairs=[dict(r) for r in db.execute('SELECT * FROM reference_repairs ORDER BY old_path')]
    for r in repairs:
        r['locations']=json.loads(r['locations'])
        if not r['locations']:
            r['sameNameCandidates']=[dict(x) for x in db.execute("SELECT path,sha256 FROM locations WHERE lower(name)=lower(?) AND state='present'",(Path(r['old_path']).name,))]
    save(work/'reference-repairs.json',repairs)
    overlay={'schemaVersion':'resource-location-overlay-1','roots':[r[0] for r in db.execute('SELECT DISTINCT root FROM scans WHERE finished IS NOT NULL')],'bySha256':{}}
    for r in repairs:
        if r['locations']:overlay['bySha256'][r['sha256']]=[x['path'] for x in r['locations']]
    save(work/'knowledge-reference-overlay.json',overlay)
    movement_file=e.PROJECT/'docs/v2/全量资料目录与关系地图-20261015/资料转存路径.json'
    movements=[]
    for old in json.loads(movement_file.read_text(encoding='utf8')):
        # Large binaries were deliberately not rehashed. Preserve historical proof,
        # but never label a new location hash-verified on filename and size alone.
        candidates=[dict(r) for r in db.execute("SELECT id,path,bytes,sha256 FROM locations WHERE name=? AND bytes=? AND state='present'",(Path(old['target']).name,old['bytes']))]
        movements.append({'oldSource':old['source'],'oldTarget':old['target'],'historicalSha256':old['sha256'],'candidates':candidates,'status':'current-hash-verified' if any(r['sha256']==old['sha256'] for r in candidates) else 'metadata-location-pending-content-verification' if candidates else 'not-located'})
    save(work/'known-large-move-locations.json',movements)
    summary['knownLargeMoves']=dict(collections.Counter(r['status'] for r in movements))
    # Metadata is a hint only. The evidence CSV above separately exposes actual content signals.
    after_rows=[]
    for row in db.execute("SELECT DISTINCT l.sha256,l.path,p.state FROM locations l LEFT JOIN parses p ON p.hash=l.sha256 WHERE l.kind='document' AND l.state='present'"):
        cats=[r[0] for r in db.execute('SELECT category FROM classifications WHERE hash=?',(row['sha256'],))]
        path_hint=bool(re.search('售后|知识库|FAQ|FQA|经验|培训|调试|维修|故障|案例',row['path'],re.I))
        content_hint=bool(set(cats)&{'aftersales-experience','manual-knowledge','training-project'})
        if path_hint or content_hint:
            after_rows.append({'path':row['path'],'sha256':row['sha256'],'parseState':row['state'],'pathHint':path_hint,'contentCategories':cats,'newContentVsPriorCatalogue':row['sha256'] not in old_hashes,'basis':'content-and-path-clues-not-case-extraction'})
    save(work/'aftersales-discovery.json',after_rows)
    summary['aftersalesDiscovery']={'files':len(after_rows),'uniqueContent':len({r['sha256'] for r in after_rows if r['sha256']}),'contentIdentifiedFiles':sum(bool(set(r['contentCategories'])&{'aftersales-experience','manual-knowledge','training-project'}) for r in after_rows),'pathOnlyFiles':sum(not bool(set(r['contentCategories'])&{'aftersales-experience','manual-knowledge','training-project'}) for r in after_rows)}
    shapes=[]
    for b in db.execute("SELECT b.id,b.hash,b.text,b.locator FROM blocks b WHERE EXISTS(SELECT 1 FROM classifications c WHERE c.hash=b.hash AND c.category IN ('aftersales-experience','manual-knowledge','training-project'))"):
        loc=json.loads(b['locator']);signals=[]
        if 'cells' in loc and loc.get('row',0)>1 and len(loc['cells'])>=3 and isinstance(loc['cells'][0],str) and loc['cells'][1] and loc['cells'][2] and not loc.get('part'):
            signals.append('question-and-action-row-not-confirmed-outcome')
        if re.search('故障现象|问题现象|客户反馈',b['text']):signals.append('case-narrative-anchor')
        if re.search('检查|核对|排查|检测',b['text']):signals.append('check-method-mention')
        if re.search('(?:问题|故障)(?:已)?解决|恢复正常|现象消失',b['text']):signals.append('outcome-mention-needs-case-scope')
        if signals:shapes.append({'blockId':b['id'],'sha256':b['hash'],'locator':loc,'signals':signals,'text':b['text']})
    save(work/'aftersales-record-shapes.json',shapes)
    summary['aftersalesRecordSignals']=dict(collections.Counter(s for r in shapes for s in r['signals']))
    summary['repeatedTechnicalPassageGroups']=db.execute("SELECT count(*) FROM (SELECT text_hash FROM blocks WHERE length(text) BETWEEN 30 AND 2000 AND (text LIKE '%检查%' OR text LIKE '%故障%' OR text LIKE '%带载%' OR text LIKE '%接口%' OR text LIKE '%支持%') GROUP BY text_hash HAVING count(DISTINCT hash)>1)").fetchone()[0]
    if with_coverage:
        cov=coverage(db);save(work/'old2231-coverage.json',cov);summary['old2231Coverage']=cov['counts']
        covered={m['sha256'] for r in cov['records'] for m in r['sourceMatches']}
        summary['aftersalesDiscovery']['contentWithoutLiteralOldCaseMatch']=len({r['sha256'] for r in after_rows if r['sha256']} - covered)
    # No claim that text equality proves equal engineering applicability.
    summary['repeatedTechnicalPassagesNote']='Exact normalized text links only; shared headings, differing surrounding scope and versions are not merged facts.'
    save(work/'coverage-report.json',summary);db.close();return summary


if __name__=='__main__':print(e.J(build(Path(sys.argv[1]) if len(sys.argv)>1 else e.DEFAULT_WORK)))
