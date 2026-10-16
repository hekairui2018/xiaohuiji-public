"""Real HTTP and original-file checks. Frozen cases never derive answers from search output."""
import hashlib
import json
from pathlib import Path
import statistics
import sys
import threading
import time
from urllib.parse import urlencode
from urllib.request import urlopen
import engine as e
from server import create_server


def run(work):
    fixture=json.loads(Path(__file__).with_name('business-fixtures.json').read_text(encoding='utf8'))
    server=create_server(work);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
    db=e.connect(work,True);records=[];timings=[];evidence=0;correct_evidence=0;model_errors=0
    get=lambda path:json.loads(urlopen(base+path,timeout=30).read().decode('utf8'))
    try:
        assert get('/health')['aiEnabled'] is False
        for case in fixture['cases']:
            params={'q':case['query'],'mode':case['mode'],'limit':10}
            for key in ['model','version']:
                if case.get(key):params[key]=case[key]
            s=time.perf_counter();r=get('/search?'+urlencode(params));elapsed=(time.perf_counter()-s)*1000;timings.append(elapsed);hits=r['results'];checks={}
            expected=[]
            if case.get('expectedName'):
                # Acceptable set is located independently by the frozen filename, then hash.
                expected=[row[0] for row in db.execute("SELECT DISTINCT sha256 FROM locations WHERE name=? AND state='present'",(case['expectedName'],))]
                checks['sourceTargetExists']=bool(expected)
                checks['targetInTop10']=any(h.get('sha256') in expected and (not case.get('literal') or case['literal'] in (h.get('text') or '')) for h in hits)
                checks['top1Target']=bool(hits and hits[0].get('sha256') in expected)
            if case.get('requireAny'):checks['shortTermRecall']=bool(hits)
            if case.get('expectedEmpty'):checks['unknownModelNoSubstitution']=not hits
            if case.get('forbidOwner'):
                wrong=[]
                for hit in hits:
                    for loc in hit['locations']:
                        owners={row[0] for row in db.execute('SELECT model FROM model_owners WHERE location_id=?',(loc['id'],))}
                        if case['forbidOwner'] in owners and case['model'] not in owners:wrong.append(loc['id'])
                checks['noForeignOwner']=not wrong;model_errors+=len(wrong)
            for hit in hits:
                if hit['kind']!='passage':continue
                evidence+=1;read=get('/read?'+urlencode({'block':hit['blockId']}));same=any(b['text']==hit['text'] and b['locator']==hit['locator'] for b in read['blocks'])
                # Reopen the source with the local parser and verify the locator and literal text.
                # Cache is only per source hash in this acceptance run, never an AI answer.
                original=Path(hit['locations'][0]['path'])
                raw=original_cache.get(hit['sha256'])
                if raw is None:
                    raw=e.extract(original);original_cache[hit['sha256']]=raw
                supported=any(b['locator']==hit['locator'] and b['text']==hit['text'] for b in raw['blocks'])
                correct_evidence+=bool(same and supported)
                if case.get('locatorKey') and hit.get('sha256') in expected:checks['locatorPresent']=case['locatorKey'] in hit['locator']
            hard={k:v for k,v in checks.items() if k!='top1Target'}
            records.append({'id':case['id'],'input':params,'checks':checks,'passed':all(hard.values()),'httpMs':round(elapsed,3),'output':r})
        # All known relocated original URLs work and deliver exact bytes.
        bundle=json.loads((e.PROJECT/'v2/data/evidence/knowledge-source-batch-20261015-aftersales.json').read_text(encoding='utf8'))
        downloads=[]
        for d in bundle['documents']:
            with urlopen(base+'/v2/resources/original/'+d['sha256'],timeout=30) as response:
                data=response.read();downloads.append({'name':d['name'],'http':response.status,'hashMatches':hashlib.sha256(data).hexdigest()==d['sha256']})
        # Distinct causes remain independently searchable, not one generated troubleshooting tree.
        html=urlopen(base+'/').read().decode('utf8');assert '原始资料检索' in html
        target=[r for r in records if 'targetInTop10' in r['checks']]
        summary={'businessCases':len(records),'passed':sum(r['passed'] for r in records),'failed':sum(not r['passed'] for r in records),'annotatedTargetCases':len(target),'top1Correct':sum(r['checks']['top1Target'] for r in target),'targetRecallAt10':sum(r['checks']['targetInTop10'] for r in target)/len(target),'foreignModelErrors':model_errors,'originalEvidenceChecks':evidence,'originalEvidenceCorrect':correct_evidence,'httpP50Ms':round(statistics.median(timings),3),'httpP95Ms':round(sorted(timings)[int(.95*(len(timings)-1))],3),'relocatedDownloads':downloads,'aiEnabled':False,'meaning':'Offline retrieval correctness on fixed annotated sources; not field repair success or complete corpus recall.'}
        result={'summary':summary,'records':records};(Path(work)/'business-acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');return summary
    finally:db.close();server.shutdown();server.server_close();thread.join()


original_cache={}
if __name__=='__main__':
    result=run(Path(sys.argv[1]) if len(sys.argv)>1 else e.DEFAULT_WORK);print(e.J(result));sys.exit(0 if not result['failed'] and result['originalEvidenceChecks']==result['originalEvidenceCorrect'] and all(d['hashMatches'] for d in result['relocatedDownloads']) else 1)
