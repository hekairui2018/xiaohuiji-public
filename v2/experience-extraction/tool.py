"""Isolated evidence lookup contract. Does not register a website route."""
import argparse,json
from source import WORK

def lookup(review_id):
 records=json.loads((WORK/'agent-reviewed-records.json').read_text(encoding='utf8'))
 matches=[r for r in records if r['reviewId']==review_id or r['caseId']==review_id]
 if not matches:return {'status':'not-found','records':[]}
 r=matches[0];ids=r['contextEvidenceIds']+r['completeSupportEvidenceIds']
 docs=json.loads((WORK/'source-evidence.json').read_text(encoding='utf8'));units={u['evidenceId']:u for d in docs for u in d['units']}
 return {'status':'candidate-not-executable','record':r,'evidence':[units[i] for i in ids],
  'readMore':{'resourceId':r['resourceId'],'resourceVersionId':r['resourceVersionId'],'evidenceIds':ids},
  'warnings':['literal source is not independent engineering verification','unread images and unknown scope must not be inferred']}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('review_id');args=p.parse_args();print(json.dumps(lookup(args.review_id),ensure_ascii=False,indent=2))
