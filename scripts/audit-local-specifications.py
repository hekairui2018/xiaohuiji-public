"""Read original local specification bytes; no network, writes only an audit artifact."""
import hashlib, json, pathlib, re, sys
sys.stdout.reconfigure(encoding='utf-8')
from pypdf import PdfReader
root = pathlib.Path(__file__).resolve().parents[1]
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'tmp/business-evidence-20261013/local-specifications.json'
if out.exists():
    raise SystemExit('Preserve existing results; choose another output path')
names = ['HD-A3L规格书 V1.1.pdf', 'HD-R712规格书 V3.1.pdf', 'HD-VP620A规格书 v1.2.pdf', 'HD-A3L Specification V1.1.pdf']
results = []
for name in names:
    source = root / 'frontend/official-files' / name
    if not source.exists():
        results.append({'file':name,'status':'missing'})
        continue
    reader = PdfReader(source)
    pages = [{'page':i+1,'text':page.extract_text() or ''} for i,page in enumerate(reader.pages)]
    relevant = [{'page':p['page'],'lines':[line for line in p['text'].splitlines() if re.search(r'带载|最大|千兆|HUB75|像素|655|262|390|4096|8192|3840|4000',line,re.I)]} for p in pages]
    results.append({'file':name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pageCount':len(pages),'pages':pages,'parameterLines':relevant})
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'method':'original PDF text extraction; page locators and byte hashes retained, no layout/OCR inference','documents':results},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'file':r['file'],'sha256':r.get('sha256'),'parameterLines':r.get('parameterLines',[])} for r in results],ensure_ascii=False,indent=2))
