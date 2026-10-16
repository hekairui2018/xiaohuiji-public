"""Synthetic, data-free public checks; not company business-accuracy tests."""
import unittest
from case_context import boundaries,envelope
from evidence_delivery import model_view
from conversation import citation_check

class PublicSourceTests(unittest.TestCase):
 def test_continuous_record_and_next_fault(self):
  rows=[{'text':t} for t in ['2.1 X123故障','现场信息：测试环境','故障现象：异常','检查：动作甲','尝试：动作乙无效','最终处理：动作丙后显示正常','问题：另一故障','处理：另一动作']]
  self.assertEqual([(s,e) for s,e,_ in boundaries(rows)],[(0,5),(6,7)])
 def test_same_phenomenon_different_records(self):
  rows=[{'text':t} for t in ['现象：异常','处理：动作甲','现象：异常','处理：动作乙']]
  self.assertEqual([(s,e) for s,e,_ in boundaries(rows)],[(0,1),(2,3)])
 def test_numeric_model_heading(self):
  rows=[{'text':t} for t in ['1234X','现象：异常','处理：测试','1234XL','现象：异常']]
  self.assertEqual([(s,e) for s,e,_ in boundaries(rows)],[(0,2),(3,4)])
 def test_csv_records_remain_separate(self):
  self.assertEqual(len(boundaries([{'text':'a'},{'text':'a'}],csv=True)),2)
 def test_unrecorded_result_not_generated(self):
  e=envelope([{'evidenceId':'synthetic-a','text':'处理：设置到7x即可'}])
  self.assertFalse(e['roleHints']['recordedOutcome']);self.assertIn('recordedOutcome',e['missingRoleLabels'])
 def test_delivery_preserves_exact_text_and_version(self):
  b={'evidenceId':'synthetic-a','resourceId':'sample-resource','versionId':'sample-v1','sourceName':'sample.txt','text':'检查无效；条件甲；参数7x','locator':{'paragraph':1}}
  r=model_view({'blocks':[b]});self.assertEqual(r['data']['blocks'][0]['text'],b['text']);self.assertEqual(r['sources'][0]['versionId'],'sample-v1')
 def test_same_filename_versions_not_merged(self):
  blocks=[{'evidenceId':str(i),'resourceId':'r','versionId':str(i),'sourceName':'sample.txt','text':'same sample'} for i in range(2)]
  r=model_view({'blocks':blocks});self.assertEqual(len(r['sources']),2);self.assertNotEqual(r['data']['blocks'][0]['sourceIndex'],r['data']['blocks'][1]['sourceIndex'])
 def test_dedup_does_not_discard_changed_content(self):
  seen=set();b={'evidenceId':'synthetic-a','text':'first'}
  model_view({'blocks':[b]},seen);self.assertTrue(model_view({'blocks':[b]},seen)['data']['blocks'][0]['textAlreadyDelivered'])
  self.assertEqual(model_view({'blocks':[b|{'text':'second'}]},seen)['data']['blocks'][0]['text'],'second')
 def test_unknown_citation_is_rejected(self):
  eid='blk-0000000000000000-1'
  self.assertEqual(citation_check('['+eid+']',{eid})[1],[]);self.assertEqual(citation_check('['+eid+']',set())[1],[eid])

if __name__=='__main__':unittest.main()
