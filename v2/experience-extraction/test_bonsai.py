"""Protocol/evidence gates; tests do not certify engineering extraction quality."""
import json,unittest
from bonsai import STAGE,BASE
from evaluate_bonsai import normalize,parse_response,coverage,load,matched_cases
from source import sha
from ppt_projection import paragraphs
from xml.etree import ElementTree as ET

class EvidenceTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.docs=load('source-evidence.json');cls.w=load('frozen-inputs.json')[0];cls.d=next(d for d in cls.docs if d['documentId']==cls.w['documentId'])
 def receipt(self,facts):
  return {'callId':'fixture','response':{'choices':[{'message':{'content':json.dumps({'cases':[{'title':'x','span':[25,27],'facts':facts,'missing':[]}]},ensure_ascii=False)}}]}}
 def test_localhost_identity(self):
  self.assertEqual(BASE,'http://127.0.0.1:8080');m=load('model-identity.json');self.assertEqual(m['models']['data'][0]['id'],'bonsai');self.assertEqual(m['props']['total_slots'],1)
 def test_frozen_inputs_unchanged(self):
  for f,s in load('frozen-manifest.json')['files'].items():self.assertEqual(sha(STAGE/f),s)
 def test_nonexistent_source_rejected(self):
  cs,es,_=normalize(self.receipt([['actions',90000,'invented','source']]),self.w,self.d);self.assertEqual(es[0]['type'],'evidence-not-in-input');self.assertFalse(cs[0]['fields'])
 def test_invented_quote_rejected(self):
  cs,es,_=normalize(self.receipt([['actions',27,'换一个未记载的芯片','source']]),self.w,self.d);self.assertEqual(es[0]['type'],'quote-not-in-original');self.assertFalse(cs[0]['fields'])
 def test_nonliteral_paraphrase_rejected(self):
  cs,es,_=normalize(self.receipt([['actions',27,'降低PWM频率即可正常','source']]),self.w,self.d);self.assertTrue(es)
 def test_canonical_evidence_recovered(self):
  q='这个屏升高频率后闪的更加严重';cs,es,_=normalize(self.receipt([['failedAttempts',27,q,'source']]),self.w,self.d)
  self.assertFalse(es);v=cs[0]['fields']['failedAttempts'][0];self.assertEqual(v['evidence'][0]['evidenceId'],self.d['units'][27]['evidenceId']);self.assertEqual(v['text'],q)
 def test_fence_unwrap_only(self):
  r=self.receipt([]);r['response']['choices'][0]['message']['content']='```json\n'+r['response']['choices'][0]['message']['content']+'\n```'
  p,mode=parse_response(r);self.assertEqual(mode,'outer-json-fence-only');self.assertEqual(p['cases'][0]['facts'],[])
 def test_no_json_repair(self):
  r=self.receipt([]);r['response']['choices'][0]['message']['content']='{"cases":[';self.assertIsNone(parse_response(r)[0])
 def test_overlap_not_double_counted(self):
  vs=[{'evidence':[{'evidenceId':'e','start':0,'end':4}]},{'evidence':[{'evidenceId':'e','start':2,'end':6}]}];self.assertEqual(coverage(vs,{'evidenceId':'e','start':0,'end':6}),6)
 def test_negated_source_not_positive_quote(self):
  d={**self.d,'units':[dict(u) for u in self.d['units']]};d['units'][27]['text']='未能正常显示'
  cs,es,_=normalize(self.receipt([['outcome',27,'正常显示','source']]),self.w,d);self.assertEqual(es[0]['type'],'truncated-source-negation');self.assertFalse(cs[0]['fields'])
 def test_blind_count_and_separate_sources(self):
  blind=load('frozen-blind-gold.json');self.assertEqual(len(blind),12);self.assertTrue(all(r['documentId'].startswith('H') for r in blind));self.assertGreaterEqual(len({r['documentId'] for r in blind}),6)
 def test_ppt_formatting_run_is_not_line_break(self):
  root=ET.fromstring('<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>U</a:t></a:r><a:r><a:t>盘</a:t></a:r></a:p>');self.assertEqual(paragraphs(root),['U盘'])
 def test_same_slide_alignment_uses_source_not_first_case(self):
  target={'documentId':'H6','sourceRange':{'startOrdinal':0,'endOrdinalExclusive':1},'fields':{'warnings':[{'evidence':[{'evidenceId':'e','start':10,'end':20}]}]}}
  a={'caseId':'wrong','documentId':'H6','span':[0,0],'fields':{'actions':[{'evidence':[{'evidenceId':'e','start':0,'end':5}]}]}}
  b={'caseId':'right','documentId':'H6','span':[0,0],'fields':{'sourceClaim':[{'evidence':[{'evidenceId':'e','start':10,'end':20}]}]}}
  self.assertEqual(matched_cases(target,[a,b],{})[0]['caseId'],'right')

if __name__=='__main__':unittest.main()
