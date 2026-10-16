"""Synthetic interaction tests, never evidence of Bonsai answer quality."""
import concurrent.futures,json,tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
import conversation
from common import ROOT


class FakeTools:
 def execute(self,name,args):
  return {'results':[{'sourceName':'synthetic-source.txt','evidenceId':'blk-0000000000000000-1','text':'合成测试原文'}]}


class SimpleQuestionsTests(unittest.TestCase):
 def setUp(self):
  (ROOT/'tmp').mkdir(parents=True,exist_ok=True)
  self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'tmp')
  self.patch=patch.multiple(conversation,WORK=Path(self.tmp.name),Tools=FakeTools)
  self.patch.start();self.app=conversation.Conversation()
 def tearDown(self):self.patch.stop();self.tmp.cleanup()
 def test_literal_text_search_never_calls_model_and_bypasses_busy_lane(self):
  conversation.LOCK.acquire()
  try:
   with patch('conversation.infer',side_effect=AssertionError('model must not run')):
    r=self.app.chat('合成测试','offline-test',direct_mode='text',run_id='literal-one')
   self.assertIn('合成测试原文',r['answer']);self.assertFalse(r['modelCalls'])
  finally:conversation.LOCK.release()
 def test_simple_profile_can_clarify_without_forced_tool(self):
  calls=[]
  def fake(*args):
   calls.append(args);return {'message':{'role':'assistant','content':'请先提供具体型号。'},'seconds':0}
  with patch('conversation.infer',side_effect=fake):
   self.app.chat('未提供设备信息','clarify-test',run_id='clarify-one',profile='simple')
  self.assertEqual(calls[0][3],'auto');self.assertIn('先理解客户当前实际需求',calls[0][1][0]['content'])
 def test_existing_profile_keeps_required_first_tool(self):
  with patch('conversation.infer',return_value={'message':{'role':'assistant','content':'合成输出'},'seconds':0}) as fake:
   self.app.chat('测试','legacy-mode',run_id='legacy-one')
  self.assertEqual(fake.call_args.args[3],'required')
 def test_cache_cannot_cross_profile_or_direct_mode(self):
  with patch('conversation.infer',return_value={'message':{'role':'assistant','content':'合成输出'},'seconds':0}):
   self.app.chat('测试','cache-client',run_id='same-id',profile='simple')
   with self.assertRaisesRegex(ValueError,'run-id-conflict'):
    self.app.chat('测试','cache-client',run_id='same-id')
   self.app.chat('测试','cache-client',run_id='direct-id',direct_mode='text')
   with self.assertRaisesRegex(ValueError,'run-id-conflict'):
    self.app.chat('测试','cache-client',run_id='direct-id',direct_mode='files')
 def test_five_customers_queue_single_lane_without_history_sharing(self):
  counts={'active':0,'peak':0};lock=threading.Lock();seen=[]
  def fake(cid,messages,*args):
   with lock:
    counts['active']+=1;counts['peak']=max(counts['peak'],counts['active']);seen.append(messages)
   time.sleep(.03)
   with lock:counts['active']-=1
   return {'message':{'role':'assistant','content':'请提供型号。'},'seconds':.03}
  with patch('conversation.infer',side_effect=fake),concurrent.futures.ThreadPoolExecutor(5) as pool:
   rows=list(pool.map(lambda i:self.app.chat('客户'+str(i),'client-'+str(i),run_id='parallel-'+str(i),profile='simple'),range(5)))
  self.assertTrue(all(not r.get('error') for r in rows));self.assertEqual(counts['peak'],1)
  self.assertTrue(all(not r['historyBefore'] for r in rows))
  self.assertEqual(len({m[-1]['content'] for m in seen}),5)
 def test_invalid_filters_and_profiles_rejected(self):
  for kwargs in [{'profile':'unknown'},{'filters':{'query':'override'}},{'direct_mode':'guess'}]:
   with self.assertRaises(ValueError):self.app.chat('测试','test-client',**kwargs)
 def test_file_citation_must_have_been_delivered(self):
  eid='file-0000000000000000'
  self.assertFalse(conversation.citation_check('文件 ['+eid+']',{eid:True})[1])
  self.assertEqual(conversation.citation_check('文件 ['+eid+']',{})[1],[eid])
  self.assertEqual(conversation.citation_check('[evidenceId: file-1111111111111111',{})[1],['file-1111111111111111'])

if __name__=='__main__':unittest.main()
