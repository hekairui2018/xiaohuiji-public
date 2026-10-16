"""Original-file and tool projection readback, without rebuilding the index."""
import collections,csv,io,json
from pathlib import Path
from common import ROOT,WORK,INDEX,engine,load,save,sha
from tools import Tools,clean

def run():
 policy=load('access-policy.json')['resources'];db=engine.connect(INDEX,True);originals=[];parsed={};errors=[]
 for key,r in policy.items():
  for loc in r['locations']:
   p=Path(loc['path']);s=p.stat();ok=s.st_size==loc['bytes'] and s.st_mtime_ns==loc['mtime_ns'];actual=sha(p) if loc['sha256'] else None
   originals.append({'resourceId':r['resourceId'],'versionId':r['versionId'],'sourceName':r['name'],'path':str(p),'metadataMatches':ok,'sha256':actual,'expectedSHA256':loc['sha256'],'hashMatches':actual==loc['sha256'] if actual else None,'binaryMetadataOnly':loc['sha256'] is None})
  if not key.startswith('metadata:'):
   try:parsed[key]=engine.extract(Path(r['locations'][0]['path']))['blocks']
   except Exception as e:errors.append({'sourceName':r['name'],'error':repr(e)})
 records=[json.loads(p.read_text(encoding='utf8')) for p in (WORK/'results').glob('*.json')];seen={}
 def add(items):
  for item in items:
   if item.get('blockId'):seen[(item['blockId'],item.get('offset',0),len(item.get('text','')))]=item
 for r in records:
  add(r['direct']['search']['results']);add((r['direct'].get('context') or {}).get('blocks',[]))
  for t in r['hybrid'].get('tools',[]):add(t.get('result',{}).get('results',[])+t.get('result',{}).get('blocks',[]))
 checks=[];source_units=collections.defaultdict(dict)
 for (_,_,_),item in seen.items():
  row=db.execute('select * from blocks where id=?',(item['blockId'],)).fetchone();r=next(r for r in policy.values() if r['resourceId']==item['resourceId'] and r['versionId']==item['versionId']);raw=row['text']
  original=any(b['text']==raw and b['locator']==json.loads(row['locator']) for b in parsed.get(row['hash'],[]))
  projected=raw
  if r['name'].endswith('.csv'):
   cols=raw.split(' | ');projected='问题：'+cols[1]+'\n原始处理记录：'+cols[2] if len(cols)>=3 else raw
  projected=clean(projected);offset=item.get('offset',0);toolmatches=projected[offset:offset+len(item['text'])]==item['text']
  checks.append({'evidenceId':item['evidenceId'],'blockId':row['id'],'originalLocatorReread':original,'toolPublicProjectionMatches':toolmatches,'projection':'CSV question+solution columns with metadata excluded; sensitive strings masked. Offset is within public projection, locator identifies original row/paragraph.'})
  source_units[row['hash']][row['id']]={'evidenceId':item['evidenceId'],'blockId':row['id'],'ordinal':row['ordinal'],'locator':json.loads(row['locator']),'text':raw,'cells':raw.split(' | ') if r['name'].endswith('.csv') else []}
 # Frozen expected evidence is included even when all three approaches miss it.
 for q in load('questions.json')+load('supplemental-real-log-questions.json'):
  for ref in q['expectedEvidence']:
   row=db.execute('select * from blocks where id=?',(ref['blockId'],)).fetchone();source_units[row['hash']][row['id']]={'evidenceId':'blk-'+row['hash'][:16]+'-'+str(row['ordinal']),'blockId':row['id'],'ordinal':row['ordinal'],'locator':json.loads(row['locator']),'text':row['text'],'cells':row['text'].split(' | ')}
   for nearby in db.execute('select * from blocks where hash=? and ordinal between ? and ? order by ordinal',(row['hash'],row['ordinal']-2,row['ordinal']+2)):
    source_units[nearby['hash']].setdefault(nearby['id'],{'evidenceId':'blk-'+nearby['hash'][:16]+'-'+str(nearby['ordinal']),'blockId':nearby['id'],'ordinal':nearby['ordinal'],'locator':json.loads(nearby['locator']),'text':nearby['text'],'cells':nearby['text'].split(' | '),'contextPurpose':'原始预期证据邻段，供独立跨段回读；不新增或改写测试答案'})
 docs=[];authors=set()
 for key,r in policy.items():
  header=[]
  if r['name'].endswith('.csv'):
   rows=list(csv.reader(io.StringIO(Path(r['locations'][0]['path']).read_text(encoding='utf-8-sig'))));header=rows[0]
   if '记录人' in header:
    n=header.index('记录人');authors.update(row[n] for row in rows[1:] if len(row)>n and len(row[n])>=2)
  docs.append({'name':r['name'],'resourceId':r['resourceId'],'resourceVersionId':r['versionId'],'sha256':None if key.startswith('metadata:') else key,'locations':r['locations'],'header':header,'units':[{'text':'原表头','cells':header}]+list(source_units[key].values()) if header else list(source_units[key].values()),'scope':'all returned and expected evidence; untouched originals remain on G drive'})
 save(WORK/'source-evidence.json',docs);save(WORK/'internal-only/author-tokens.json',sorted(authors));save(WORK/'original-file-checks.json',originals);save(WORK/'evidence-readback.json',checks)
 frozen=load('frozen-manifest.json');indexsame=sha(INDEX/'resources.db')==frozen['indexSHA256'];assert indexsame
 baselines=json.loads((ROOT/'tmp/experience-stage2-20261016/safety-checks.json').read_text(encoding='utf8'));state=[{'path':b['path'],'unchanged':sha(ROOT/b['path'])==b['sha256']} for b in baselines]
 result={'originalLocationsChecked':len(originals),'sourceHashFailures':sum(x['hashMatches'] is False for x in originals),'metadataFailures':sum(not x['metadataMatches'] for x in originals),'uniqueToolFragments':len(checks),'originalLocatorMatches':sum(x['originalLocatorReread'] for x in checks),'toolProjectionMatches':sum(x['toolPublicProjectionMatches'] for x in checks),'parseFailures':errors,'indexUnchanged':indexsame,'activeAndCandidateUnchanged':state}
 save(WORK/'source-safety-summary.json',result);db.close();print(json.dumps(result,ensure_ascii=False));return result

if __name__=='__main__':run()
