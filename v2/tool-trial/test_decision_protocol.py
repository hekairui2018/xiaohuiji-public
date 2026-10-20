"""Synthetic protocol/grounding invariants, not model capability scores."""
import copy,json,unittest
from decision_protocol import validate,dispatch,source_view,original_quote,PLAN


def plan(**changes):
 d={'customer_intent':'读取合成说明','known_facts':[{'fact':'客户咨询合成内容','quote':'合成'}],'missing_facts':[],
 'need_tool':True,'need_clarification':False,'current_answerable':False,'possible_next_need':'','evidence_required':True,
 'action':'tool','tool_name':'search_document_blocks','tool_arguments':{'query':'合成'},
 'selected_evidence_ids':[],'evidence_assessment':[],'clarification_question':''}
 d.update(changes);return d


class DecisionProtocolTests(unittest.TestCase):
 def test_native_tool_template_can_see_root_required_fields(self):
  schema=PLAN['function']['parameters']
  self.assertIn('customer_intent',schema['properties']);self.assertIn('current_answerable',schema['required'])
 def test_action_flags_have_disjoint_schema_variants(self):
  variants=PLAN['function']['parameters']['oneOf'];self.assertEqual(len(variants),3)
  for v in variants:
   action=v['properties']['action']['enum'][0]
   expected={'tool':(True,False,False),'answer':(False,False,True),'clarify':(False,True,False)}[action]
   self.assertEqual(tuple(v['properties'][k]['enum'][0] for k in ['need_tool','need_clarification','current_answerable']),expected)
 def test_unknown_customer_fact_is_not_accepted(self):
  with self.assertRaisesRegex(ValueError,'known-fact-quote-not-original'):validate(plan(known_facts=[{'fact':'不存在的版本','quote':'不存在的版本'}]),'合成',[],{})
 def test_answer_requires_real_returned_evidence(self):
  d=plan(action='answer',need_tool=False,current_answerable=True,tool_name='none',tool_arguments={})
  with self.assertRaisesRegex(ValueError,'answer-needs-returned-evidence'):validate(d,'合成',[],{})
 def test_answerable_cannot_be_blocked_by_clarification(self):
  with self.assertRaisesRegex(ValueError,'clarification-decision-conflict'):
   validate(plan(action='clarify',need_tool=False,current_answerable=True,need_clarification=True,missing_facts=['对象'],clarification_question='请提供对象',tool_name='none',tool_arguments={}),'合成',[],{})
 def test_scope_quote_must_be_in_original(self):
  d=plan(evidence_assessment=[{'evidence_id':'e1','applicability':'direct','scope_quote':'伪造'}])
  with self.assertRaisesRegex(ValueError,'scope-quote-not-original'):validate(d,'合成',[],{'e1':{'text':'原文对象'}})
 def test_irrelevant_evidence_cannot_be_selected_for_answer(self):
  d=plan(action='answer',need_tool=False,current_answerable=True,tool_name='none',tool_arguments={},selected_evidence_ids=['e1'],evidence_assessment=[{'evidence_id':'e1','applicability':'irrelevant','scope_quote':'原文'}])
  with self.assertRaisesRegex(ValueError,'selected-evidence-not-applicable'):validate(d,'合成',[],{'e1':{'text':'原文'}})
 def test_prior_customer_messages_not_assistant_guesses_are_facts(self):
  d=plan(known_facts=[{'fact':'客户明确型号','quote':'客人的型号'}])
  validate(d,'合成',[{'role':'user','content':'客人的型号'}],{})
  with self.assertRaisesRegex(ValueError,'known-fact-quote-not-original'):validate(d,'合成',[{'role':'assistant','content':'客人的型号'}],{})
 def test_faithful_paraphrase_is_not_mistaken_for_fabricated_quote(self):
  d=plan(known_facts=[{'fact':'客户问如何使用合成功能','quote':'合成'}])
  self.assertEqual(validate(d,'合成',[],{}),d)
 def test_index_model_hints_never_become_original_scope(self):
  b={'evidenceId':'e1','text':'原文对象与操作','models':['metadata-only-model'],'locator':{'paragraph':2},'versionId':'v1'}
  original={'blocks':[b],'scopeMentions':['metadata-only-model'],'completeRecordDelivered':False,'nextCaseOffset':9}
  view=source_view(original);self.assertNotIn('metadata-only-model',json.dumps(view))
  self.assertEqual(view['data']['blocks'][0]['text'],b['text']);self.assertFalse(view['data']['completeRecordDelivered']);self.assertEqual(view['data']['nextCaseOffset'],9)
 def test_joined_literal_list_items_preserve_order_words_and_negation(self):
  source='1、必须断开。\n2、不能改动；3、保持原状'
  self.assertTrue(original_quote('必须断开；保持原状',source))
  self.assertFalse(original_quote('保持原状；必须断开',source))
  self.assertFalse(original_quote('必须断开；可以改动',source))
 def test_retry_retains_failed_native_decision_for_repair(self):
  invalid=plan(known_facts=[{'fact':'概括','quote':'不在原文'}]);fixed=plan(action='clarify',need_tool=False,need_clarification=True,missing_facts=['对象'],clarification_question='请提供对象。',tool_name='none',tool_arguments={})
  seen=[]
  def infer(cid,messages,*args):
   seen.append(copy.deepcopy(messages));d=invalid if len(seen)==1 else fixed
   return {'seconds':0,'message':{'role':'assistant','tool_calls':[{'id':'attempt-'+str(len(seen)),'function':{'name':'decide_next_action','arguments':json.dumps(d)}}]}}
  tr={'tools':[],'modelCalls':[],'protocolErrors':[]};dispatch('合成',[],tr,None,infer,'repair-test','system')
  self.assertEqual(seen[1][-2]['tool_calls'][0]['id'],'attempt-1')
  self.assertEqual(seen[1][-1]['tool_call_id'],'attempt-1');self.assertEqual(tr['answer'],'请提供对象。')
 def test_dispatch_search_decision_then_answer_only_selected_evidence(self):
  eid='blk-0000000000000000-1';source={'evidenceId':eid,'text':'合成资料对象','sourceName':'synthetic.txt'}
  d1=plan();d2=plan(action='answer',need_tool=False,current_answerable=True,tool_name='none',tool_arguments={},selected_evidence_ids=[eid],evidence_assessment=[{'evidence_id':eid,'applicability':'direct','scope_quote':'合成资料对象'}])
  received=[]
  def infer(cid,messages,definitions=None,choice=None):
   received.append((cid,messages,definitions,choice))
   d=d1 if len(received)==1 else d2
   return {'seconds':0,'message':{'role':'assistant','content':'原文支持的合成回答'} if len(received)==3 else {'role':'assistant','tool_calls':[{'id':'synthetic-call','function':{'name':'decide_next_action','arguments':json.dumps(d)}}]}}
  class Tools:
   def execute(self,name,args):return {'results':[source]}
  tr={'tools':[],'modelCalls':[],'protocolErrors':[]}
  ev,first=dispatch('合成',[],tr,Tools(),infer,'synthetic-run','system')
  self.assertEqual(len(tr['decisions']),2);self.assertEqual(tr['answer'],'原文支持的合成回答')
  self.assertEqual(tr['selectedEvidenceIds'],[eid]);self.assertIn(eid,ev)
  self.assertEqual(received[0][3],'required');self.assertIsNone(received[-1][2])
 def test_clarification_does_not_call_knowledge_or_expose_json(self):
  d=plan(action='clarify',need_tool=False,need_clarification=True,missing_facts=['对象'],clarification_question='请提供对象。',tool_name='none',tool_arguments={})
  def infer(*args):return {'message':{'role':'assistant','tool_calls':[{'id':'synthetic','function':{'name':'decide_next_action','arguments':json.dumps(d)}}]},'seconds':0}
  class Tools:
   def execute(self,*args):raise AssertionError('no tool is needed')
  tr={'tools':[],'modelCalls':[],'protocolErrors':[]};dispatch('合成',[],tr,Tools(),infer,'synthetic-clarify','system')
  self.assertEqual(tr['answer'],'请提供对象。');self.assertFalse(tr['tools'])

if __name__=='__main__':unittest.main()
