"""Conservative source-boundary context, not a diagnostic rule engine.

No generated engineering facts: all role hints point to unchanged source blocks.
Ambiguous boundaries and unlabelled actions remain explicitly unresolved.
"""
import re

START = re.compile(r'^(?:\d+[.、．]\s*)?(?:故障现象|问题现象|现象|问题)[：:]')
CHAPTER = re.compile(r'^\d+(?:\.\d+)+\s+\S|^(?:第[一二三四五六七八九十\d]+[章节])')
MODEL_HEADING = re.compile(r'^(?=[A-Za-z0-9+-]*[A-Za-z])[A-Za-z0-9]+(?:[-+][A-Za-z0-9]+)*(?:\([^\n]{1,20}\))?$')
ACTION = re.compile(r'解决|处理|排查|检查|复现|原因|无效|正常|升级')
ROLES = {
 'phenomenon':r'故障现象|问题现象|现象[：:]',
 'conditions':r'现场信息|模组信息|固件|版本|带载|扫描|[0-9]+S\b',
 'checks':r'检查|探测|查看|测试|排查|回读',
 'attempts':r'调整|升级|更换|换了|复位|尝试|降低|提升|发送',
 'failedAttempts':r'无效|未能|仍然|依旧|没有改善|没反应',
 'causeJudgment':r'原因|怀疑|应该|疑似|可能',
 'treatment':r'解决|处理|通过|最后|最终',
 'recordedOutcome':r'显示正常|恢复正常|问题消失|问题解决|黑边消失|黑边没了',
}

def boundaries(rows, csv=False):
 """Return non-overlapping ordinal spans; CSV records are never joined."""
 if csv:return [(i,i,'original-csv-record') for i in range(len(rows))]
 starts=[0];handled=False;section=False
 for i,row in enumerate(rows):
  text=row['text'].strip()
  heading=bool(CHAPTER.match(text) or (len(text)<55 and MODEL_HEADING.fullmatch(text)) or re.fullmatch(r'\d{4,6}',text)
   or (len(text)<35 and re.fullmatch(r'[^，。；：:]+(?:规格|要求|总结|分享)',text)))
  phenomenon=bool(START.match(text))
  # A subsection owns its introductory conditions and first phenomenon.
  split=heading or (phenomenon and handled)
  if split and i:
   starts.append(i);handled=False;section=heading
  if ACTION.search(text) and not heading and not phenomenon:handled=True
 starts=sorted(set(starts))
 return [(s,(starts[n+1]-1 if n+1<len(starts) else len(rows)-1),'source-structural-boundary-not-human-verified') for n,s in enumerate(starts)]

def envelope(blocks, boundary_status='provided-source-window'):
 hints={k:[] for k in ROLES}
 for b in blocks:
  for key,pattern in ROLES.items():
   if re.search(pattern,b['text']):hints[key].append(b['evidenceId'])
 spans=boundaries(blocks, bool(blocks and all(b.get('recordDate') for b in blocks)))
 return {'boundaryStatus':boundary_status,'orderedEvidenceIds':[b['evidenceId'] for b in blocks],
  'sourceRecords':[{'evidenceIds':[b['evidenceId'] for b in blocks[s:e+1]],'status':status} for s,e,status in spans],
  'roleHints':hints,'roleHintStatus':'lexical reading pointers only; overlapping roles must be interpreted from full original text, not confirmed extracted facts',
  'missingRoleLabels':[k for k,v in hints.items() if not v],
  'constraints':['不同记录不得合并为一个原因或措施。','无明确结果不能说已解决；即可不是独立成功观察。',
   '数值没有单位时保留原值并说原文未注明单位。','型号提及不是兼容关系；日期不是固件版本；版本条件不得扩大。',
   '尝试无效不能作为最终方案；怀疑/应该保留推测语气。','图片未读；未出现字段只表示未记录，不证明不存在。']}
