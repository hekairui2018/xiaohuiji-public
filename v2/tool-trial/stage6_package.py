"""Package the actual phase-six receipts after Agent source review. No AI calls."""
import collections,json,sys,zipfile
from pathlib import Path
import common
from stage6_audit import WORK,OLD,run

def finish():
 run()
 cases=json.loads((WORK/'cases.json').read_text(encoding='utf8'));reviews=json.loads((WORK/'agent-review.json').read_text(encoding='utf8'))
 results={p.stem:json.loads(p.read_text(encoding='utf8')) for p in (WORK/'results').glob('*.json')}
 assert set(results)=={c['id'] for c in cases}==set(reviews),'all 12 + 4 blind results and source reviews required'
 from review_evidence import ASSESS,REFERENCES
 comparisons=[];datasets=collections.defaultdict(list)
 for c in cases:
  cid=c['id'];r=results[cid];before=ASSESS.get(cid)
  comparisons.append({'id':cid,'split':c['split'],'before':{'A':before[0],'B':before[1]} if before else None,'after':reviews[cid],'criteriaUnchanged':True})
  datasets[c['split']].append({'id':cid,'question':c['question'],'questionOrigin':c.get('questionOrigin'),'originalEvidence':c['evidence'],
   'referenceAnswerCandidate':REFERENCES.get(cid),'criteria':c['criteria'],
   'reviewedAnswerCandidates':{arm:r[arm]['localTrace']['answer'] for arm in ['A','B'] if reviews[cid][arm]['grade']=='correct'},
   'negativeOrIncompleteExamples':{arm:{'answer':r[arm]['localTrace'].get('rawAnswer',r[arm]['localTrace']['answer']),'review':reviews[cid][arm]} for arm in ['A','B'] if reviews[cid][arm]['grade']!='correct'},
   'correctionPrinciples':reviews[cid],'approvedForTraining':False,'publishedToKnowledge':False,'reviewType':'Agent original-source audit, no new independent human or field validation'})
 for split,items in datasets.items():
  p=WORK/'datasets'/(split+'.json');p.parent.mkdir(exist_ok=True);common.save(p,items)
 common.save(WORK/'before-after-comparison.json',comparisons)
 m=json.loads((WORK/'metrics.json').read_text(encoding='utf8'));checks=json.loads((WORK/'citation-audit.json').read_text(encoding='utf8'))
 direct=json.loads((WORK/'client-direct-search.json').read_text(encoding='utf8'))
 old_direct=json.loads((OLD/'client-direct-search.json').read_text(encoding='utf8'))
 common.save(WORK/'direct-search-comparison.json',{'before':old_direct,'after':direct,'rankingAlgorithmUnchanged':True,'notes':'Filename/direct quick engine unchanged; tool case-scope eligibility filter and case context delivery changed. Engine elapsed is not UI end-to-end latency.'})
 lines=['# 第六阶段：通用证据交付修复与回归','',
  '本轮仅二代本机候选代码。未训练权重，未修改原始文件、资源DB、active、共享candidate、一代或现网，未push/部署/上传。',
  '','## 修改前 → 修改后','',
  '|组别|正确|部分|错误|未答|平均秒|p95秒|','|---|---:|---:|---:|---:|---:|---:|',
  '|第五阶段A自主检索|2|5|3|2|25.396|39.909|','|第五阶段B完整证据|8|3|1|0|9.641|22.943|']
 for key,label in [('original12-A','本轮12题A'),('original12-B','本轮12题B'),('blind4-A','新盲测A'),('blind4-B','新盲测B')]:
  s=m['groups'][key];g=s['grades'];lines.append(f"|{label}|{g.get('correct',0)}|{g.get('partial',0)}|{g.get('failed',0)}|{g.get('unanswered',0)}|{s['averageSeconds']}|{s['p95Seconds']}|")
 lines+=['','原12题、证据和标准保留；本轮另4条原始人工FAQ改写为盲测，未用于本轮调试；原7/3/2拆分保留，旧heldout已成为回归，不冒充新的独立成绩。评分由Agent回读原文，未请27B自评；仍需独立审查，不等于工程解决成功率。',
  '','## 真正修改的能力','',
  '- case_context按标题、故障标记、原始CSV行组织连续范围；不是新诊断规则或完整语义提炼器。K08、VP410H、VP620A/Y1固定原文边界有检查覆盖。',
  '- tools读取跨段原文、保留来源/日期/版本，提供词面角色指针、分页状态和继续读取位置。无效尝试与结果必须回读正文；角色提示不是已核实的工程字段。',
  '- 处理段未重复型号时，按所属原记录的文字型号线索做精确过滤；不把单段空型号当作其他型号的证据。多型号同案例不代表兼容。',
  '- evidence_delivery共享来源头、角色引用位置和已交付内容；原文文字不改，完整未压缩工具回执仍在traces。不能把“元数据压缩”说成硬件知识提升。',
  '- 回答约束区分单位、推测、失败尝试、当时结果与长期稳定、冲突及条件。它不能保证27B遵守，全部违规答案仍保留。',
  '','## 中间失败与取舍','',
  'pilot-v1/v2/v3保留各轮实际输出及中断记录：完整原文伴随大量重复元数据导致8K超限；后续通用压缩与分页修复。final-compaction-token-check是同原文的序列化比较，不是答题成绩。没有删除困难题，未更改标准或把答案接入运行代码。只运行一条本地推理通道，8080模型配置未修改。',
  '','## 逐题差异','']
 for c in comparisons:
  lines.append(f"- {c['id']}：前={c['before']}；后A={c['after']['A']['grade']}，B={c['after']['B']['grade']}。A：{c['after']['A']['reason']} B：{c['after']['B']['reason']}")
 lines+=['','## 验证及资源','',
  '32项工具/实验Python、128项Node、26项原提炼Python回归通过（详test-results.json）。实际客户端 /quick、/huiai输入/点击记录在results和client-*.json；没有用内部函数答案冒充界面测试。模型关闭开关是客户端传输禁用，未关闭共享8080进程。',
  f"最终本轮调用（包含额外多轮/缺证据界面测试）{m['actualModelCalls']}，输入{m['inputTokens']} / 输出{m['outputTokens']} Token，显存采样峰{m['peakSampledGPUMiB']} MiB。中间pilot额外资源另保留原日志，未并入最终12题均值。错误/未答也进入均值，失败明列，未用混合均值掩盖。",
  f"最终模型请求失败：{json.dumps(m['modelFailures'],ensure_ascii=False)}。引用格式校验异常：{sum(bool(x['unknown']) for x in checks)}题组；合法ID不代表该句被证据支持。",
  '','## 业务结论与退化','',
  'A完整正确2→4，B8→9；A两道未答已恢复，但仍有两道错误。B的单位补造/原文“应该”弱化有所改善，527冲突处置从正确退为错误、苹果APP前置联网从正确退为部分。不能只报告净增1题而隐藏两项退化。',
  '关键原文交付S05/S07/S08合计8个预先指定证据块：1/8→8/8。这是交付覆盖，不是答题正确率；S07已交付原处理器版本仍被模型遗漏，S05完整原文下仍产生无依据根因排除。',
  '三轮实际界面多轮中，最后固件1.1.34补充后，本轮明确不能据此确定通用PWM值；未再生成第五阶段的4K/2K→PWM伪关系表或假caseID。这只是同一固定会话的改善，不能据此宣称幻觉被消除。新会话history为空；缺资料追问、原文继续阅读与PDF下载通过。',
  '四个新盲测为不同CSV来源的原始人工FAQ改写，不是自然客户总体样本；A4正确，B3正确/1部分。B仍把A6L处理方法归纳成已解决部分问题，缺独立原文结果支持。',
  '危险/忠实性维度见safety-dimension-comparison.json，列具体题号、允许重叠，不把未答当成危险回答。串版本P01仍未修好；显式引用省略H02-B另列，不把合法或缺省ID当作语义正确。不能通过正式无人客服验收，全部保持实验候选。',
  '小灰机的文件名速查排序未改；改进在案例连续交付和空型号处理段的所属案例过滤。原客户端4条直查的具体结果/耗时保留，word操作问题仍可能先返回现象片段，未假称排序已修好。',
  '当前瓶颈是混合的：A还需要更好的章节选择、候选案例组织和按日期继续查；B完整证据下的冲突擅自排序、前提遗漏、虚构部分成功和过度否认结果，是当前27B忠实性边界。先改善通用证据/回答关系校验并保持冻结测试，再考虑微调；现有小样本不支持立即训练。',
  '','## 剩余限制与结论','',
  '边界仍是保守结构推导：无标题、扫描图、隐含跨章节共同条件等不能保证正确。返回完整原文不等于模型理解完整；scopeMentions只是文字提及，不是硬件兼容判定。原文“当时显示正常”和“长期稳定”必须分开，不能以缺少长期记录否认原文明确的当时结果。',
  '模型仍需以逐题错误记录判断。若完整B证据下仍自行排序冲突措施、制造版本/场景关系或遗漏前提，应标记当前27B忠实性边界，不能靠固定案例规则补答案。保留未来微调候选，但本轮证据规模不足以直接决定训练。',
  '本轮是组合修复前后比较，不是每个改动独立的消融实验；B人工/程序核对证据的准备成本未计入回答秒数。小样本成绩不可外推到2231例或真实客户解决率。',
  '','## 回退','',
  '本地实现提交见git-commits.json。按阶段逆序revert本轮提交可回到35677ef工具行为；实验输出独立tmp目录保留。停止本机4512/4499只影响开发实例，不能操作一代生产服务。active与索引无需回滚，因为未改。',
  '完整资源消耗（包括中间失败）见resource-total.json：154个已落盘回执，150个实际推理完成回执、4个预检预算拒绝；373708输入/25395输出Token，记录模型耗时1464.842秒，首末实验回执跨度1720.197秒。中断未落盘的调用不能完全核算，以上是已记录下限，均为本地推理、无云端费用。性能受热缓存和顺序影响，非单改动因果消融。',
  '完成后停止，等待独立验收；不自动扩大提炼或发布范围。']
 report='\n'.join(lines)+'\n';(WORK/'第六阶段-实际回归报告.md').write_text(report,encoding='utf8')
 # Save exact source implementations as text for reviewers; no binaries/DB.
 for p in (common.ROOT/'v2/tool-trial').glob('*'):
  if p.suffix in ['.py','.cjs']:
   target=WORK/'implementation'/(p.name+'.txt');target.parent.mkdir(exist_ok=True);target.write_bytes(p.read_bytes())
 sys.path.insert(0,str(common.ROOT/'v2/experience-extraction'))
 from export_review import build
 authors=[]
 policy=json.loads((WORK/'access-policy.json').read_text(encoding='utf8'))
 import csv
 for key,r in policy['resources'].items():
  if not r['name'].endswith('.csv'):continue
  loc=next(x for x in r['locations'] if x.get('sha256')==key)
  with Path(loc['path']).open(encoding='utf-8-sig',newline='') as f:
   records=list(csv.reader(f))
  header=records[0]
  if '记录人' in header:
   i=header.index('记录人');authors.extend(x[i] for x in records[1:] if len(x)>i and 2<=len(x[i])<=24)
 for p in (WORK/'implementation-before').glob('*.py'):p.with_suffix(p.suffix+'.txt').write_bytes(p.read_bytes())
 extra=[p for folder in ['results','traces','before-results','before-calls','baseline-datasets','datasets','implementation','implementation-before','regression-logs','pilot-v1','pilot-v2','pilot-v3'] for p in (WORK/folder).rglob('*') if p.is_file() and p.suffix in ['.json','.jsonl','.txt']]
 manifest=build(WORK,'小灰机二代_第六阶段通用修复_脱敏审查包.zip',
  '先看第六阶段-实际回归报告.md、before-after-comparison.json、逐题回答与原文审查.html。before-results为第五阶段原始12题，results为最终12+4盲测真实客户端输出。pilot-v1/v2/v3保留中间失败，不与最终成绩混合。traces保留完整未压缩证据，calls保留真实模型请求/Token/响应；modelDelivery仅压缩重复元数据。datasets为未批准训练候选，baseline-datasets原7/3/2不变。source-evidence及evidence-readback提供原文和定位。脱敏副本不含完整原件、DB或图片；仍含公司技术内容，未授权公开或自动上传。',
  extra_redactions=authors,extra_files=extra,exclude_files=['zip-integrity.json'])
 archive=Path(manifest['path']);dest=WORK/'zip-verify';dest.mkdir(exist_ok=True)
 with zipfile.ZipFile(archive) as z:
  assert z.testzip() is None
  names=set(z.namelist())
  required=['cases.json','agent-review.json','metrics.json','source-evidence.json','evidence-readback.json','before-after-comparison.json','第六阶段-实际回归报告.md']
  assert all(n in names for n in required)
  assert len([n for n in names if n.startswith('results/') and n.endswith('.json')])==16
  assert len([n for n in names if n.startswith('before-results/') and n.endswith('.json')])==12
  for info in z.infolist():assert (dest/info.filename).resolve().is_relative_to(dest.resolve())
  z.extractall(dest)
  for n in required:assert (dest/n).is_file()
 common.save(WORK/'zip-integrity.json',{'testzip':True,'extracted':True,'requiredFiles':required,'finalPairs':16,'oldPairs':12,'bytes':archive.stat().st_size,'sha256':common.sha(archive),'uploaded':False})
 print(manifest)

if __name__=='__main__':finish()
