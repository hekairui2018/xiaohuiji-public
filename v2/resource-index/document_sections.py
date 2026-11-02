"""Structural original-text sections. Never edits source documents."""
import re,zipfile,collections,html
from pathlib import Path
from xml.etree import ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
def compact(s):return re.sub(r'\s+','',s).rstrip('：:')
def heading(text):
    if len(text)>90 or re.search(r'[。；;!?！？]',text):return None
    if re.fullmatch(r'[一二三四五六七八九十百]+[、．.]\s*\D.{0,55}',text):return 1
    m=re.fullmatch(r'(\d+(?:\.\d+){0,4})[.、．]?\s+([^\d].{0,65})',text)
    if m:return m[1].count('.')+1
    m=re.fullmatch(r'(\d+\.\d+(?:\.\d+){0,3})\s*([^\d.].{0,55})',text)
    if m:return m[1].count('.')+1
    return None
def name(text):return compact(re.sub(r'^(?:[一二三四五六七八九十]+[、．.]|\d+(?:\.\d+)*[.、．]?)\s*','',text))
def docx_entries(path):
    with zipfile.ZipFile(path) as z:
        root=ET.fromstring(z.read('word/document.xml'));body=root.find(W+'body');entries=[]
        for index,el in enumerate(body):
            images=len(list(el.iter(A+'blip')))
            if el.tag==W+'tbl':
                rows=[]
                for row in el.findall(W+'tr'):
                    rows.append(' | '.join(''.join(t.text or '' for t in cell.iter(W+'t')).strip() for cell in row.findall(W+'tc')))
                text='\n'.join(rows);kind='table';style=None
            else:
                text=''.join(t.text or '' for t in el.iter(W+'t')).strip();kind='paragraph'
                st=el.find(W+'pPr/'+W+'pStyle');style=st.get(W+'val') if st is not None else None
            entries.append({'text':text,'kind':kind,'style':style,'images':images,'locator':{'element':index}})
    return entries
def pdf_entries(path):
    import pdfplumber
    entries=[]
    with pdfplumber.open(path) as doc:
        page_lines=[p.extract_text_lines() for p in doc.pages]
        repeated=collections.Counter(compact(x['text']) for p,lines in zip(doc.pages,page_lines) for x in lines if x['top']<45 or x['top']>p.height-45)
        for pn,(p,lines) in enumerate(zip(doc.pages,page_lines),1):
            for line in lines:
                t=line['text'].strip();edge=line['top']<45 or line['top']>p.height-45
                if not t:continue
                if edge and (re.fullmatch(r'\d+|https?://\S+',t) or repeated[compact(t)]>=max(3,len(doc.pages)*0.5)):continue
                if '视界不只黑与白' in t or re.fullmatch(r'https?://\S+',t):continue
                entries.append({'text':t,'kind':'paragraph','style':None,'images':0,'locator':{'page':pn,'top':round(line['top'],2),'bottom':round(line['bottom'],2)}})
    return entries
def sections(path):
    path=Path(path);entries=docx_entries(path) if path.suffix.lower()=='.docx' else pdf_entries(path)
    is_pdf=path.suffix.lower()=='.pdf'
    # TOC is used only as an inventory of unnumbered subheadings, never evidence.
    toc={};parent=None;toc_start=next((i for i,e in enumerate(entries) if compact(e['text']) in ('目录','CONTENTS','TableofContents')),None)
    body_start=0
    if toc_start is not None:
        for i,e in enumerate(entries[toc_start+1:],toc_start+1):
            t=e['text']
            if heading(t) and not re.search(r'\d\s*$',t):body_start=i;break
            m=re.fullmatch(r'([一二三四五六七八九十]+[、．.].*?)(\d+)\s*',t)
            if m:parent=name(m[1]);toc.setdefault(parent,set());continue
            m=re.fullmatch(r'(\d+(?:\.\d+)*[.、．]?\s*.+?)(\d+)\s*',t)
            if m and parent:toc[parent].add(name(m[1]))
    out=[];stack=[];body=[];locs=[];images=0
    def flush():
        if body:out.append({'sectionPath':[t for _,t in stack] or ['正文'],'text':'\n'.join(body).strip(),'locators':list(locs),'imageCount':images})
    for e in entries[body_start:]:
        t=e['text'];level=None
        if e['kind']=='paragraph':
            level=heading(t)
            # Specification bullet lists are not chapter headings.
            if is_pdf and level and not re.match(r'^[一二三四五六七八九十百]+[、．.]',t):level=None
            if not level and e['style'] and re.fullmatch(r'(?:Heading|标题)\s*[1-6]',e['style'],re.I):level=int(re.search(r'\d',e['style'])[0])
            if stack and name(t) in toc.get(name(stack[0][1]),set()):level=2 if not re.match(r'^\d+\.\d+',t) else 3
            elif level and stack and re.match(r'^[一二三四五六七八九十]+[、．.]',stack[0][1]) and not re.match(r'^[一二三四五六七八九十]+[、．.]',t):level+=1
        if level:
            flush();body=[];locs=[];images=0
            while stack and stack[-1][0]>=level:stack.pop()
            stack.append((level,t.rstrip('：:')))
        elif t:body.append(t)
        if t or e['images']:locs.append(e['locator'])
        images+=e['images']
    flush()
    # Preserve all source prose; cover sections remain explicit, never discarded
    # merely because a source lacks recognized headings.
    return out,{'entries':len(entries),'sections':len(out),'characters':sum(len(s['text']) for s in out),'images':sum(s['imageCount'] for s in out),'ocr':False,'parser':'docx-xml' if not is_pdf else 'pdf-text-layer'}
