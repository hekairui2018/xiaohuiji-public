"""Build an explicit quick-mode corpus. Originals are read only; no directory crawl."""
import argparse, csv, hashlib, importlib.util, io, json, re, sqlite3
from pathlib import Path
import openpyxl
from openpyxl.utils import get_column_letter


def text(value):
    return '' if value is None else str(value).strip()


def terms(value):
    value = text(value).lower()
    words = re.findall(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', value)
    for segment in re.findall(r'[\u3400-\u9fff]+', value):
        words.extend(segment[i:i+2] for i in range(len(segment)-1))
    return ' '.join(words)


def models(value):
    return sorted(set(m.upper().removeprefix('HD-') for m in re.findall(
        r'(?<![A-Za-z0-9])(?:HD-)?[A-Za-z]+\d+[A-Za-z0-9]*(?:-(?:TP|PRO|PLUS|\d+U))?', text(value))
        if not re.match(r'^(?:V|FPGA|WIN|WINDOWS)\d', m, re.I)))


def sheet_rows(sheet):
    # Some source workbooks declare A1 dimensions despite containing full tables.
    sheet.reset_dimensions()
    return [(n, row) for n, row in enumerate(sheet.values, 1) if any(v is not None for v in row)]


def build(source_dir, product, output):
    if output.exists():
        # Reuse accepted artifacts. A source change needs an explicit new version.
        previous=json.loads((output/'manifest.json').read_text(encoding='utf-8'))
        cached=json.loads((output/'products.json').read_text(encoding='utf-8'))
        db=sqlite3.connect((output/'knowledge.sqlite').resolve().as_uri()+'?mode=ro',uri=True)
        try:refs=list(db.execute('SELECT path,sha256 FROM sources'))
        finally:db.close()
        refs.append((str(product),cached['sources'][0]['sha256']))
        for file,sha in refs:
            if hashlib.sha256(Path(file).read_bytes()).hexdigest()!=sha:
                raise ValueError('Source changed; select a new corpus version: '+Path(file).name)
        return {**previous,'artifactReuse':True,'reparsedSources':0}
    output.mkdir(parents=True)
    db = sqlite3.connect(output/'knowledge.sqlite')
    db.executescript('''
        CREATE TABLE sources(id INTEGER PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,sha256 TEXT NOT NULL,kind TEXT NOT NULL);
        CREATE TABLE records(id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL,kind TEXT NOT NULL,models TEXT NOT NULL,
          parameter TEXT NOT NULL,value TEXT NOT NULL,conditions TEXT NOT NULL,sheet TEXT NOT NULL,cell TEXT NOT NULL,
          status TEXT NOT NULL,question TEXT NOT NULL DEFAULT '',keywords TEXT NOT NULL DEFAULT '');
        CREATE INDEX record_kind ON records(kind,status);
        CREATE VIRTUAL TABLE record_search USING fts5(parameter,conditions,value,keywords);
        CREATE TABLE raw_rows(source_id INTEGER,sheet TEXT,row_number INTEGER,payload TEXT);
    ''')
    counts, issues = {}, []

    def source(file, kind):
        sha = hashlib.sha256(file.read_bytes()).hexdigest()
        return db.execute('INSERT INTO sources(name,path,sha256,kind) VALUES(?,?,?,?)',
                          (file.name, str(file.resolve()), sha, kind)).lastrowid

    def add(sid, kind, device, parameter, value, conditions, sheet, cell, status='ready', question='', keywords=''):
        value = text(value)
        if not value and status == 'ready':
            status = 'unrecorded'
        rowid = db.execute('INSERT INTO records(source_id,kind,models,parameter,value,conditions,sheet,cell,status,question,keywords) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                           (sid, kind, json.dumps(device), text(parameter), value, text(conditions), sheet, cell, status, question, keywords)).lastrowid
        if status == 'ready':
            db.execute('INSERT INTO record_search(rowid,parameter,conditions,value,keywords) VALUES(?,?,?,?,?)',
                       (rowid, terms(parameter), terms(conditions), terms(value), terms(keywords)))
        counts[kind] = counts.get(kind, 0)+1

    # One explicitly selected workbook, with all source-cell provenance preserved.
    spec = importlib.util.spec_from_file_location('extract_product', Path(__file__).with_name('build-expert-materials.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    primary = module.workbook(product)
    sha = module.digest(product)
    for row in primary:
        row.update(source=product.name, sourceSha256=sha)
        row['id'] = hashlib.sha256(json.dumps(row, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    (output/'products.json').write_text(json.dumps(dict(schemaVersion=1,purpose='explicit-product-knowledge',records=primary,
        sources=[dict(name=product.name,path=str(product.resolve()),sha256=sha)]), ensure_ascii=False), encoding='utf-8')

    names = ['全彩产品特性表.xlsx', '处理器功能支持表 .xlsx', '视频处理器产品特性表_v2.0.xlsx',
             'VP8000M产品特性表_V1.3.xlsx', '全彩产品4G模块支持列表.xlsx', '接收卡固件版本支持信息.xlsx']
    for name in names:
        file = source_dir/name; sid = source(file, 'parameter')
        workbook = openpyxl.load_workbook(file, read_only=True, data_only=True)
        for sheet in workbook:
            rows = sheet_rows(sheet)
            for n, row in rows:
                db.execute('INSERT INTO raw_rows VALUES(?,?,?,?)', (sid,sheet.title,n,json.dumps(row,ensure_ascii=False,default=str)))
            def put(n, col, device, param, value, conditions=''):
                add(sid,'parameter',device,param,value,conditions,sheet.title,get_column_letter(col)+str(n))
            if name.startswith('全彩产品特性') or name.startswith('处理器功能'):
                header = rows[0][1]
                model_col = 1 if sheet.title == '全彩配件产品' else 0
                for n, row in rows[1:]:
                    if len(row)<=model_col or not row[model_col]: continue
                    device = models(row[model_col])
                    if not device: continue
                    for col, (label, value) in enumerate(zip(header,row),1):
                        if col-1 == model_col or not label: continue
                        put(n,col,device,text(label),value,'型号原文：'+text(row[model_col]))
            elif name.startswith('视频处理器产品特性'):
                header = next(row for _,row in rows if len(row)>4 and row[0]=='编号')
                for n,row in rows:
                    if n<=3 or len(row)<4 or not row[2]: continue
                    condition='；'.join(text(x) for x in [row[1],row[3],'表内 / 表示未做修改，不能解释为不支持'] if x)
                    for col in range(4,min(len(header),len(row))):
                        if header[col]:put(n,col+1,models(header[col]),text(row[2]),row[col],condition+'；型号原文：'+text(header[col]))
            elif name.startswith('全彩产品4G'):
                if sheet.title=='4G模块地区选型':
                    module_name=''
                    for n,row in rows[1:]:
                        if row[0]:module_name=text(row[0])
                        if len(row)>1 and row[1]:put(n,2,[],module_name+'适用地区',row[1],'模块型号：'+module_name)
                else:
                    header=next(row for n,row in rows if n==2)
                    for n,row in rows:
                        if n<=2 or not row[0]:continue
                        note=text(row[-1]) if len(row)==len(header) else ''
                        for col in range(1,min(len(header)-1,len(row))):
                            put(n,col+1,models(header[col]),'4G模块支持 '+text(row[0]),row[col],text(header[col])+'；'+note)
            elif name.startswith('接收卡固件'):
                if sheet.title!='固件版本支持信息':
                    if len(rows)<=2:issues.append(dict(source=name,sheet=sheet.title,reason='仅表头或空白，不能据此生成支持关系'))
                    continue
                versions=next(row for n,row in rows if n==2)
                group=''
                for n,row in rows:
                    if n<=2:continue
                    if row[0]:group=text(row[0])
                    param=group+(' / '+text(row[2]) if len(row)>2 and row[2] else '')
                    for col in range(4,min(len(row),len(versions))):
                        version=text(versions[col]);put(n,col+1,[],param,row[col],'固件示例：'+version+'；不同示例不可只按主版本合并')
            elif name.startswith('VP8000M'):
                if sheet.title=='软件':
                    group=''
                    for n,row in rows:
                        if n<=3:continue
                        if row[0]:group=text(row[0])
                        for col,label in [(2,'PC端'),(3,'Web端')]:
                            if len(row)>col:put(n,col+1,['VP8000M'],group+' '+label,row[col],text(row[1])+'；备注：'+text(row[4] if len(row)>4 else ''))
                else:
                    # Preserve complete conditional rows; do not turn version columns into unconditional facts.
                    start=5 if sheet.title=='硬件' else 3 if sheet.title=='软件迭代版本改动说明' else 2
                    group=''
                    for n,row in rows:
                        if n<start:continue
                        if len(row)>1 and row[1]:group=text(row[1])
                        populated=[get_column_letter(i+1)+'：'+text(v) for i,v in enumerate(row) if v is not None]
                        label=' '.join(text(v) for v in row[:4] if v is not None)
                        device=['VP8000M']
                        if sheet.title=='硬件' and len(row)>2 and row[2] and re.match(r'\d+U-',text(row[2])):
                            device.append('VP8000M-'+text(row[2]).split('-')[0])
                        put(n,1,device,label,'；'.join(populated),'工作表：'+sheet.title+'；'+group+'；各列为不同条件，必须保留原文')
        workbook.close()

    for file in sorted(source_dir.glob('*.csv')):
        if not re.search('FAQ|FQA|常见问题',file.name,re.I):continue
        sid=source(file,'faq'); content=file.read_bytes()
        try:content=content.decode('utf-8-sig')
        except UnicodeError:content=content.decode('gb18030')
        for n,row in enumerate(csv.DictReader(io.StringIO(content)),2):
            if not any(text(v) for v in row.values()):continue
            q=text(row.get('问题描述'));a=text(row.get('解决方案'));k=text(row.get('关键词'))
            db.execute('INSERT INTO raw_rows VALUES(?,?,?,?)',(sid,'CSV',n,json.dumps(row,ensure_ascii=False)))
            add(sid,'faq',models(q+' '+k),q,a,'适用范围需核对问题及完整解答','CSV',str(n),
                'ready' if q and a else 'incomplete',question=q,keywords=k)

    pdf=source_dir/'P1.86 P3.076模组空点位置查询表 V2.5.pdf';sid=source(pdf,'empty-points')
    import pdfplumber
    with pdfplumber.open(pdf) as document:
        for page_no,page in enumerate(document.pages,1):
            for table_no,table in enumerate(page.extract_tables(),1):
                scope=''
                for row_no,row in enumerate(table,1):
                    if row[0] and '模组型号' not in row[0]:scope=text(row[0])
                    if scope and len(row)>1 and row[1]:add(sid,'empty-points',[],scope+' 空点位置',row[1],
                        '同一模组和扫描数存在多组位置，不能仅凭P值和扫描数唯一选定','第'+str(page_no)+'页',str(table_no)+'-'+str(row_no))
    # An original containing only a title is not a usable product directory.
    issues.append(dict(source='LED产品目录.docx',reason='当前副本仅标题，没有可用目录正文，未生成导航记录'))
    db.commit()
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    report=dict(primaryRecords=len(primary),counts=counts,sources=db.execute('SELECT count(*) FROM sources').fetchone()[0],
                statuses=dict(db.execute('SELECT status,count(*) FROM records GROUP BY status')),issues=issues,
                excluded=['经验分享文档','友商产品对比表.xlsx','LCD产品信息统计表_V2.0.0.xlsx','灰度产品控标表.xlsx'])
    (output/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');db.close()
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sources',required=True);parser.add_argument('--product',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();print(json.dumps(build(Path(args.sources),Path(args.product),Path(args.output)),ensure_ascii=False))
