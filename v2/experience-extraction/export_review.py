"""Separate local redacted copy; never alters internal evidence or originals."""
import collections,csv,hashlib,html,json,re,time,zipfile
from pathlib import Path
from source import WORK,sha,save

def build(work=WORK,archive_name='小灰机二代_第二阶段工程经验_脱敏审查包.zip',readme_text=None,extra_redactions=(),transform_json=None,extra_files=(),exclude_files=()):
 WORK=Path(work)
 docs=json.loads((WORK/'source-evidence.json').read_text(encoding='utf8'))
 authors=set(extra_redactions)
 for d in docs:
  if not d['name'].endswith('.csv'):continue
  if '记录人' not in d.get('header',[]):continue
  index=d['header'].index('记录人')
  for u in d['units'][1:]:
   value=u['cells'][index] if len(u['cells'])>index else ''
   for name in re.split(r'[,，、/\s]+',value):
    if 2<=len(name)<=24 and name not in ['记录人','无','暂无']:authors.add(name)
 counts=collections.Counter();out=WORK/'review-redacted';out.mkdir(exist_ok=True)
 def replace(pattern,replacement,s,label,flags=0):
  result,n=re.subn(pattern,replacement,s,flags=flags);counts[label]+=n;return result
 def redact(s):
  if s.startswith('data:image/'):
   counts['image-payload']+=1
   return '[本地图片载荷未入包；载荷文本SHA256='+hashlib.sha256(s.encode()).hexdigest()+']'
  for name in sorted(authors,key=len,reverse=True):
   n=s.count(name)
   if n:s=s.replace(name,'[记录人员已脱敏]');counts['author']+=n
  s=replace(r"password\s*\(\s*(['\"])(.*?)\1\s*\)","password('[凭证已脱敏]')",s,'credential',re.I)
  s=replace(r'(?i)(密码|password|app_secret|secret|access_token)\s*[:=：]\s*[\"\']?([^\s|；;，,<>]+)',r'\1=[凭证已脱敏]',s,'credential')
  s=replace(r'(?i)identified\s+by\s+[\"\'][^\"\']+[\"\']',"identified by '[凭证已脱敏]'",s,'credential')
  s=replace(r'(?<!\d)1[3-9]\d{9}(?!\d)','[电话已脱敏]',s,'phone')
  s=replace(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}','[邮箱已脱敏]',s,'email')
  s=replace(r'(?<!\d)(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?!\d)','[内网地址已脱敏]',s,'private-address')
  s=replace(r'https?://[^\s<>"\']+',lambda m:'[来源链接别名-'+hashlib.sha256(m[0].encode()).hexdigest()[:12]+']',s,'source-url')
  s=replace(r'[A-Za-z]:\\[^\r\n\t|<>"\']+',lambda m:'[本地位置别名-'+hashlib.sha256(m[0].encode()).hexdigest()[:12]+']',s,'local-location')
  return s
 def walk(x):
  if isinstance(x,str):return redact(x)
  if isinstance(x,list):return [walk(v) for v in x]
  if isinstance(x,dict):return {k:walk(v) for k,v in x.items()}
  return x
 included=[]
 extensions={'.json','.csv','.txt','.md','.html','.jsonl'}
 files=list(WORK.iterdir())+list((WORK/'calls').glob('*.json'))+list(extra_files)
 for p in sorted(files):
  if not p.is_file() or p.suffix not in extensions or p.name in exclude_files or p.name.startswith(('review-package','redaction-')):continue
  if p.suffix=='.jsonl' and p not in extra_files:continue
  raw=p.read_text(encoding='utf-8-sig')
  if p.suffix=='.json':
   parsed=json.loads(raw)
   if transform_json:parsed=transform_json(p.relative_to(WORK).as_posix(),parsed)
   data=json.dumps(walk(parsed),ensure_ascii=False,indent=2)+'\n'
  elif p.suffix=='.jsonl':
   data=''.join(json.dumps(walk(json.loads(line)),ensure_ascii=False)+'\n' for line in raw.splitlines() if line.strip())
  elif p.suffix=='.csv':
   reader=csv.reader(raw.splitlines(keepends=True));stream=__import__('io').StringIO(newline='');writer=csv.writer(stream)
   for row in reader:writer.writerow([redact(v) for v in row])
   data=stream.getvalue()
  else:data=redact(raw)
  relative=p.relative_to(WORK);target=out/relative;target.parent.mkdir(exist_ok=True,parents=True);target.write_text(data,encoding='utf8')
  included.append({'name':str(relative),'internalSHA256':sha(p),'redactedSHA256':sha(target),'bytes':target.stat().st_size})
 note={'scope':['record authors','phone/email/private IP','source URLs and absolute local paths','explicit password/secret expressions'],
  'replacementOccurrences':dict(counts),'files':included,'originalsModified':False,'sourceOffsets':'Evidence IDs and original locators are preserved; offsets refer to internal unredacted text, not masked string lengths. Readback was performed against originals before redaction.',
  'limitations':['redaction is pattern-based and does not certify approval for public release','technical engineering content is intentionally retained','no source images, original DOCX/CSV binaries or resource database included','internal original evidence is stored separately and unchanged']}
 save(out/'redaction-manifest.json',note)
 (out/'README.md').write_text(readme_text or '''# 四份工程经验候选：独立审查包

1. 先看质量审查报告.md、质量审查.html及quality-metrics.json。
2. agent-reviewed-records.json为25条逐条原文标注；agent-organized-combined-experiences.json为3组有案例依据的对照，不是唯一诊断答案。
3. source-evidence.json及D1—D4全文保留完整正文、表格文字和图像锚点。用evidenceId、resourceId、resourceVersionId及XPath/CSV行回查。无图片内容，不把图片未读当已理解。
4. source-field-comparison.csv给出136处字段与原文。automatic-vs-source-review.json保留自动提炼失败。517条自动分段/8组词面聚类仅为待复核候选，不是验收通过数量。
5. baseline-first-extraction.json和baseline-first-structure.json保留初版自动输出；first-reviewed-annotation-failure.txt保留版本混用被断言阻止的失败。
6. faq-types.json是人工原问答的候选知识类型；不生成FAQ替代原知识。duplicate报告区分重复来源、版本差异、相似但不同条件。
7. 所有统计是固定目的样本的Agent原文审查，不是独立人工工程验收或全库准确率。未进行现场硬件测试，本地模型未连接，无云调用。
8. 本包为独立脱敏副本，原件及内部候选保持原样。人员、凭证、联系信息、绝对路径和来源链接脱敏；技术证据尽量保留。字符偏移对应内部原文，脱敏位置请用evidenceId/原始定位核对。仍含公司技术资料，未自动上传或公开。
''',encoding='utf8')
 archive=WORK/archive_name
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for p in sorted(out.rglob('*')):
   if p.is_file():z.write(p,p.relative_to(out).as_posix())
 with zipfile.ZipFile(archive) as z:assert z.testzip() is None
 assert archive.stat().st_size<=10*1024**2,'Review package exceeded target; split by document before delivery, never discard evidence.'
 result={'path':str(archive),'bytes':archive.stat().st_size,'sha256':sha(archive),'files':sum(p.is_file() for p in out.rglob('*')),'redactionOccurrences':dict(counts),'containsOriginalBinaries':False,'uploaded':False}
 save(WORK/'review-package-manifest.json',result);print(json.dumps(result,ensure_ascii=False))
 return result

if __name__=='__main__':build()
