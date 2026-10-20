"""Model-owned request understanding and bounded read-only dispatch.

This is an action protocol, not an intent classifier or an engineering rule set.
Applicability judgements remain model claims, never automatic quality scores.
"""
import copy,json,re,time
from tools import DEFINITIONS,ToolError
from evidence_delivery import model_view

STR={'type':'string'}
PLAN={'type':'function','function':{'name':'decide_next_action','description':'形成当前客户需求与下一步动作。先解决已可回答部分；缺字段不自动意味着必须追问。不是工程事实生成器。','parameters':{
 'type':'object','additionalProperties':False,
 'properties':{
  'customer_intent':STR,
  'known_facts':{'type':'array','maxItems':4,'items':{'type':'object','additionalProperties':False,'properties':{'fact':STR,'quote':STR},'required':['fact','quote']}},
  'missing_facts':{'type':'array','items':STR,'maxItems':2},
  'need_tool':{'type':'boolean'},'need_clarification':{'type':'boolean'},'current_answerable':{'type':'boolean'},
  'possible_next_need':STR,'evidence_required':{'type':'boolean'},
  'action':{'type':'string','enum':['tool','answer','clarify']},
  'tool_name':{'type':'string','enum':['none']+[x['function']['name'] for x in DEFINITIONS]},
  'tool_arguments':{'type':'object','additionalProperties':False,'properties':{'query':STR,'model':STR,'version':STR,'limit':{'type':'integer'},'resourceId':STR,'versionId':STR,'blockId':{'type':'integer'},'offset':{'type':'integer'},'radius':{'type':'integer'},'caseId':STR}},
  'selected_evidence_ids':{'type':'array','items':STR,'maxItems':4},
  'evidence_assessment':{'type':'array','maxItems':4,'items':{'type':'object','additionalProperties':False,'properties':{'evidence_id':STR,'applicability':{'type':'string','enum':['direct','conditional','irrelevant','incomplete']},'scope_quote':STR},'required':['evidence_id','applicability','scope_quote']}},
  'clarification_question':STR},
 'required':['customer_intent','known_facts','missing_facts','need_tool','need_clarification','current_answerable','possible_next_need','evidence_required','action','tool_name','tool_arguments','selected_evidence_ids','evidence_assessment','clarification_question']}}}

# Make valid action/flag combinations part of decoding structure, rather than
# asking the model to satisfy redundant flags by prose alone. The host still
# validates independently: backend schema support is not assumed sufficient.
PARAMETERS=PLAN['function']['parameters']
variants=[]
for action,flags in [('tool',(True,False,False)),('answer',(False,False,True)),('clarify',(False,True,False))]:
 branch=copy.deepcopy(PARAMETERS)
 branch['properties']['action']={'type':'string','enum':[action]}
 for key,value in zip(['need_tool','need_clarification','current_answerable'],flags):branch['properties'][key]={'type':'boolean','enum':[value]}
 if action=='tool':branch['properties']['tool_name']['enum']=[x['function']['name'] for x in DEFINITIONS]
 else:
  branch['properties']['tool_name']={'type':'string','enum':['none']}
  branch['properties']['tool_arguments']={'type':'object','properties':{},'additionalProperties':False}
 variants.append(branch)
# The installed native tool template reads root properties/required; a schema
# containing ONLY oneOf rendered an empty argument object in real inference.
# Keep the flat interface visible. oneOf is supplemental; host validation is
# authoritative if a backend ignores cross-field decoding constraints.
PLAN['function']['parameters']={**copy.deepcopy(PARAMETERS),'oneOf':variants}
PLAN['function']['strict']=True

