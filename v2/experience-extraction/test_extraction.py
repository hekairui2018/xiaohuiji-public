"""Targeted source and safety regression. No generated answer is its own oracle."""
import json,unittest
from source import WORK
from extract import models,split_fragments
from tool import lookup

def read(name):return json.loads((WORK/name).read_text(encoding='utf8'))

class ExtractionTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.records={r['reviewId']:r for r in read('agent-reviewed-records.json')}
  cls.units={u['evidenceId']:u for d in read('source-evidence.json') for u in d['units']}
 def texts(self,rid,field):return '\n'.join(v['text'] for v in self.records[rid]['fields'].get(field,[]))
 def test_empty_label_carries_role(self):
  self.assertEqual(split_fragments({'text':'排查动作：'}),[('checks',5,5)])
 def test_exact_model_suffix(self):
  self.assertEqual(models('A3L VP620A'),['A3L','VP620A'])
  self.assertEqual(models('A3 VP620'),['A3','VP620'])
 def test_all_literal_spans(self):
  for r in self.records.values():
   for values in r['fields'].values():
    for v in values:
     for e in v['evidence']:self.assertEqual(v['text'],self.units[e['evidenceId']]['text'][e['start']:e['end']])
 def test_source_report_not_solution_promotion(self):
  for r in self.records.values():self.assertEqual(r['publicationStatus'],'candidate-only-reference-not-executable')
  for rid in ['R03','R06','R16','R19']:self.assertEqual(self.records[rid]['resolutionStatus'],'not-explicitly-recorded')
 def test_distinct_versions_preserved(self):
  self.assertIn('4.0.8.0',self.texts('R18','actions'));self.assertNotIn('4.0.30.0',self.texts('R18','actions'))
  self.assertIn('4.0.30.0',self.texts('R23','actions'));self.assertIn('V25.23.65.xx',self.texts('R23','actions'))
 def test_not_one_pwm_threshold(self):
  self.assertIn('三百',self.texts('R02','actions'));self.assertIn('1k',self.texts('R03','actions'))
  g=next(g for g in read('agent-organized-combined-experiences.json') if g['experienceId']=='G01');self.assertIsNone(g['uniqueRemedy'])
 def test_opposite_fullscreen_not_merged(self):
  self.assertIn('关闭',self.texts('R05','actions'));self.assertIn('打开',self.texts('R06','actions'))
  self.assertIn(['R05','R06'],read('reviewed-duplicate-and-scope-links.json')['noMergePairs'])
 def test_unknown_image_action_not_completed(self):
  self.assertEqual(self.records['R07']['quality']['outcome'],'information-insufficient')
  self.assertTrue(self.records['R07']['imageIds']);self.assertIn('需要设置成',self.texts('R07','actions'))
 def test_firmware_identity_conflict_held(self):
  self.assertIn('VP630',self.texts('R20','phenomenon'));self.assertIn('VP830',self.texts('R20','artifactReferences'))
  self.assertEqual(self.records['R20']['quality']['outcome'],'manual-review')
 def test_cause_is_tentative(self):
  self.assertIn('怀疑',self.texts('R08','causes'));self.assertIn('应该',self.texts('R19','causes'))
  for rid in ['R08','R19']:self.assertEqual(self.records[rid]['fields']['causes'][0]['assertionType'],'source-reported-hypothesis')
 def test_tool_returns_complete_chain(self):
  answer=lookup('R12');self.assertEqual(answer['status'],'candidate-not-executable')
  self.assertEqual(len(answer['evidence']),23);self.assertIn('1464','\n'.join(u['text'] for u in answer['evidence']))
  self.assertEqual(lookup('NOT-A-CASE')['status'],'not-found')
 def test_quality_keeps_failures(self):
  m=read('quality-metrics.json');self.assertFalse(m['readyForUnsupervisedBulkExtraction']);self.assertEqual(m['readbackErrors'],0)
  self.assertGreater(m['automaticFieldComparison']['missing-or-role-not-separated'],0)
  self.assertEqual(m['automaticBoundaryComparison']['overmerged-next-source-fault'],1)
 def test_combined_evidence_has_multiple_cases(self):
  for g in read('agent-organized-combined-experiences.json'):
   self.assertGreaterEqual(len(set(g['supportingCaseIds'])),2);self.assertFalse(g['inferredDecisionRules'])

if __name__=='__main__':unittest.main()
