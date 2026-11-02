"""Extract one explicitly selected competitor workbook; never scan legacy sources."""
import argparse, hashlib, importlib.util, json
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source = Path(args.source).resolve()
    spec = importlib.util.spec_from_file_location('expert_extraction', Path(__file__).with_name('build-expert-materials.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sha = module.digest(source)
    records = module.workbook(source)
    for row in records:
        row.update(source=source.name, sourceSha256=sha)
        row['id'] = hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if not records:
        raise ValueError('Workbook contains no extractable comparison cells')
    data = dict(schemaVersion=1, purpose='explicit-competitive-knowledge', records=records,
                sources=[dict(name=source.name, path=str(source), sha256=sha)])
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(dict(sources=1, records=len(records), sheets=len(set(r['sheet'] for r in records)), sha256=sha)))

if __name__ == '__main__':
    main()
