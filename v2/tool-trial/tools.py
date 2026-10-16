"""Five ordinary, model-independent, read-only tools over the existing index."""
import argparse,hashlib,json,re,time
from common import WORK,INDEX,engine,load
from case_context import boundaries,envelope

class ToolError(ValueError):pass

def clean(text):
 text=re.sub(r'(?i)password\s*\([^)]*\)|(?:密码|secret|app_secret|access_token)\s*[:=：]\s*[^\s；;|]+','[敏感配置已屏蔽]',text)
 text=re.sub(r'[A-Za-z]:\\[^\r\n|<>"\']+|\\\\[^\r\n|<>"\']+','[内部路径已屏蔽]',text)
 text=re.sub(r'(?<!\d)1[3-9]\d{9}(?!\d)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}','[联系方式已屏蔽]',text)
 text=re.sub(r'(?<!\d)(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?!\d)','[内网地址已屏蔽]',text)
 return text

def database():return engine.connect(INDEX,True)

class Tools:
 def __init__(self):
  self.case_cache={}
  self.policy=load('access-policy.json')['resources']
  # Same filename may have different content versions. Never serve another
  # version merely because the old fixture grouped all same-name locations.
  self.policy={h:{**r,'locations':[loc for loc in r['locations'] if not loc.get('sha256') or loc['sha256']==h]} for h,r in self.policy.items()}
  if any(not r['locations'] for r in self.policy.values()):raise ToolError('resource-version-has-no-matching-location')
 def allowed(self,hash_):return hash_ in self.policy and not self.policy[hash_].get('restricted')
 def resource(self,hash_):
  if not self.allowed(hash_):raise ToolError('resource-not-authorized')
  return self.policy[hash_]
 def block(self,row,offset=0,cap=750):
  r=self.resource(row['hash']);raw=row['text'];loc=json.loads(row['locator']) if isinstance(row['locator'],str) else row['locator']
  # Locators are positions, never duplicate raw CSV cells or private metadata.
  loc={k:clean(v) if isinstance(v,str) else v for k,v in loc.items() if k in ['part','paragraph','page','table','row','charStart','charEnd','section']}
  record_date=None
  # Dates remain source metadata; people/keywords are not observations.
  if r['name'].endswith('.csv'):
   fields=raw.split(' | ');record_date=fields[0] if len(fields)>=3 else None;raw='问题：'+fields[1]+'\n原始处理记录：'+fields[2] if len(fields)>=3 else raw
  if re.search('禁止外传|不得外传|禁止外发|保密资料|仅限内部',raw):raise ToolError('restricted-source-fragment')
  raw=clean(raw);part=raw[offset:offset+cap]
  return {'evidenceId':'blk-'+row['hash'][:16]+'-'+str(row['ordinal']),'blockId':row['id'],'resourceId':r['resourceId'],'versionId':r['versionId'],'sourceName':r['name'],'sourceType':r['sourceType'],
   'text':part,'recordDate':record_date,'locator':loc,'offset':offset,'truncated':offset+cap<len(raw),'nextOffset':offset+cap if offset+cap<len(raw) else None,'models':json.loads(row['models']) if isinstance(row['models'],str) else row['models'],
   'verificationStatus':'original-source-not-independently-verified','scopeWarning':'型号提及不代表兼容；原始经验不能当通用结论','imagesRead':False,'readMore':{'resourceId':r['resourceId'],'versionId':r['versionId'],'blockId':row['id']}}
 def search(self,query,mode,model=None,version=None,limit=2,cases=False):
  if not isinstance(query,str) or not 1<=len(query)<=240:raise ToolError('query-length')
  if model is not None and (not isinstance(model,str) or len(model)>40):raise ToolError('model-format')
  if version is not None and (not isinstance(version,str) or len(version)>40):raise ToolError('version-format')
  if type(limit)!=int or not 1<=limit<=3:raise ToolError('limit-range')
  result=engine.query(INDEX,query,mode,model,50,version,authorized_keys=[k for k in self.policy if self.allowed(k)]);out=[];context=None;db=database()
  try:
   for hit in result['results']:
    key=hit.get('sha256') or 'metadata:'+str(hit.get('resourceId'))
    if not self.allowed(key):continue
    r=self.resource(key)
    if cases and r['sourceType']!='engineering_reference':continue
    if hit['kind']=='passage':
     row=db.execute('select * from blocks where id=?',(hit['blockId'],)).fetchone()
     record=None
     if r['sourceType']=='engineering_reference':
      record=self.read_case(dict(row));requested=set(result.get('requestedModels',[]));scope=set(record['scopeMentions'])
      # A treatment-only paragraph inherits the literal model mentions of its
      # source record. Empty paragraph models must not bypass exact isolation.
      if requested and scope and not requested.intersection(scope):continue
     try:item=self.block(dict(row))
     except ToolError:continue
     if cases:item.update({'caseId':'source-case:'+str(hit['blockId']),'recordType':'source-excerpt-not-verified-independent-case'})
     if context is None and record is not None:context=record
    else:item={'evidenceId':'file-'+hashlib.sha256((r['resourceId']+'\n'+r['versionId']).encode()).hexdigest()[:16],'resourceId':r['resourceId'],'versionId':r['versionId'],'sourceName':r['name'],'type':r['type'],'versions':hit['versions'],'sourceType':r['sourceType'],'download':('/download?resourceId='+r['resourceId']+'&versionId='+r['versionId']) if r['downloadAllowed'] else None,'readMore':{'resourceId':r['resourceId'],'versionId':r['versionId']},'verificationStatus':'file-identity-only-not-engineering-validation'}
    item['score']=hit['score'];out.append(item)
    if len(out)>=limit:break
  finally:db.close()
  return {'query':query,'results':out,'blocks':context['blocks'] if context else [],'caseContext':{k:v for k,v in context.items() if k!='blocks'} if context else None,'underlyingRequestedModels':result.get('requestedModels',[]),'engineElapsedMs':result['elapsedMs'],'scope':'authorized experiment subset; original ranking unchanged; top engineering passage includes bounded source record','moreAvailable':'use a narrower query or readMore; maximum 3 hits per call'}
 def execute(self,name,args):
  if not isinstance(args,dict):raise ToolError('arguments-object-required')
  schemas={s['function']['name']:s['function']['parameters'] for s in DEFINITIONS}
  if name not in schemas:raise ToolError('unknown-tool')
  schema=schemas[name]
  if set(args)-set(schema['properties']) or set(schema.get('required',[]))-set(args):raise ToolError('unexpected-or-missing-arguments')
  started=time.perf_counter()
  if name in ['search_resources','search_document_blocks','search_cases']:value=self.search(args['query'],'files' if name=='search_resources' else 'text',args.get('model'),args.get('version'),args.get('limit',2),name=='search_cases')
  elif name=='get_case':
   if not isinstance(args['caseId'],str) or not re.fullmatch(r'source-case:\d+',args['caseId']):raise ToolError('case-not-found')
   block_id=int(args['caseId'].split(':')[1]);db=database()
   try:row=db.execute('select * from blocks where id=?',(block_id,)).fetchone()
   finally:db.close()
   if row is None:raise ToolError('case-not-found')
   r=self.resource(row['hash'])
   if r['sourceType']!='engineering_reference':raise ToolError('case-not-found')
   value=self.read_case(dict(row),args.get('offset',0));value['recordType']='source-excerpt-not-verified-independent-case'
  else:value=self.read(args['resourceId'],args['versionId'],args.get('blockId'),args.get('offset',0),args.get('radius',1))
  return value|{'toolElapsedMs':round((time.perf_counter()-started)*1000,3)}
 def read_case(self,anchor,offset=0):
  if type(offset)!=int or not 0<=offset<=200000:raise ToolError('read-range')
  key=anchor['hash'];r=self.resource(key)
  if key not in self.case_cache:
   db=database()
   try:rows=[dict(x) for x in db.execute('select * from blocks where hash=? order by ordinal',(key,))]
   finally:db.close()
   self.case_cache[key]=(rows,boundaries(rows,r['name'].endswith('.csv')))
  rows,spans=self.case_cache[key];idx=next(i for i,x in enumerate(rows) if x['id']==anchor['id'])
  start,end,status=next(s for s in spans if s[0]<=idx<=s[1])
  # Offset is a page in the contiguous original record, not a neighbouring case.
  selected=rows[start:end+1];blocks=[];used=0;cursor=0;next_offset=None
  for row in selected:
   full=self.block(row,0,200001);text=full['text'];length=len(text)+1
   if cursor+length<=offset:cursor+=length;continue
   local=max(0,offset-cursor);cap=min(1400,4000-used)
   if cap<=0 or len(blocks)>=18:next_offset=cursor+local;break
   b=self.block(row,local,cap);blocks.append(b);used+=len(b['text'])
   if b['truncated']:next_offset=cursor+local+len(b['text']);break
   cursor+=length
  value={'resourceId':r['resourceId'],'versionId':r['versionId'],'caseId':'source-case:'+str(rows[start]['id']),
   'scopeMentions':sorted({m for row in selected for m in (json.loads(row['models']) if isinstance(row['models'],str) else row['models'])}),
   'blocks':blocks,'caseEnvelope':envelope(blocks,status),'nextCaseOffset':next_offset,
   'completeRecordDelivered':next_offset is None,'recordBlockCount':len(selected),
   'note':'Source structure only, not verified case extraction. Use nextCaseOffset with get_case to continue. Role hints are not engineering conclusions.'}
  return value
 def read(self,resourceId,versionId,blockId=None,offset=0,radius=1):
  if type(offset)!=int or not 0<=offset<=200000 or type(radius)!=int or not 0<=radius<=2:raise ToolError('read-range')
  pair=next(((h,r) for h,r in self.policy.items() if r['resourceId']==resourceId and r['versionId']==versionId and self.allowed(h)),None)
  if not pair:raise ToolError('resource-version-not-authorized')
  hash_,r=pair;db=database()
  try:
   if blockId is None:anchor=db.execute('select * from blocks where hash=? order by ordinal limit 1',(hash_,)).fetchone()
   elif type(blockId)==int:anchor=db.execute('select * from blocks where id=? and hash=?',(blockId,hash_)).fetchone()
   else:raise ToolError('block-id-format')
   if not anchor:return {'status':'no-readable-text','resourceId':resourceId,'versionId':versionId,'blocks':[]}
   if r['sourceType']=='engineering_reference':
    # Existing read_document offsets are local to the requested block.
    # get_case nextCaseOffset is explicitly relative to the source record.
    case_offset=offset
    if offset:
     self.read_case(dict(anchor),0)
     all_rows,spans=self.case_cache[hash_];i=next(i for i,x in enumerate(all_rows) if x['id']==anchor['id'])
     start=next(s for s,e,_ in spans if s<=i<=e)
     case_offset+=sum(len(self.block(x,0,200001)['text'])+1 for x in all_rows[start:i])
    return self.read_case(dict(anchor),case_offset)
   rows=db.execute('select * from blocks where hash=? and ordinal between ? and ? order by ordinal',(hash_,anchor['ordinal']-radius,anchor['ordinal']+radius)).fetchall();blocks=[]
   for row in rows:
    try:blocks.append(self.block(dict(row),offset if row['id']==anchor['id'] else 0,1000 if row['id']==anchor['id'] else 450))
    except ToolError:continue
   return {'resourceId':resourceId,'versionId':versionId,'blocks':blocks,'note':'literal context; no verified diagnosis or inferred steps'}
  finally:db.close()

