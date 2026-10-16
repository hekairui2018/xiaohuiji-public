"""Four explicitly approved sources only; read-only resource identity and OOXML evidence."""
import collections,csv,hashlib,io,json,re,sqlite3,zipfile
from pathlib import Path,PurePosixPath
from xml.etree import ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'tmp/experience-stage2-20261016'
INDEX=ROOT/'tmp/resource-index-stage1-20261016/resources.db'
NAMES=['显示效果问题总结分享.docx','视频处理器问题经验分享.docx','LCD产品问题经验分享.docx','常见问题解答FQA表_显示&HDSet&接收卡问题.csv']
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS={'w':W}
J=lambda x:json.dumps(x,ensure_ascii=False,indent=2)
def sha(p):
 with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,obj):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(J(obj)+'\n',encoding='utf8')
def text(node):
 parts=[]
 for n in node.iter():
  if n.tag=='{'+W+'}t':parts.append(n.text or '')
  elif n.tag in {'{'+W+'}br','{'+W+'}cr'}:parts.append('\n')
  elif n.tag=='{'+W+'}tab':parts.append('\t')
 return ''.join(parts).strip()
def decode(raw):
 for encoding in ['utf-8-sig','gb18030']:
  try:return raw.decode(encoding)
  except UnicodeError:pass
 raise ValueError('Unknown CSV encoding')