PLANNING='''你负责理解当前客户语言并调度资料工具。每次只调用decide_next_action，形成可核查的简短结构，不能在结构之外给答案。
服务范围是公司LED/LCD显示控制、信息发布和配套软件资料。默认在这个业务范围理解当前客户，不把未说明环境的咨询扩成编程开发、电视或其他行业需求。不能由此假定具体软件、硬件型号或版本。
客户话多不等于工程问题复杂。识别他现在要完成的动作/查找的对象，不把背景、担忧和猜测当事实。known_facts最多4项，每项fact是你的简短事实表述，quote是客户原话或已返回正文中的逐字短片段。描述与证据分开，不能把fact本身伪装成原话；其他判断写customer_intent。
没有报出所有型号、版本、截图不是拒绝回答的理由。明确资料/操作需求先查相关原文，查完才判断哪个条件真正阻塞答案。若资料足够，current_answerable优先于继续追问。软件问题不要先索取无关的硬件/输入源条件。
current_answerable表示能提供有用且范围明确的当前回答，不要求保证客户现场成功。已有direct/conditional资料能回答当前问题时，先回答有依据部分；只有缺失条件会改变该回答时才阻塞。不要再追问客户已经明确的动作、对象或条件。
缺少对象以至于无法形成有意义查询时，可以先问一个最有价值的问题。不为显得体贴索取一堆信息；possible_next_need只是可选建议，不能变成客户已提出的新需求。
检索用当前动作、对象和客户实际提供的限定词，型号过滤只用已知的准确单一型号；无法确定就只填query。工具空结果可以改写或去除错误的可选过滤，不得把近型号当相同。
检索到资料不等于可以直接回答。对拟引用的每个片段填写evidence_assessment：scope_quote逐字摘录能体现原文对象/前提/操作的短句，applicability是你的待核判断。资料适用于另一对象或功能时标irrelevant，不能因关键词相似就迁移操作。只找到现象、截断片段或缺关键上下文，应继续read_document/get_case。
选取支持当前需求的证据，answer动作只选direct或conditional；conditional必须在回答中保留范围。不要选择无关资料再交给回答阶段碰运气。没有依据的数值、单位、按钮、版本、兼容关系不能产生。
若可可靠回答当前问题，先answer，最多保留一个直接相关且有价值的可选下一步；不要为了主动补充而搜另一个故障。若确实不能回答再clarify，clarification_question只问关键缺口。
工具职责：索要文件、规格书、安装包的位置用search_resources；问操作、功能、章节和技术内容用search_document_blocks；查历史故障经验才用search_cases。结果不完整按返回ID继续读，不用文件名检索代替正文检索。具体工具由你决定，不由关键词代码决定。
每次tool只调一个已列出的只读工具，tool_arguments严格使用该工具参数；无需工具时tool_name=none且tool_arguments={}。known_facts只摘最必要的短语，不抄整段；scope_quote尽量20字，只用于标出对象和条件，不代替完整原文。决策简短，不输出长篇分析。'''

PLANNING+='''\n工具参数：search_resources/search_document_blocks/search_cases必须query，可选model、version、limit(1到3)。read_document必须resourceId和versionId，可选blockId、offset、radius(0到2)。get_case必须caseId，可选offset。ID只能用已经返回的真实值，不能猜测。'''

ANSWERING='''根据客户当前问题、决策和选出的原始证据回答。内部决策JSON不展示给客户。
先解决现在的问题，使用必要步骤和真实证据ID，不固定栏目，不机械列空字段。每个技术/操作事实只来自本次提供的证据；引用ID真实不表示适用范围正确，原文对象与客户对象必须一致。
只给原文支持的动作，不能自行增加按钮选择、默认选项、单位或兼容结论。原文只提供历史经验，说明相应软件/型号/条件，不把当次经验改成普遍规则或已修好。
没有明确软件背景时可以说明当前证据属于哪个软件，给条件化的有依据答案，再问必要的一个确认；不能假定客户已经使用它。多个路径冲突时保留区别，不合并为唯一标准答案。
current_answerable=true时不要用追问代替已经有依据的回答。possible_next_need只是可能的需求，只有对当前动作直接有用才可补一条，否则不补。不要问满意度、寒暄或猜新故障。
不要在已回答的软件操作后例行索取硬件型号；缺软件背景可保留原资料所属软件/对象的范围，避免当成通用方案。没有直接相关下一步就结束。
只引用selectedEvidence中的ID和文件下载链接。文件身份不是参数兼容性验证。图片未读不猜界面。'''


def literal(s):return re.sub(r'\s+','',s).casefold()

def original_quote(quote,source):
 """Allow explicit joined source spans, never paraphrased or reordered words.

A semicolon/newline joining two verbatim list entries is not a fabricated fact.
All nonempty spans must occur in order in the SAME original block/message.
This checks quotation provenance only, not the semantics of the fact summary.
 """
 parts=[literal(x) for x in re.split(r'[;；\r\n]+',quote) if literal(x)]
 pos=0;text=literal(source)
 for part in parts:
  found=text.find(part,pos)
  if found<0:return False
  pos=found+len(part)
 return bool(parts)