def definition(name,description,properties,required):return {'type':'function','function':{'name':name,'description':description,'parameters':{'type':'object','properties':properties,'required':required,'additionalProperties':False}}}
STR={'type':'string'};INT={'type':'integer'}
SEARCH={'query':STR,'model':STR,'version':STR,'limit':{'type':'integer','minimum':1,'maximum':3}}
READ_OFFSET={'type':'integer','minimum':0,'maximum':200000}
READ_RADIUS={'type':'integer','minimum':0,'maximum':2}
DEFINITIONS=[definition('search_resources','查授权文件目录：规格书、说明书、软件或固件资源。精确型号后缀和版本不可合并。',SEARCH,['query']),definition('search_document_blocks','查文档正文、章节、表格和操作内容，返回原文及blockId。必要时缩短关键词，再read_document。',SEARCH,['query']),definition('read_document','按检索返回的资源、版本和blockId继续读上下文；offset读取截断后的内容。',{'resourceId':STR,'versionId':STR,'blockId':INT,'offset':READ_OFFSET,'radius':READ_RADIUS},['resourceId','versionId']),definition('search_cases','查有来源的工程经验原文，不代表核验成功的案例；冲突/条件/图片必须继续核实。',SEARCH,['query']),definition('get_case','读取search_cases返回的source-case编号及上下文；没有结构化验收案例就只返回原文。',{'caseId':{'type':'string','pattern':'^source-case:[0-9]+$'},'offset':READ_OFFSET},['caseId'])]

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('name');p.add_argument('arguments');a=p.parse_args();print(json.dumps(Tools().execute(a.name,json.loads(a.arguments)),ensure_ascii=False,indent=2))
