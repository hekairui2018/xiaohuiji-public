import unittest,json
from case_context import boundaries,envelope
from common import load
from tools import Tools

class CaseContextTests(unittest.TestCase):
 def test_continuous_attempts_and_next_case(self):
  rows=[{'text':x} for x in ['2.1 R123黑屏','模组信息：P2','故障现象：黑屏','1、检查接线','2、升级无效','3、读取正常卡参数','发送后显示正常','问题：R123偏色','处理：校色']]
  spans=boundaries(rows);self.assertEqual([(s,e) for s,e,_ in spans],[(0,6),(7,8)])
 def test_identical_phenomenon_not_same_record(self):
  rows=[{'text':x} for x in ['故障现象：闪屏','处理：升频无效，降频正常','故障现象：闪屏','处理：改接线']]
  self.assertEqual([(s,e) for s,e,_ in boundaries(rows)],[(0,1),(2,3)])
 def test_csv_never_merged(self):self.assertEqual(len(boundaries([{'text':'a'},{'text':'b'}],True)),2)
 def test_numeric_prefix_model_heading(self):
  rows=[{'text':x} for x in ['3566S','现象：闪屏','处理：调参数','3568S','现象：竖纹','处理：调时钟']]
  self.assertEqual([(s,e) for s,e,_ in boundaries(rows)],[(0,2),(3,5)])
 def test_unlabelled_action_cannot_bypass_exact_model(self):
  import evidence_experiment,common
  old=common.WORK
  try:
   evidence_experiment.configure(common.ROOT/'tmp/client-evidence-stage5-20261016');t=Tools();r=t.search('3566S 屏幕闪烁 PWM 频率 处理','text',model='3566S',limit=3)
   self.assertNotIn('blk-358eb19b48dab31c-33',[x.get('evidenceId') for x in r['results']])
  finally:evidence_experiment.configure(old)
 def test_unrecorded_outcome_not_invented(self):
  b={'text':'处理：设置到7x即可','evidenceId':'sample'};e=envelope([b]);self.assertFalse(e['roleHints']['recordedOutcome']);self.assertEqual(b['text'],'处理：设置到7x即可')
 def test_failed_attempt_is_not_verified_treatment(self):
  e=envelope([{'text':'升级无效，怀疑接口问题','evidenceId':'a'}]);self.assertEqual(e['roleHints']['failedAttempts'],['a']);self.assertEqual(e['roleHints']['causeJudgment'],['a']);self.assertIn('not confirmed',e['roleHintStatus'])
 def test_real_frozen_continuations(self):
  # Fixed regression windows, never used as runtime boundaries/answers.
  import evidence_experiment,common
  old=common.WORK
  try:
   evidence_experiment.configure(common.ROOT/'tmp/client-evidence-stage5-20261016');t=Tools()
   for cid,count in [('S05',10),('S07',5),('S08',15)]:
    c=next(x for x in load('cases.json') if x['id']==cid);b=c['evidence'][1];r=t.read(b['resourceId'],b['versionId'],b['blockId']);self.assertEqual(r['recordBlockCount'],count);self.assertTrue(r['completeRecordDelivered'])
  finally:evidence_experiment.configure(old)
 def test_version_authorization_unchanged(self):
  from tools import ToolError
  with self.assertRaises(ToolError):Tools().read('res-false','ver-false')
 def test_delivery_preserves_text_and_source_version(self):
  from evidence_delivery import model_view
  b={'evidenceId':'unit','text':'检查无效；版本V2；降到1k即可','resourceId':'r','versionId':'v','locator':{'paragraph':4}}
  seen=set();a=model_view({'blocks':[b]},seen);self.assertEqual(a['data']['blocks'][0]['text'],b['text']);self.assertEqual(a['sources'][0]['versionId'],'v')
  self.assertTrue(model_view({'blocks':[b]},seen)['data']['blocks'][0]['textAlreadyDelivered']);self.assertIn('text',b)
 def test_read_document_offset_remains_block_local(self):
  import evidence_experiment,common
  old=common.WORK
  try:
   evidence_experiment.configure(common.ROOT/'tmp/client-evidence-stage5-20261016');t=Tools();c=next(x for x in load('cases.json') if x['id']=='S08');b=c['evidence'][5]
   r=t.read(b['resourceId'],b['versionId'],b['blockId'],offset=2)
   self.assertEqual(r['blocks'][0]['blockId'],b['blockId']);self.assertEqual(r['blocks'][0]['offset'],2)
  finally:evidence_experiment.configure(old)

if __name__=='__main__':unittest.main()
