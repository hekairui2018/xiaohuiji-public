"""Match stage1 paragraph semantics: formatting runs must not split words."""
import json,zipfile
from xml.etree import ElementTree as ET
from bonsai import STAGE
from source import save

A='http://schemas.openxmlformats.org/drawingml/2006/main'

def paragraphs(root):
 return [''.join(t.text or '' for t in p.iter('{'+A+'}t')) for p in root.iter('{'+A+'}p')]

def compare_frozen():
 docs=json.loads((STAGE/'source-evidence.json').read_text(encoding='utf8'));differences=[]
 for d in docs:
  if not d['name'].endswith('.pptx'):continue
  with zipfile.ZipFile(d['locations'][0]['path']) as z:
   for u in d['units']:
    root=ET.fromstring(z.read(u['locator']['part']));parts=paragraphs(root);correct='\n'.join(parts)
    if correct!=u['text']:differences.append({'documentId':d['documentId'],'resourceId':d['resourceId'],'resourceVersionId':d['resourceVersionId'],'locator':u['locator'],'frozenEvidenceId':u['evidenceId'],'frozenRunProjection':u['text'],'paragraphProjection':correct,'paragraphs':[{'paragraph':i+1,'text':t} for i,t in enumerate(parts)],'finding':'prototype joined every formatting run with a newline; stage1 engine already joins text runs inside each paragraph correctly','modelRetest':False,'scorePromotion':False})
 save(STAGE/'ppt-projection-defect-and-corrected-candidate.json',differences)
 return differences

if __name__=='__main__':print(json.dumps({'affectedSlides':len(compare_frozen()),'frozenExperimentChanged':False,'blindRetest':False}))