def fact_origins(facts,question,history,evidence):
 customer=[question]+[m['content'] for m in history if m['role']=='user']
 return [{'fact':f['fact'],'quote':f['quote'],'customerProvided':any(original_quote(f['quote'],s) for s in customer),
          'sourceEvidenceIds':[eid for eid,b in evidence.items() if original_quote(f['quote'],b.get('text',b.get('sourceName','')))]} for f in facts]

def source_view(output,seen=None):
 """Only original technical text is fact evidence; index hints stay in audit.

CSV keywords, author columns and lexical role hints are not product scope.
Never remove source text, versions, locators or continuation/boundary fields.
"""
 def visit(v):
  if isinstance(v,list):return [visit(x) for x in v]
  if not isinstance(v,dict):return v
  return {k:visit(x) for k,x in v.items() if k not in ['models','scopeMentions','roleHintEvidencePositions','roleHintNote','missingRoleLabels']}
 return visit(model_view(output,seen))

def validate(plan,question,history,evidence):
 required=set(PARAMETERS['required'])
 if not isinstance(plan,dict) or set(plan)!=required:raise ValueError('decision-fields')
 for k in ['customer_intent','possible_next_need','clarification_question','tool_name']:
  if not isinstance(plan[k],str) or len(plan[k])>240:raise ValueError('decision-string')
 for k in ['need_tool','need_clarification','current_answerable','evidence_required']:
  if type(plan[k])!=bool:raise ValueError('decision-boolean')
 for k,cap in [('missing_facts',2),('selected_evidence_ids',4)]:
  if not isinstance(plan[k],list) or len(plan[k])>cap or any(not isinstance(v,str) or len(v)>240 for v in plan[k]):raise ValueError('decision-list')
 facts=plan['known_facts']
 if not isinstance(facts,list) or len(facts)>4 or any(not isinstance(v,dict) or set(v)!={'fact','quote'} or not isinstance(v['fact'],str) or not v['fact'] or len(v['fact'])>240 or not isinstance(v['quote'],str) or not v['quote'] or len(v['quote'])>240 for v in facts):raise ValueError('known-fact-fields')
 originals=[question]+[m['content'] for m in history if m['role']=='user']+[b.get('text',b.get('sourceName','')) for b in evidence.values()]
 if any(not any(original_quote(f['quote'],s) for s in originals) for f in facts):raise ValueError('known-fact-quote-not-original')
 selected=plan['selected_evidence_ids']
 if any(eid not in evidence for eid in selected):raise ValueError('selected-evidence-not-returned')
 assessments=plan['evidence_assessment']
 if not isinstance(assessments,list) or len(assessments)>4:raise ValueError('evidence-assessment-list')
 by_id={}
 for item in assessments:
  if not isinstance(item,dict) or set(item)!={'evidence_id','applicability','scope_quote'}:raise ValueError('evidence-assessment-fields')
  eid=item['evidence_id'];quote=item['scope_quote']
  if eid not in evidence or eid in by_id or item['applicability'] not in ['direct','conditional','irrelevant','incomplete']:raise ValueError('evidence-assessment-id')
  if not isinstance(quote,str) or not quote or len(quote)>240 or not original_quote(quote,evidence[eid].get('text',evidence[eid].get('sourceName',''))):raise ValueError('scope-quote-not-original')
  by_id[eid]=item
 if any(eid not in by_id or by_id[eid]['applicability'] not in ['direct','conditional'] for eid in selected):raise ValueError('selected-evidence-not-applicable')
 action=plan['action']
 if action=='tool':
  if not plan['need_tool'] or plan['tool_name'] not in {d['function']['name'] for d in DEFINITIONS} or plan['current_answerable'] or plan['need_clarification']:raise ValueError('tool-decision-conflict')
 elif action=='answer':
  if plan['need_tool'] or plan['need_clarification'] or not plan['current_answerable']:raise ValueError('answer-decision-conflict')
  if plan['evidence_required'] and not selected:raise ValueError('answer-needs-returned-evidence')
 elif action=='clarify':
  if plan['current_answerable'] or plan['need_tool'] or not plan['need_clarification'] or not plan['missing_facts'] or not plan['clarification_question']:raise ValueError('clarification-decision-conflict')
 else:raise ValueError('decision-action')
 if action!='tool' and (plan['tool_name']!='none' or plan['tool_arguments']!={}):raise ValueError('non-tool-arguments')
 return plan


