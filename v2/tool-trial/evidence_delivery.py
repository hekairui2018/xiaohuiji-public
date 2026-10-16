"""Lossless evidence text projection for the model, full tool receipts stay in audit.

Only repeated transport metadata is compacted. No rank/answer/technical rewriting.
"""
import hashlib

def model_view(value,seen=None):
 seen=seen if seen is not None else set()
 sources={}
 def visit(v):
  if isinstance(v,list):return [visit(x) for x in v]
  if not isinstance(v,dict):return v
  if 'evidenceId' in v and 'text' in v:
   pair=(v.get('resourceId'),v.get('versionId'))
   if pair not in sources:sources[pair]={'sourceIndex':len(sources),**{k:v[k] for k in ['resourceId','versionId','sourceName','sourceType','verificationStatus','imagesRead'] if k in v}}
   key=(v['evidenceId'],v.get('offset',0),hashlib.sha256(v['text'].encode()).hexdigest())
   if key in seen:return {'evidenceId':v['evidenceId'],'offset':v.get('offset',0),'textAlreadyDelivered':True}
   seen.add(key)
   return {'sourceIndex':sources[pair]['sourceIndex'],**{k:v[k] for k in ['evidenceId','blockId','text','recordDate','locator','models','offset','truncated','nextOffset','caseId'] if k in v and v[k] is not None}}
  if 'roleHints' in v and 'orderedEvidenceIds' in v:
   positions={eid:i for i,eid in enumerate(v['orderedEvidenceIds'])}
   return {**{k:visit(x) for k,x in v.items() if k not in ['roleHints','roleHintStatus','constraints']},
    'roleHintEvidencePositions':{k:[positions[eid] for eid in ids] for k,ids in v['roleHints'].items()},
    'roleHintNote':'Positions index orderedEvidenceIds; lexical hints only, not extracted engineering facts.'}
  # Shared reading contract is supplied once in the system message.
  return {k:visit(x) for k,x in v.items() if k not in ['scopeWarning','scope','moreAvailable','constraints','roleHintStatus','note']}
 result=visit(value)
 return {'data':result,'sources':list(sources.values()),'contract':'Original text unchanged. Repeated text references refer to earlier delivered evidence. No independent hardware validation; model mentions do not imply compatibility; images not read.'}
