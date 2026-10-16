import json,unittest
from unittest.mock import patch
from common import ROOT,sha
from evidence_experiment import WORK
from conversation import citation_check

class EvidenceTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.cases=json.loads((WORK/'cases.json').read_text(encoding='utf8'));cls.frozen=json.loads((WORK/'frozen-experiment.json').read_text(encoding='utf8'))
 def test_inputs_and_criteria_unchanged(self):
  for n,digest in self.frozen['files'].items():self.assertEqual(sha(WORK/n),digest)
 def test_splits_and_source_separation(self):
  for a in self.cases:
   for b in self.cases:
    if a['split']!=b['split']:self.assertFalse({x['evidenceId'] for x in a['evidence']} & {x['evidenceId'] for x in b['evidence']})
    if a['split']=='heldout' and b['split']!='heldout':self.assertFalse({x['versionId'] for x in a['evidence']} & {x['versionId'] for x in b['evidence']})
 def test_previous_forty_not_replaced(self):
  for n,digest in self.frozen['prior40SHA256'].items():self.assertEqual(sha(ROOT/'tmp/tool-trial-stage4-20261016/results'/n),digest)
 def test_b_model_received_only_question_original_evidence_and_shared_prompt(self):
  paths=list((WORK/'calls').glob('p5-B-*.json'));self.assertTrue(paths)
  for p in paths:
   r=json.loads(p.read_text(encoding='utf8'));m=r['request']['messages'];bundle=json.loads(m[-1]['content'].split('\n',1)[1]);c=next(c for c in self.cases if c['question']==m[-2]['content'])
   self.assertEqual(bundle['blocks'],c['evidence']);self.assertNotIn('criteria',bundle);self.assertNotIn('baselinePhase4',bundle);self.assertNotIn('tools',r['request']);self.assertEqual(m[0]['content'],self.frozen['systemPrompt']+'\n'+self.frozen['toolInstructions'])
 def test_generation_parameters_match_both_arms(self):
  paths=list((WORK/'calls').glob('p5-[AB]-*.json'));self.assertTrue(paths)
  for p in paths:
   req=json.loads(p.read_text(encoding='utf8'))['request'];self.assertEqual((req['model'],req['temperature'],req['seed'],req['max_tokens']),('bonsai',0,42,640));self.assertFalse(req['chat_template_kwargs']['enable_thinking'])
 def test_unknown_unclosed_case_reference_is_rejected(self):
  self.assertTrue(citation_check('[evidenceId: source-case:100000000000000000000000000000000000000000',{})[1])
  self.assertFalse(citation_check('[evidenceId: blk-358eb19b48dab31c-15]',{'blk-358eb19b48dab31c-15':True})[1])
 def test_runtime_location_identity_is_content_version_strict(self):
  from tools import Tools
  with patch('common.WORK',WORK):
   for key,r in Tools().policy.items():self.assertTrue(all(not x.get('sha256') or x['sha256']==key for x in r['locations']))
 def test_full_evidence_cache_cannot_cross_customers(self):
  from evidence_experiment import complete_chat
  with patch('common.WORK',WORK):
   c=next(c for c in self.cases if c['id']=='S01')
   with self.assertRaisesRegex(ValueError,'run-id-conflict'):complete_chat('S01',c['question'],'different-client','p5-B-S01')

if __name__=='__main__':unittest.main()
