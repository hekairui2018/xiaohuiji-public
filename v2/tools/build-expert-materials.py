"""Read-only structural extraction. Outputs private JSON, never modifies originals."""
import argparse, hashlib, json, re
from pathlib import Path
import openpyxl
from docx import Document

BRANDS = ['灰度', '诺瓦', '卡莱特', '凯视达', '摩西尔']
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def workbook(p):
    book=openpyxl.load_workbook(p,read_only=True,data_only=True)
    result=[]
    for sheet in book:
        sheet.reset_dimensions() # Some source workbooks falsely declare A1:A1.
        groups=[]; brand=None
        for row in sheet.iter_rows():
            cells=[(c.column,str(c.value).strip(),c.coordinate) for c in row if c.value is not None and str(c.value).strip()]
            if not cells: continue
            first=cells[0][1]
            if len(cells)==1 and first in BRANDS: brand=first; groups=[]; continue
            # Manufacturer columns are structural boundaries even when their
            # brand is not in our convenience vocabulary. Do not mistake a
            # parameter such as "输入子卡型号" for a new product header.
            headers=[x for x in cells if re.fullmatch(r'(?:灰度|诺瓦|卡莱特|凯视达|摩西尔)?型号|类别',x[1]) or re.fullmatch(r'[\u4e00-\u9fffA-Za-z· ]{0,20}产品型号',x[1])]
            if headers:
                groups=[]
                for i,(col,title,coord) in enumerate(headers):
                    end=headers[i+1][0] if i+1<len(headers) else 10000
                    b=re.sub(r'(?:同类)?产品型号$','',title).strip() if title.endswith('产品型号') else next((b for b in BRANDS if b in title),brand)
                    b=b or brand
                    entries=[]
                    for c,value,loc in cells:
                        if not col<c<end: continue
                        explicit=next((b for b in BRANDS if b in value),None)
                        model=value
                        if explicit: model=value.replace(explicit,'').strip()
                        if re.search(r'[A-Za-z].*\d|\d.*[A-Za-z]',model): entries.append((c,explicit or b,model,loc))
                    groups.append((col,end,entries))
                continue
            for start,end,models in groups:
                labels=[(v,loc) for c,v,loc in cells if c==start]
                if not labels or re.search('图片|外观',labels[0][0]):continue
                for c,b,m,header_cell in models:
                    matches=[(v,loc) for col,v,loc in cells if col==c]
                    if not matches:continue
                    value,loc=matches[0]
                    result.append(dict(kind='comparison',brand=b or '未明确',model=m,parameter=labels[0][0],value=value,sheet=sheet.title,cell=loc,modelCell=header_cell,parameterCell=labels[0][1]))
    book.close()
    return result

def controls(p):
    doc=Document(p);out=[];heading=[]
    style_names={s.style_id:s.name for s in doc.styles}
    for i,element in enumerate(doc.element.body):
        if element.tag.endswith('}p'):
            text=''.join(element.xpath('.//w:t/text()')).strip()
            if not text:continue
            styles=element.xpath('./w:pPr/w:pStyle/@w:val')
            style=style_names.get(styles[0],styles[0]) if styles else ''
            if re.search('Heading|标题',style,re.I):
                level_match=re.search(r'(\d+)',style);level=int(level_match[1]) if level_match else 1
                heading=heading[:max(0,level-1)]+[text];continue
            out.append(dict(kind='tender',heading=heading[:],text=text,bodyIndex=i))
        elif element.tag.endswith('}tbl'):
            rows=element.xpath('./w:tr');header=[]
            for ri,row in enumerate(rows):
                values=['\n'.join(c.xpath('.//w:t/text()')).strip() for c in row.xpath('./w:tc')]
                if ri==0:header=values;continue
                if any(values):out.append(dict(kind='tender',heading=heading[:],text='\n'.join(f'{header[k] if k<len(header) else k+1}: {v}' for k,v in enumerate(values)),bodyIndex=i,tableRow=ri+1))
    return out

def main():
    a=argparse.ArgumentParser();a.add_argument('--source',required=True);a.add_argument('--competitor');a.add_argument('--output',required=True);a.add_argument('--exclude-lcd',action='store_true');args=a.parse_args()
    paths=list(Path(args.source).glob('*.docx'))+list(Path(args.source).glob('*.xlsx'))
    if args.exclude_lcd:paths=[p for p in paths if 'lcd' not in p.name.lower()]
    if args.competitor:paths.append(Path(args.competitor))
    records=[];sources=[];errors=[];seen_sources={};seen_names={}
    for p in paths:
        try:
            sha=digest(p)
            if sha in seen_sources:continue
            if p.name in seen_names and seen_names[p.name]!=sha:
                raise ValueError('different source files share the same name')
            rows=workbook(p) if p.suffix.lower()=='.xlsx' else controls(p)
            seen_sources[sha]=str(p);seen_names[p.name]=sha
            for n,r in enumerate(rows):r.update(source=p.name,sourceSha256=sha,id=hashlib.sha256((sha+'|'+str(n)).encode()).hexdigest(),access='internal')
            records.extend(rows);sources.append(dict(name=p.name,path=str(p),sha256=sha,records=len(rows)))
        except Exception as e:errors.append(dict(name=p.name,error=str(e)))
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(dict(schemaVersion=1,records=records,sources=sources,errors=errors),ensure_ascii=False),encoding='utf-8')
    with target.with_suffix('.chunks.jsonl').open('w',encoding='utf-8') as f:
        for r in records:
            if r['kind']=='tender': text='来源：'+r['source']+'\n章节：'+' / '.join(r['heading'])+'\n原文：'+r['text']
            else: text='来源：'+r['source']+'\n品牌：'+r['brand']+'\n型号：'+r['model']+'\n参数：'+r['parameter']+'\n原值：'+r['value']+'\n位置：'+r['sheet']+'!'+r['cell']
            f.write(json.dumps(dict(id=r['id'],content=text,sourceSha256=r['sourceSha256'],kind=r['kind'],access='internal',locator={k:r[k] for k in ['sheet','cell','bodyIndex','tableRow'] if k in r}),ensure_ascii=False)+'\n')
    print(json.dumps(dict(records=len(records),sources=len(sources),errors=errors),ensure_ascii=True))
if __name__=='__main__':main()
