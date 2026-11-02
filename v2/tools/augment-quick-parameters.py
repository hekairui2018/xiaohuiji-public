"""Add a newly selected technical workbook without reparsing an existing corpus."""
import argparse, hashlib, importlib.util, json, re, shutil, sqlite3
from pathlib import Path
import openpyxl
from openpyxl.utils import get_column_letter

spec=importlib.util.spec_from_file_location('quick_builder',Path(__file__).with_name('build-quick-knowledge.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


def augment(base,output,file):
    if output.exists():raise ValueError('Choose a new corpus version')
    output.mkdir(parents=True)
    for name in ['knowledge.sqlite','products.json','manifest.json']:shutil.copy2(base/name,output/name)
    db=sqlite3.connect(output/'knowledge.sqlite')
    sha=hashlib.sha256(file.read_bytes()).hexdigest()
    sid=db.execute('INSERT INTO sources(name,path,sha256,kind) VALUES(?,?,?,?)',(file.name,str(file.resolve()),sha,'parameter')).lastrowid
    workbook=openpyxl.load_workbook(file,read_only=True,data_only=True);count=0;omitted=[]
    technical={'产品差异表','产品配置','遥控支持列表','4G模块支持列表','主板基本信息（DDR、WiFi、JAR等）','Linux系统支持','4G模块地区支持','耳机支持情况','尺寸规格（SIM、TF、SD卡）'}
    def add(sheet,n,col,device,label,value,conditions):
        nonlocal count
        value=builder.text(value);status='ready' if value else 'unrecorded'
        rowid=db.execute('INSERT INTO records(source_id,kind,models,parameter,value,conditions,sheet,cell,status) VALUES(?,?,?,?,?,?,?,?,?)',
            (sid,'parameter',json.dumps(device),label,value,conditions,sheet,get_column_letter(col)+str(n),status)).lastrowid
        if status=='ready':db.execute('INSERT INTO record_search(rowid,parameter,conditions,value,keywords) VALUES(?,?,?,?,?)',
            (rowid,builder.terms(label),builder.terms(conditions),builder.terms(value),''))
        count+=1
    for sheet in workbook:
        if sheet.title not in technical:
            omitted.append(sheet.title);continue
        rows=builder.sheet_rows(sheet)
        for n,row in rows:db.execute('INSERT INTO raw_rows VALUES(?,?,?,?)',(sid,sheet.title,n,json.dumps(row,ensure_ascii=False,default=str)))
        if sheet.title=='产品差异表':
            header=rows[0][1];hardware=rows[1][1];group=''
            for n,row in rows[1:]:
                if row[0]:group=builder.text(row[0])
                if len(row)<2 or not row[1]:continue
                for col in range(2,min(len(row),len(header))):
                    if not header[col]:continue
                    conditions='类别：'+group+'；表头所列硬件：'+builder.text(hardware[col])+'；空白不代表不支持'
                    add(sheet.title,n,col+1,[builder.text(header[col]).upper()],builder.text(row[1]),row[col],conditions)
            continue
        header_n=3 if sheet.title=='产品配置' else 1
        header=next(row for n,row in rows if n==header_n)
        model_col=next((i for i,x in enumerate(header) if builder.text(x) in ['型号','主板型号','设备型号','主板']),None)
        current=''
        for n,row in rows:
            if n<=header_n:continue
            if model_col is not None and len(row)>model_col and row[model_col]:current=builder.text(row[model_col]).upper()
            if model_col is not None and not current:continue
            device=[current] if current else []
            conditions='；'.join(builder.text(h)+'：'+builder.text(v) for h,v in zip(header,row) if h and v is not None and re.search('系统|版本|备注|配置|待核对',builder.text(h)))
            for col,(label,value) in enumerate(zip(header,row),1):
                if not label or col-1==model_col or label in ['序号','料号']:continue
                parameter=builder.text(label)
                if not device:parameter=builder.text(row[1] if len(row)>1 else '')+' '+parameter
                add(sheet.title,n,col,device,parameter,value,conditions)
    workbook.close();db.commit();assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    report=json.loads((output/'manifest.json').read_text(encoding='utf-8'))
    report['counts']['parameter']+=count;report['sources']+=1
    report['statuses']=dict(db.execute('SELECT status,count(*) FROM records GROUP BY status'))
    report['excluded']=[x for x in report['excluded'] if x!=file.name]
    report['technicalWorkbookAddition']={'source':file.name,'addedRecords':count,'omittedNonTechnicalSheets':omitted,'existingArtifactsReused':True}
    (output/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');db.close();return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--base',required=True);p.add_argument('--output',required=True);p.add_argument('--workbook',required=True)
    a=p.parse_args();print(json.dumps(augment(Path(a.base),Path(a.output),Path(a.workbook)),ensure_ascii=False))
