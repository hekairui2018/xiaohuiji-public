"""Embed existing prepared fragments with the existing local ONNX model. No reparsing."""
import argparse, hashlib, json, sqlite3, sys
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('--directory',required=True);p.add_argument('--section-config',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    config=json.loads(Path(a.section_config).read_text(encoding='utf-8-sig'))
    sys.path.insert(0,config['dependencies']);sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'resource-index'))
    from section_search import Embedder
    import numpy as np
    output=Path(a.output);output.mkdir(parents=True,exist_ok=False)
    embed=Embedder(config['model']);model=Path(config['model'])/'model.onnx'
    manifest={'modelSha256':hashlib.sha256(model.read_bytes()).hexdigest(),'families':{}}
    for family in ('aftersales','tender'):
        source=Path(a.directory)/(family+'.private.sqlite');db=sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True)
        rows=db.execute("SELECT f.id,f.entry_id,f.text FROM search_fragments f JOIN entries e ON e.id=f.entry_id WHERE e.kind!='context' ORDER BY f.id").fetchall();db.close()
        vectors=[]
        for start in range(0,len(rows),32):
            vectors.append(embed.encode([r[2] for r in rows[start:start+32]]));print(json.dumps({'family':family,'done':min(start+32,len(rows)),'total':len(rows)}),flush=True)
        matrix=np.concatenate(vectors).astype('<f4');binary=output/(family+'.f32');matrix.tofile(binary)
        manifest['families'][family]={'databaseSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'vectorSha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'dimensions':matrix.shape[1],'entries':[r[1] for r in rows],'fragments':[r[0] for r in rows]}
    (output/'manifest.private.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')

if __name__=='__main__':main()
