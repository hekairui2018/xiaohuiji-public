import pathlib,json,sys,argparse,hashlib,time
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'v2/resource-index'))
from section_search import Embedder,plain
def build(index,model):
    import sqlite3
    index=pathlib.Path(index);model=pathlib.Path(model);embed=Embedder(model)
    embed.tokenizer.no_truncation();embed.tokenizer.no_padding()
    db=sqlite3.connect(index/'sections.db');db.row_factory=sqlite3.Row
    rows=db.execute('SELECT s.*,f.name,f.models FROM sections s JOIN files f ON s.file_id=f.id ORDER BY s.id').fetchall();db.close()
    texts=[];owners=[]
    for i,r in enumerate(rows):
        head='型号：'+' '.join(json.loads(r['models']))+'\n文档：'+r['name']+'\n章节：'+' → '.join(json.loads(r['heading']))+'\n正文：\n'
        ids=embed.tokenizer.encode(plain(r['text']),add_special_tokens=False).ids;cap=480-len(embed.tokenizer.encode(head).ids)
        if cap<128:raise ValueError('Heading too long for embedding budget')
        for offset in range(0,max(1,len(ids)),cap):
            t=head+embed.tokenizer.decode(ids[offset:offset+cap],skip_special_tokens=True)
            assert len(embed.tokenizer.encode(t).ids)<=512
            texts.append(t);owners.append(i)
    embed.tokenizer.enable_truncation(max_length=512);embed.tokenizer.enable_padding()
    parts=[];started=time.perf_counter()
    for offset in range(0,len(texts),64):
        parts.append(embed.encode(texts[offset:offset+64]));print('EMBED',min(offset+64,len(texts)),len(texts),flush=True)
    vectors=np.concatenate(parts);np.savez_compressed(index/'vectors.npz',vectors=vectors,owners=np.asarray(owners))
    receipt={'model':'bge-small-zh-v1.5','dimension':512,'sections':len(rows),'views':len(texts),'sectionIds':[r['id'] for r in rows],'seconds':time.perf_counter()-started,'modelSHA256':hashlib.sha256((model/'model.onnx').read_bytes()).hexdigest(),'tokenizerSHA256':hashlib.sha256((model/'tokenizer.json').read_bytes()).hexdigest()}
    (index/'vectors.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8');print('DONE',len(rows),len(texts),receipt['seconds'])
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--index',required=True);p.add_argument('--model',required=True);a=p.parse_args();build(a.index,a.model)