def read_sources():
 db=sqlite3.connect(INDEX.resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
 docs=[]
 for number,name in enumerate(NAMES,1):
  locations=[dict(r) for r in db.execute("SELECT id,path,resource_id,version_id,sha256,bytes,mtime_ns FROM locations WHERE name=? AND state='present' ORDER BY path",(name,))]
  assert locations and len({r['sha256'] for r in locations})==1,'Missing or conflicting approved source '+name
  for loc in locations:assert sha(loc['path'])==loc['sha256'],'Source hash differs '+loc['path']
  p=Path(locations[0]['path']);doc={'documentId':f'D{number}','name':name,'sha256':locations[0]['sha256'],'resourceId':locations[0]['resource_id'],'resourceVersionId':locations[0]['version_id'],'locations':locations,'units':[],'images':[],'tables':[]}
  def unit(locator,content,**extra):
   uid='ev-'+hashlib.sha256((doc['sha256']+'|'+json.dumps(locator,sort_keys=True)).encode()).hexdigest()[:24]
   row={'evidenceId':uid,'documentId':doc['documentId'],'resourceId':doc['resourceId'],'resourceVersionId':doc['resourceVersionId'],'sha256':doc['sha256'],'ordinal':len(doc['units']),'locator':locator,'text':content,**extra};doc['units'].append(row);return row
  if p.suffix=='.csv':
   rows=list(csv.reader(io.StringIO(decode(p.read_bytes()))));doc['header']=rows[0];doc['physicalRows']=len(rows)
   for ri,row in enumerate(rows,1):
    if any(v.strip() for v in row):unit({'format':'csv','row':ri},' | '.join(row),cells=row,header=rows[0])
  else:
   with zipfile.ZipFile(p) as z:
    assert sum(i.file_size for i in z.infolist() if i.filename.endswith('.xml'))<64*1024**2
    relationships={r.attrib['Id']:r.attrib for r in ET.fromstring(z.read('word/_rels/document.xml.rels'))}
    root=ET.fromstring(z.read('word/document.xml'));body=root.find('w:body',NS)
    styles=ET.fromstring(z.read('word/styles.xml')) if 'word/styles.xml' in z.namelist() else []
    doc['styleDefinitionsPresent']=any(n.tag=='{'+W+'}style' for n in styles)
    doc['headingHierarchyStatus']='numeric-style-and-text-structure-candidate-not-guaranteed-outline'
    def images(node,loc):
     found=[]
     for el in node.iter():
      rid=el.attrib.get('{'+R+'}embed') or (el.attrib.get('{'+R+'}id') if el.tag.endswith('}imagedata') else None)
      if not rid:continue
      rel=relationships.get(rid,{});target=rel.get('Target','');member=str(PurePosixPath('word')/target) if not target.startswith('/') else target.lstrip('/')
      # No image decode or OCR here. Image bytes are never in the review ZIP.
      item={'imageId':doc['documentId']+'-'+rid,'relationshipId':rid,'part':member,'anchor':loc,'status':'not-read-no-OCR','bytes':z.getinfo(member).file_size if member in z.namelist() else None}
      doc['images'].append(item);found.append(item['imageId'])
     return found
    counters=collections.Counter()
    for node in body:
     local=node.tag.rsplit('}',1)[-1];counters[local]+=1;base=f'./w:body/w:{local}[{counters[local]}]'
     if local=='p':
      loc={'part':'word/document.xml','xpath':base};content=text(node);style=node.find('w:pPr/w:pStyle',NS);style_id=style.attrib.get('{'+W+'}val') if style is not None else None;im=images(node,loc)
      unit(loc,content,styleId=style_id,headingLevelCandidate=int(style_id) if style_id in ['1','2','3','4'] else None,imageIds=im)
     elif local=='tbl':
      table={'table':counters[local],'locator':{'part':'word/document.xml','xpath':base},'rows':[]}
      for ri,row in enumerate(node.findall('w:tr',NS),1):
       cells=[text(cell) for cell in row.findall('w:tc',NS)];loc={'part':'word/document.xml','xpath':base+f'/w:tr[{ri}]','table':counters[local],'row':ri};im=images(row,loc)
       u=unit(loc,' | '.join(cells) if any(cells) else '',cells=cells,table=counters[local],imageIds=im);table['rows'].append(u['evidenceId'])
      doc['tables'].append(table)
     else:
      # Preserve unrecognized wrappers as evidence; do not silently throw text away.
      content=text(node);im=images(node,{'part':'word/document.xml','xpath':base})
      if content or im:unit({'part':'word/document.xml','xpath':base},content,unclassifiedWrapper=local,imageIds=im)
   doc['imageReferenceCount']=len(doc['images']);doc['uniqueImageParts']=len({i['part'] for i in doc['images']})
  for u in doc['units']:
   for filename in re.findall(r'[^\s|/\\]+\.(?:png|jpg|jpeg|bmp)',u['text'],re.I):
    matches=[dict(r) for r in db.execute("SELECT id,path,bytes FROM locations WHERE name=? AND state='present'",(filename,))]
    doc['images'].append({'imageId':'attachment-'+hashlib.sha256(filename.encode()).hexdigest()[:16],'name':filename,'anchor':u['locator'],'status':'indexed-file-not-read' if matches else 'referenced-attachment-not-located','locations':matches})
  docs.append(doc)
 db.close();return docs

def reread(doc,unit):
 p=Path(doc['locations'][0]['path']);assert sha(p)==doc['sha256']
 if p.suffix=='.csv':
  row=list(csv.reader(io.StringIO(decode(p.read_bytes()))))[unit['locator']['row']-1];return ' | '.join(row)
 with zipfile.ZipFile(p) as z:
  root=ET.fromstring(z.read('word/document.xml'));node=root.find(unit['locator']['xpath'],NS)
  if node is None:raise ValueError('Evidence XPath does not resolve')
  if node.tag=='{'+W+'}tr':
   cells=[text(c) for c in node.findall('w:tc',NS)];return ' | '.join(cells) if any(cells) else ''
  return text(node)

if __name__=='__main__':
 docs=read_sources();save(WORK/'source-evidence.json',docs)
 for d in docs:
  lines=[d['name']]+[f"[{u['ordinal']}|{u.get('styleId','')}|{u['evidenceId']}] {u['text']}" for u in d['units'] if u['text']]
  (WORK/(d['documentId']+'-全文.txt')).write_text('\n'.join(lines),encoding='utf8')
 print(J([{k:d[k] for k in ['documentId','name','sha256']}|{'units':len(d['units']),'images':len(d['images']),'tables':len(d['tables']),'chars':sum(len(u['text']) for u in d['units'])} for d in docs]))