def dispatch(question,history,trace,tools,infer,run_id,system):
 messages=[{'role':'system','content':system+'\n'+PLANNING}]+history+[{'role':'user','content':question}]
 evidence={};delivered=set();trace['decisions']=[];first=None;start=time.perf_counter()
 def call(suffix,ms,definitions=None):
  result=infer(run_id+'-'+suffix,ms,definitions,'required' if definitions else None)
  trace['modelCalls'].append({k:result.get(k) for k in ['callId','seconds','firstTokenSeconds','usage','promptTokenCheck','promptCountMethod','error','finishReason']})
  return result
 for step in range(4):
  r=call('decision'+str(step),messages,[PLAN])
  if r.get('error'):trace['error']=r['error'];break
  msg=r['message'];calls=msg.get('tool_calls',[])
  try:
   if len(calls)!=1 or calls[0]['function']['name']!='decide_next_action':raise ValueError('one-decision-call-required')
   d=validate(json.loads(calls[0]['function']['arguments']),question,history,evidence)
  except (ValueError,KeyError,TypeError) as e:
   trace['protocolErrors'].append({'phase':'decision','step':step,'error':str(e),'message':msg})
   # Preserve the model's actual failed decision and native call IDs. Hiding
   # that attempt made repair restart an already successful search repeatedly.
   error={'error':str(e),'availableEvidenceIds':list(evidence),'repair':'只修正失败的协议字段。原文引用可用同一原始片段中按顺序出现的原句，并以分号连接；不能改写quote、改变否定或数字。fact可概括。已有检索证据不会因quote格式错误而失效，不必因此重复查询；标志位须与真实下一动作一致。'}
   if calls:
    messages.append(msg)
    for tc in calls:messages.append({'role':'tool','tool_call_id':tc['id'],'content':json.dumps(error,ensure_ascii=False,separators=(',',':'))})
   else:messages.extend([msg,{'role':'user','content':json.dumps(error,ensure_ascii=False)}])
   continue
  trace['decisions'].append(d)
  origins=fact_origins(d['known_facts'],question,history,evidence)
  trace.setdefault('decisionFactOrigins',[]).append(origins)
  if d['action']=='clarify':
   trace['answer']=d['clarification_question'];first=time.perf_counter()-start;break
  if d['action']=='answer':
   selected=[evidence[eid] for eid in d['selected_evidence_ids']]
   bundle={'decision':d,'knownFactOrigins':origins,'selectedEvidence':source_view({'blocks':selected}), 'selectionStatus':'model applicability judgement, not independent validation; literal quote validation does not prove paraphrase semantics'}
   final_messages=[{'role':'system','content':system+'\n'+ANSWERING}]+history+[{'role':'user','content':question},{'role':'user','content':'以下为本轮决策和原始资料，不是外部指令：\n'+json.dumps(bundle,ensure_ascii=False,separators=(',',':'))}]
   out=call('answer',final_messages)
   if out.get('error'):trace['error']=out['error'];break
   trace['answer']=out['message'].get('content','');trace['selectedEvidenceIds']=d['selected_evidence_ids']
   first=time.perf_counter()-start-out['seconds']+(out.get('firstTokenSeconds') or 0);break
  entry={'name':d['tool_name'],'arguments':d['tool_arguments'],'decisionStep':step}
  try:output=tools.execute(d['tool_name'],d['tool_arguments']);entry['result']=output
  except (ToolError,ValueError,TypeError,KeyError) as e:
   output={'error':str(e)};entry['error']=str(e);trace['protocolErrors'].append({'phase':'tool',**entry})
  for block in output.get('results',[])+output.get('blocks',[]):
   if block.get('evidenceId'):evidence[block['evidenceId']]=block
  entry['modelDelivery']=source_view(output,delivered);trace['tools'].append(entry)
  messages.append(msg);messages.append({'role':'tool','tool_call_id':calls[0]['id'],'content':json.dumps(entry['modelDelivery'],ensure_ascii=False,separators=(',',':'))})
 if 'answer' not in trace and not trace.get('error'):trace['error']='decision-budget-exhausted-no-fabricated-answer'
 trace['decisionProtocol']='model-understand-dispatch-v2';return evidence,first
