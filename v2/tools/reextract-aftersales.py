"""Offline, literal-source aftersales audit and isolated candidate. No activation or model calls."""
import argparse, collections, copy, csv, hashlib, json, re, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

BASE=Path('v2/data/knowledge-next/knowledge-fc9f11a1e72de750/index.json')
REPORT=Path('docs/v2/售后重提炼-20261015')
BRANCH=Path('v2/data/knowledge-next/aftersales-reextract-20261015')
EVIDENCE=Path('v2/data/evidence/knowledge-source-batch-20261015-aftersales.json')
CACHE=Path('tmp/aftersales-reextract-20261015')
PLACEHOLDER=re.compile(r'^\s*(?:【.*未.*】|无|暂无|未提供|待补充|N/?A)\s*$',re.I)
ACTION=r'检查|确认|核对|查看|检测|测试|观察|测量|对比|查询|读取|排查|采用测试工具|关闭|开启|调整|调试|调节|调换|微调|发送|重发|交叉|给|使用|用|设置|修改|更改|改用|改|切换|降低|提高|重启|重新|断开|拔掉|插拔|连接|导入|加载|升级|降级|烧录|更换|换掉|换|复位|截图|加一张|增加一张|恢复出厂|格式化|删除'
VERBS=re.compile(ACTION)
RESTRICTED=re.compile(r'升级|降级|烧录|刷机|恢复出厂|复位|格式化|删除|更换|换掉|换网线|换线|加一张|增加一张|断电|拆机|(?:使用|改用|换).{0,6}排线|root\b|\badb\b',re.I)
CONDITION=re.compile(r'如果|假如|若|仅当|只有|前提|确认.{0,30}后|还未|未达到|无问题后|没问题后|根据|针对')
HISTORY=re.compile(r'未解决|无效|无效果|没有改善|没有变化|无实际变化|还是一样|依旧|仍然|无法完全改善|已解决|恢复正常|解决了|升级后|更换后|调试后|调整后|处理后|可以正常|后解决|后为解决|就出现|那.{0,8}解决不了|画.{0,8}正常|改动了|发现|一切正常|没改善|没有太多变化|无变化|有改善|显示正常')
STEP_START=re.compile(r'^(?:(?:\d+|[一二三四五六七八九十]+)[、.)）:：]\s*)?(?:(?:请|先|再|可|可以|建议|让客户|让用户|让现场|需要|需|可通过|可以通过|通过|尽量|尝试|单独)\s*)?(?:'+ACTION+r')')
SECTION_START=re.compile(r'(?:排查(?:步骤|过程|方法)?|解决(?:方法|方案|措施)?|优化方案|处理方法|操作(?:步骤|方法)?|方法)[：:]')
SECTION_STOP=re.compile(r'^(?:问题现象|现象|产生.*原因|原因|最终原因|研发跟进|处理结果|结果|日期|版本|现场环境|模组信息|芯片|备注|注意事项)[：:]')

def digest(b):return hashlib.sha256(b).hexdigest()
def norm(text):return ''.join(ch.lower() for ch in str(text or '') if not ch.isspace())
def mapped_norm(text):
    chars=[];offsets=[]
    for i,ch in enumerate(text):
        if not ch.isspace():chars.append(ch.lower());offsets.append(i)
    return ''.join(chars),offsets
def find_span(text,needle):
    hay,positions=mapped_norm(text);q=norm(needle)
    at=hay.find(q)
    if not q or at<0:return None
    return positions[at],positions[at+len(q)-1]+1
def dump(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def valid_text(s):return isinstance(s,str) and len(s.strip())>2 and not PLACEHOLDER.fullmatch(s)

def read_document(path):
    raw=path.read_bytes();sha=digest(raw);cache=CACHE/(sha+'.json')
    if cache.exists():data=json.loads(cache.read_text(encoding='utf8'));paragraphs=data['paragraphs']
    else:
        paragraphs=[]
        with zipfile.ZipFile(path) as z:
            root=ET.fromstring(z.read('word/document.xml'))
            for i,p in enumerate(root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'),1):
                text=''.join(x.text or '' for x in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')).strip()
                if text:paragraphs.append({'locator':'word/document.xml paragraph '+str(i),'text':text})
        dump(cache,{'path':str(path),'sha256':sha,'paragraphs':paragraphs})
    text='\n'.join(p['text'] for p in paragraphs);position=0;spans=[]
    for p in paragraphs:spans.append((position,position+len(p['text']),p['locator']));position+=len(p['text'])+1
    ai=bool(re.search(r'豆包|由.{0,12}AI生成|AI生成|ChatGPT生成|人工智能生成',text[:3000]))
    return {'path':str(path),'name':path.name,'sha256':sha,'text':text,'norm':norm(text),'paragraphs':paragraphs,'spans':spans,'sourceType':'ai_summary' if ai else 'engineering','sourceTypeBasis':'provided internal experience document; authorship not independently certified' if not ai else 'explicit AI-generation text marker'}

def locate(case,raw,documents):
    excerpt=case.get('sourceExcerpt') or '';q=norm(excerpt)
    if len(q)<30:return {'status':'index-only','matches':[],'fragments':[]}
    hits=[]
    for d in documents:
        at=d['norm'].find(q)
        if at<0:continue
        start,end=find_span(d['text'],excerpt)
        hits.append({'document':d,'start':start,'end':end,'excerpt':d['text'][start:end],'locator':' / '.join(dict.fromkeys(p[2] for p in d['spans'] if p[0]<end and p[1]>start)),'verificationScope':'full existing record excerpt literally present; not field-effect verification'})
    if hits:return {'status':'full-original-record','matches':hits,'fragments':[]}
    # Fragment-only matches never borrow neighbouring paragraphs as case steps.
    lines=[s.strip() for s in excerpt.splitlines() if 20<=len(norm(s))<=1800 and not SECTION_START.fullmatch(s)]
    original_name=(raw.get('source') or {}).get('fileName','')
    fragments=[]
    for d in documents:
        if original_name and d['name']!=original_name and not ('云平台' in d['name'] and '云平台' in original_name):continue
        for line in sorted(lines,key=lambda s:len(norm(s)),reverse=True):
            sp=find_span(d['text'],line)
            if sp:
                start,end=sp
                fragments.append({'document':d,'start':start,'end':end,'excerpt':d['text'][start:end],'locator':' / '.join(dict.fromkeys(p[2] for p in d['spans'] if p[0]<end and p[1]>start)),'verificationScope':'fragment only; does not establish full record, surrounding conditions or outcome'})
                break
    return {'status':'partial-original-record' if fragments else 'index-only','matches':[],'fragments':fragments}

def split_clauses(text,start,end):
    """Exact slices; split sentence/semicolon or clear action boundaries, keep comma conditions intact."""
    segment=text[start:end];boundaries=[0];depth=0
    for i,ch in enumerate(segment):
        if ch in '（([':depth+=1
        elif ch in '）)]':depth=max(0,depth-1)
        if depth==0 and ch in '。；;\n' and i+1<len(segment):boundaries.append(i+1)
        elif depth==0 and ch in '，,' and i+1<len(segment):
            suffix=segment[i+1:]
            # Do not detach an action from its preceding prerequisite or a failed-result continuation.
            prefix=segment[boundaries[-1]:i]
            if re.match(r'(?:确认|采用测试工具|检查|核对|查看|还未达到|如果|假如|若|发现|一切正常)',suffix) and not re.search(r'后\s*$',prefix):boundaries.append(i+1)
    boundaries.append(len(segment));out=[]
    for a,b in zip(boundaries,boundaries[1:]):
        piece=segment[a:b];left=len(piece)-len(piece.lstrip());right=len(piece.rstrip(' \t\n，,；;。'))
        a+=left;b=a-left+right
        if b>a:out.append((start+a,start+b))
    return out

def extract_actions(text,raw):
    regions=[]
    # Explicit troubleshooting is usable as an indexed sequence only when literally present.
    check=raw.get('troubleshooting','')
    if valid_text(check):
        sp=find_span(text,check)
        if sp:regions.append((*sp,'explicit-troubleshooting'))
    # Extract source-labelled procedure sections; a cause or solution summary is not itself a check.
    offset=0;active=None
    for line in text.splitlines(keepends=True):
        clean=line.strip();label=SECTION_START.search(line)
        if label:
            active=offset+label.end()
            if active<offset+len(line):regions.append((active,offset+len(line),'source-labelled-procedure'))
        elif SECTION_STOP.match(clean):active=None
        elif active is not None and clean:regions.append((offset,offset+len(line),'source-labelled-procedure'))
        offset+=len(line)
    # The original explicit solution field may be a single instruction without a heading.
    solution=raw.get('solution','')
    if valid_text(solution):
        sp=find_span(text,solution)
        if sp:regions.append((*sp,'explicit-historical-solution'))
    steps=[];restricted=[];history=[];seen=set()
    for start,end,origin in regions:
        # Remove a prose introduction before an explicit procedure heading.
        label=SECTION_START.search(text[start:end])
        if label:start+=label.end()
        for a,b in split_clauses(text,start,end):
            phrase=text[a:b];label=SECTION_START.search(phrase)
            if label:a+=label.end();phrase=text[a:b].strip();a=text.find(phrase,a,b)
            if not phrase or not VERBS.search(phrase) or norm(phrase) in seen:continue
            # Avoid converting narrative, a cause, or a question into an instruction.
            directive=re.search(r'可通过[^，。；\n]{0,30}(?:检查|查看|核对|检测|查询|读取)',phrase)
            if directive and not STEP_START.match(phrase):
                a+=directive.start();phrase=text[a:b]
            context_inspection=bool(origin=='explicit-troubleshooting' and re.match(r'^(?:电脑|HDSet|HDPlayer|接收卡|控制卡|处理器|软件)',phrase,re.I) and re.search(r'检查|查看|核对|检测|查询|读取|测试',phrase))
            explicit=bool(STEP_START.match(phrase) or directive or context_inspection or (CONDITION.match(phrase) and re.search(r'(?:则|可以|可|需|请|建议|通过|后[，,]可|异常)'+r'.{0,6}(?:'+ACTION+r')',phrase)))
            if not explicit:
                # Keep narrated tests and context as searchable experience, not executable commands.
                if origin=='explicit-troubleshooting' and norm(phrase) not in seen:
                    seen.add(norm(phrase));history.append({'text':phrase,'span':{'start':a,'end':b},'origin':origin,'historicalResult':'unknown','reason':'narrated check or context; literal wording retained without inventing an imperative or outcome'})
                continue
            seen.add(norm(phrase));record={'text':phrase,'span':{'start':a,'end':b},'origin':origin,'requiresConditionConfirmation':bool(CONDITION.search(phrase)),'historicalResult':'unknown'}
            if RESTRICTED.search(phrase):record['reason']='hardware/firmware/destructive action requires independent applicability evidence';restricted.append(record)
            elif re.search(r'如下图|如图|见图|下图|如下软件|参数文件|调试好的参数|寄存器|降低.{0,8}电压',phrase):record['reason']='referenced image/file or electrical/register settings require separate evidence';restricted.append(record)
            elif HISTORY.search(phrase) and not CONDITION.match(phrase):
                historical=copy.deepcopy(record);historical['reason']='historical observation, not a proven future outcome';history.append(historical)
                mark=HISTORY.search(phrase);prefix=phrase[:mark.start()].rstrip('，,；; ')
                # A literal action prefix can be a verification step, but the old outcome is separate.
                if len(prefix)>=4 and STEP_START.match(prefix) and VERBS.search(prefix):
                    record['text']=prefix;record['span']['end']=a+len(prefix)
                    record['historicalObservation']={'text':phrase,'span':{'start':a,'end':b},'result':'fail' if re.search(r'未|无效|无效果|没|一样|依旧|仍然',phrase[mark.start():]) else 'pass' if re.search(r'正常|解决|改善',phrase[mark.start():]) else 'unknown'}
                    record['historicalResult']=record['historicalObservation']['result'];record['actionType']='historical-action-to-recheck';record['requiresConditionConfirmation']=True;steps.append(record)
            else:
                readonly=bool(re.match(r'^(?:(?:\d+)[、.)）]\s*)?(?:请|先|再|可|让客户|让用户)?(?:检查|确认|核对|查看|检测|测试|观察|测量|对比|查询|读取|采用测试工具)',phrase) or directive)
                mixed_action=bool(re.search(r'(?:后[，,]?|[，,；;]|并|再)(?:请|可|可以|先|再|尝试)?(?:调试|调整|设置|修改|开启|关闭|更改|降低|提高|导入|加载|发送|重启)',phrase))
                record['actionType']='observation' if readonly and not mixed_action else 'conditional-operation'
                # Every operation needs an explicit prerequisite confirmation; don't infer missing scope.
                record['requiresConditionConfirmation']=record['requiresConditionConfirmation'] or record['actionType']!='observation'
                steps.append(record)
    # A later action cannot silently skip a blocked earlier upgrade or unidentified parameter file.
    clean=[]
    for step in sorted(steps,key=lambda s:s['span']['start']):
        prior=[r for r in restricted if r['span']['start']<step['span']['start']]
        if prior and step['actionType']!='observation':
            step['reason']='depends on preceding restricted operation; do not bypass its prerequisite'
            step['blockedBy']=[r['span'] for r in prior];restricted.append(step)
        else:clean.append(step)
    return {'steps':clean,'restrictedActions':sorted(restricted,key=lambda r:r['span']['start']),'historicalActions':history}

def scope_evidence(case,text):
    """Keep existing fields; only add explicitly labelled module information, never mine cause prose."""
    scope=copy.deepcopy(case.get('scope')or{})
    for key in ['chips','pitches','scans','softwareVersions','firmwareVersions']:scope.setdefault(key,[])
    additions={};lines=[]
    for line in text.splitlines():
        if re.match(r'^\s*(?:模组信息|模组参数|芯片|驱动芯片|扫描方式|模组规格|适用条件)[：:]',line):lines.append(line)
    for line in lines:
        for field,pattern in [('chips',r'(?<![A-Z0-9])(?:ICND|ICN|FM|SM|MBI|LS)\d+[A-Z0-9]*\b'),('pitches',r'(?<![A-Z0-9])P\d+(?:\.\d+)?\b'),('scans',r'(?<![A-Z0-9])\d+S\b')]:
            for value in re.findall(pattern,line,re.I):
                if value not in scope[field]:scope[field].append(value);additions.setdefault(field,[]).append({'value':value,'sourceLine':line})
    if lines:
        scope['additionalConditions']=list(dict.fromkeys(scope.get('additionalConditions',[])+lines))
    unsupported={k:[v for v in vals if norm(v) not in norm(text)] for k,vals in scope.items() if isinstance(vals,list)}
    return scope,additions,{k:v for k,v in unsupported.items() if v}

def required_scope(step):
    """Information needed for this action, not a universal all-fields gate."""
    text=step['text'];fields=[]
    if step.get('actionType')=='observation':return fields
    if re.search(r'接收卡|控制卡|处理器|固件|网口|寄存器|DCLK|脉宽|扫描|消隐|鬼影|电压|更换|加一张',text,re.I):fields.append('modelIds')
    if re.search(r'升级|降级|烧录|刷机|固件',text):fields.append('firmwareVersions')
    if re.search(r'DCLK|脉宽|消隐|鬼影|寄存器',text,re.I):fields.extend(['chips','scans'])
    if re.search(r'软件版本|HDSet|HDPlayer|ToolBox',text,re.I):fields.append('softwareVersions')
    return list(dict.fromkeys(fields))

def run():
    CACHE.mkdir(parents=True,exist_ok=True);REPORT.mkdir(parents=True,exist_ok=True)
    base_bytes=BASE.read_bytes();base=json.loads(base_bytes);old_manifest=Path('v2/data/knowledge-next/candidate-manifest.json').read_bytes();active_manifest=Path('v2/data/knowledge/active-manifest.json').read_bytes()
    source_files=sorted({c['sourceReference']['file'] for c in base['cases']});indexes={};index_hash={}
    for file in source_files:
        data=Path(file).read_bytes();index_hash[file]=digest(data);raw=json.loads(data.decode('utf-8-sig'));indexes[file]={c['id']:c for c in raw.get('cases',[])+raw.get('entries',[]) if c.get('id')}
    baseline={'knowledgeFile':str(BASE),'knowledgeSHA256':digest(base_bytes),'candidateManifestSHA256':digest(old_manifest),'activeManifestSHA256':digest(active_manifest),'cases':len(base['cases']),'products':len(base['products']),'casesWithChecks':sum(bool(c['checks']) for c in base['cases']),'checks':sum(len(c['checks']) for c in base['cases']),'workflowNodes':sum(len(c.get('workflow',{}).get('nodes',[])) for c in base['cases']),'indexHashes':index_hash,'scope':'offline isolated aftersales extraction; original candidate, active and runtime unchanged'}
    baseline_path=REPORT/'修改前基线.json'
    if baseline_path.exists() and json.loads(baseline_path.read_text(encoding='utf8'))!=baseline:raise ValueError('Baseline changed; use a new audit directory')
    dump(baseline_path,baseline)
    paths=list(Path('authorized-resources').glob('*.docx'))+list(Path('authorized-resources/engineering').glob('*问题*分享.docx'))
    documents=[read_document(p) for p in paths]
    evidence={'purpose':'literal evidence for re-extracting existing cases only; not new hardware or official product rules','documents':[{'name':d['name'],'originalPath':d['path'],'sha256':d['sha256'],'format':'.docx','sourceType':d['sourceType'],'verificationStatus':'reference_only','sourceTypeBasis':d['sourceTypeBasis'],'pages':[{'page':None,'locator':p['locator'],'text':p['text']} for p in d['paragraphs']]} for d in documents]}
    dump(EVIDENCE,evidence);bundle_ref={'file':str(EVIDENCE).replace('\\','/'),'sha256':digest(EVIDENCE.read_bytes())}
    next_data=copy.deepcopy(base);audits=[];counts=collections.Counter();file_counts=collections.defaultdict(collections.Counter);changed_ids=[]
    for original,case in zip(base['cases'],next_data['cases']):
        ref=case.get('sourceReference')or{};raw=indexes.get(ref.get('file'),{}).get(case['originalId'])
        index_valid=bool(raw and index_hash.get(ref.get('file'))==ref.get('sha256'))
        raw=raw or {};match=locate(case,raw,documents)
        full=(match['matches'] or [None])[0];working_text=full['excerpt'] if full else case.get('sourceExcerpt')or''
        indexed_field_additions=[]
        if not full and index_valid:
            # Preserve explicit saved fields that the old sourceExcerpt projection omitted.
            # These remain index evidence, never promoted to an independently verified original.
            for field,label in [('troubleshooting','排查'),('solution','解决方案')]:
                value=raw.get(field)
                if valid_text(value) and find_span(working_text,value) is None:
                    working_text+='\n'+label+'：'+value
                    indexed_field_additions.append({'field':field,'text':value,'origin':'saved-index-field-not-original-verified'})
        extraction=extract_actions(working_text,raw)
        # All slices must be literal in the selected record, including index-only candidates.
        for item in extraction['steps']+extraction['restrictedActions']+extraction['historicalActions']:
            a,b=item['span']['start'],item['span']['end']
            if working_text[a:b]!=item['text']:raise ValueError('Nonliteral span '+case['legacyId'])
        scope,scope_added,scope_unsupported=scope_evidence(case,working_text)
        no_checks_with_steps=not original['checks'] and bool(extraction['steps'])
        monolithic=any(len(ch['text'])>140 and len(VERBS.findall(ch['text']))>=3 for ch in original['checks'])
        original_source=(raw.get('source')or{}).get('fileName')or'[未记录文件名]'
        absent_scope=[key for key in ['chips','pitches','scans','softwareVersions','firmwareVersions'] if not scope.get(key)]
        if not case.get('modelIds'):absent_scope.append('modelIds')
        requirements=[]
        for step in extraction['steps']+extraction['restrictedActions']:
            fields=required_scope(step);step['requiredParameters']=fields
            requirements.extend(fields)
        missing_scope=[key for key in dict.fromkeys(requirements) if not (case.get('modelIds') if key=='modelIds' else scope.get(key))]
        c_refs=case.get('sourceReferences') or [case['sourceReference']]
        newrefs=[]
        for hit in match['matches']+match['fragments']:
            d=hit['document'];newrefs.append({**bundle_ref,'originalPath':d['path'],'originalName':d['name'],'originalSha256':d['sha256'],'locator':hit['locator'],'excerpt':hit['excerpt'],'sourceType':d['sourceType'],'verificationStatus':'verified_by_case' if full and hit in match['matches'] and d['sourceType']!='ai_summary' else 'reference_only','verificationScope':hit['verificationScope']})
        if index_valid:
            # Re-extract all existing records; index-only checks explicitly retain weaker provenance.
            case['checks']=[]
            for step in extraction['steps']:
                proof_hash=full['document']['sha256'] if full else ref['sha256']
                check_id='check-'+digest((case['stableId']+'|'+proof_hash+'|'+str(step['span']['start'])+'|'+step['text']).encode())[:24]
                field=next((key for key in ['troubleshooting','solution','sourceExcerpt'] if norm(step['text']) in norm(raw.get(key,''))),None)
                proof=newrefs[0] if full else {**ref,'supportedField':field,'verificationScope':'literal saved index field; original source not independently verified'}
                case['checks'].append({'checkId':check_id,'text':step['text'],'verificationStatus':'literal-original-supported' if full else 'literal-index-supported-not-original-verified','sourceSpan':step['span'],'sourceSpanBasis':'workflow.evidenceText','sourceReference':proof,'actionType':step['actionType'],'requiredParameters':step['requiredParameters'],'requiresConditionConfirmation':step['requiresConditionConfirmation'],**({'historicalObservation':step['historicalObservation']} if 'historicalObservation' in step else {})})
            nodes=[{**ch,'parentCheckId':ch['checkId'],'historicalResult':extraction['steps'][i]['historicalResult'],'requiresConditionConfirmation':ch['requiresConditionConfirmation'],'nextCheckId':case['checks'][i+1]['checkId'] if i+1<len(case['checks']) else None} for i,ch in enumerate(case['checks'])]
            # All experience is retained in the existing workflow container. Only nodes are executable.
            # Existing readers ignore these optional collections, so no old interface changes are needed.
            case['workflow']={'version':'literal-record-actions-1','nodes':nodes,
                'restrictedNodes':[dict(item,sourceReference=newrefs[0] if full else ref,executionStatus='blocked-pending-applicability') for item in extraction['restrictedActions']],
                'historicalObservations':[dict(item,sourceReference=newrefs[0] if full else ref,executionStatus='historical-observation-not-an-instruction') for item in extraction['historicalActions']],
                'legacyChecksForReview':copy.deepcopy(original['checks']),
                'provenanceLevel':'original-record-literal' if full else 'saved-index-only',
                'evidenceText':working_text,
                'evidenceTextPolicy':'Exact original excerpt, or saved index text with labelled explicit fields. Labels organise fields only; no generated engineering facts.',
                'policy':'Only nodes may be considered for scoped verification. Restricted nodes require separate evidence. Historical outcomes are not promises. Customer activation policy still applies.'}
            if full:case['scope']=scope
            case['missingEvidence']=None if case['checks'] else 'no-safe-executable-action-extracted; inspect restricted/historical actions in audit'
            if full:
                if case.get('verificationStatus')!='reference_only' and full['document']['sourceType']!='ai_summary':case['verificationStatus']='verified_by_case'
                case['sourceType']=full['document']['sourceType']
        if newrefs:
            case['sourceReferences']=c_refs+newrefs
            if not full and case.get('verificationStatus') not in ['verified','verified_by_case']:case['verificationStatus']='reference_only'
        counts[match['status']]+=1;file_counts[original_source][match['status']]+=1
        for key,flag in [('index-unverifiable',not index_valid),('old-empty-checks-with-extractable-actions',no_checks_with_steps),('old-monolithic-check',monolithic),('scope-needs-followup',bool(missing_scope)),('existing-scope-not-literal-in-record',bool(scope_unsupported)),('restricted-actions-present',bool(extraction['restrictedActions']))]:
            if flag:counts[key]+=1;file_counts[original_source][key]+=1
        if case!=original:changed_ids.append(case['legacyId'])
        audits.append({'legacyId':case['legacyId'],'stableId':case['stableId'],'originalId':case['originalId'],'indexReference':ref,'indexChecksumVerified':index_valid,'expectedOriginalFile':original_source,'originalRecordLocator':raw.get('source'),'originalCoverage':match['status'],'originalReferences':newrefs,'oldCheckCount':len(original['checks']),'newCheckCount':len(case['checks']),'oldWorkflowNodes':len(original.get('workflow',{}).get('nodes',[])),'candidateWorkflowNodes':len(case.get('workflow',{}).get('nodes',[])),'oldMonolithicCheck':monolithic,'omittedExtractableActions':no_checks_with_steps,'absentScopeFields':absent_scope,'missingScopeFields':missing_scope,'scopeAdditions':scope_added,'scopeNotLiteral':scope_unsupported,'caseVerificationBefore':original.get('verificationStatus','unknown'),'caseVerificationAfter':case.get('verificationStatus','unknown'),'evidenceText':working_text,'indexedFieldAdditions':indexed_field_additions,'legacyChecks':original['checks'],'extraction':extraction,'candidateChecksChanged':original['checks']!=case['checks'],'requiresOriginal':not bool(full),'nextConditions':['核对型号及本步骤必要前提，不要求无关芯片/扫描字段一律齐全','补原件缺页/图片条件或实际反馈；不得用相似案例补步骤']+(['核对原始文件：'+original_source] if not full else [])})
    # A new branch, not a switch of shared candidate or active manifest.
    if bundle_ref not in next_data['sources']:next_data['sources'].append(bundle_ref)
    next_data.setdefault('buildProvenance',[]).append({'file':'v2/tools/reextract-aftersales.py','sha256':digest(Path(__file__).read_bytes())})
    encoded=(json.dumps(next_data,ensure_ascii=False,indent=2)+'\n').encode();snapshot_hash=digest(encoded);version='knowledge-'+snapshot_hash[:16]
    dest=BRANCH/version/'index.json';dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists() and dest.read_bytes()!=encoded:raise ValueError('Candidate collision')
    dest.write_bytes(encoded)
    counts_after={'products':len(next_data['products']),'cases':len(next_data['cases']),'sourceSupportedChecks':sum(bool(c['checks']) for c in next_data['cases']),'sourceSupportedSolutions':sum(bool(c['historicalSolution']) for c in next_data['cases']),'rejectedDocuments':len(next_data['rejectedDocuments'])}
    manifest={'versionId':version,'sha256':snapshot_hash,'counts':counts_after,'parentVersion':'knowledge-fc9f11a1e72de750','parentSHA256':digest(base_bytes),'activated':False,'purpose':'isolated aftersales re-extraction candidate, not business acceptance or activation'}
    dump(BRANCH/'candidate-manifest.json',manifest)
    unchanged={key:base[key]==next_data[key] for key in base if key not in ['cases','sources','buildProvenance']}
    if not all(unchanged.values()):raise ValueError('Non-aftersales knowledge changed')
    if Path('v2/data/knowledge-next/candidate-manifest.json').read_bytes()!=old_manifest or Path('v2/data/knowledge/active-manifest.json').read_bytes()!=active_manifest or BASE.read_bytes()!=base_bytes:raise ValueError('Original baseline changed')
    summary={'cases':len(audits),'counts':dict(counts),'byOriginalFile':{k:dict(v) for k,v in file_counts.items()},'candidate':manifest,'changedCaseCount':len(changed_ids),'changedCaseIds':changed_ids,'oldCasesWithChecks':baseline['casesWithChecks'],'newCasesWithChecks':counts_after['sourceSupportedChecks'],'oldCheckCount':baseline['checks'],'newCheckCount':sum(len(c['checks']) for c in next_data['cases']),'oldWorkflowNodes':baseline['workflowNodes'],'newWorkflowNodes':sum(len(c.get('workflow',{}).get('nodes',[])) for c in next_data['cases']),'fullOriginalSafeChecks':sum(len(c['checks']) for c,a in zip(next_data['cases'],audits) if a['originalCoverage']=='full-original-record'),'structuredRestrictedActions':sum(len(c.get('workflow',{}).get('restrictedNodes',[])) for c in next_data['cases']),'structuredHistoricalObservations':sum(len(c.get('workflow',{}).get('historicalObservations',[])) for c in next_data['cases']),'preservedLegacyChecks':sum(len(c.get('workflow',{}).get('legacyChecksForReview',[])) for c in next_data['cases']),'nonAftersalesFieldsUnchanged':unchanged,'referenceOnlyPromoted':sum(o.get('verificationStatus')=='reference_only' and n.get('verificationStatus')!='reference_only' for o,n in zip(base['cases'],next_data['cases'])),'caseIdsAndOrderUnchanged':all(o['stableId']==n['stableId'] and o['legacyId']==n['legacyId'] for o,n in zip(base['cases'],next_data['cases'])),'sharedCandidateAndActiveUnchanged':True,'evidenceDocuments':[{k:d[k] for k in ['path','sha256','sourceType']} for d in documents]}
    dump(REPORT/'全库审计.json',{'summary':summary,'cases':audits});dump(REPORT/'前后对比.json',summary)
    with (REPORT/'逐案例审计.csv').open('w',encoding='utf-8-sig',newline='') as f:
        fields=['legacyId','originalId','expectedOriginalFile','originalCoverage','indexChecksumVerified','oldCheckCount','newCheckCount','oldMonolithicCheck','omittedExtractableActions','missingScopeFields','caseVerificationAfter']
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for a in audits:w.writerow({k:json.dumps(a[k],ensure_ascii=False) if isinstance(a[k],(dict,list)) else a[k] for k in fields})
    report(summary,audits)
    print(json.dumps({k:v for k,v in summary.items() if k not in ['changedCaseIds','evidenceDocuments']},ensure_ascii=False,indent=2))

def report(s,rows):
    lines=['# 现有2231条售后案例重提炼审计','', '本轮只审计和重提炼既有案例，使用用户本次提供的本机资料。保留原知识、产品、配单、架构和客户启用策略，不切换共享candidate或active，不修改试运行或现网。','', '## 原始来源覆盖','', '|原始资料|完整摘录匹配|仅片段匹配|只有旧索引|','|---|---:|---:|---:|']
    for name,n in s['byOriginalFile'].items():lines.append(f'|{name}|{n.get("full-original-record",0)}|{n.get("partial-original-record",0)}|{n.get("index-only",0)}|')
    lines+=['','## 实际问题','']+[f'- {key}：{n}条。' for key,n in s['counts'].items()]
    lines+=['','“索引有效”只表示记录仍能在旧结构化JSON中定位并且哈希一致。“完整原件匹配”只证明本次DOCX原文含现有摘录，不等于原文件是官方参数、现场修复已独立验证或方案可通用于其他型号。片段不借相邻案例填步骤。少于30个规范化字符的短摘录不按完整案例确认，避免将一句通用话当完整证据。', '', '## 提炼前后','',f'- 有checks的案例：{s["oldCasesWithChecks"]} → {s["newCasesWithChecks"]}。',f'- checks条数：{s["oldCheckCount"]} → {s["newCheckCount"]}；workflow节点：{s["oldWorkflowNodes"]} → {s["newWorkflowNodes"]}。',f'- 原件完整匹配范围内可安全提炼步骤：{s["fullOriginalSafeChecks"]}条。',f'- 另外结构化保存受限动作{s["structuredRestrictedActions"]}条、历史观察{s["structuredHistoricalObservations"]}条、旧checks{s["preservedLegacyChecks"]}条供审查，均在新候选的cases[].workflow内，未丢弃经验。',f'- 实际变化案例：{s["changedCaseCount"]}；reference_only升级：{s["referenceOnlyPromoted"]}。','- 这些是离线数据覆盖指标，不能当成故障解决率。涉及固件/硬件更换/破坏性动作单独列为受限历史动作，不放入可执行checks。','- 条件缺失按步骤所需信息判定；基础只读检查不一律要求芯片、扫描和固件齐全。单纯字段为空不等于案例无价值。','', '## 例子','']
    for id in ['AS-0223','AS-0132','AS-0306','AS-0001']:
        a=next(a for a in rows if a['legacyId']==id);lines += [f'### {id}', '',f'原件状态：{a["originalCoverage"]}；checks {a["oldCheckCount"]} → {a["newCheckCount"]}。']
        lines += ['- '+c['text'] for c in a['extraction']['steps']]
        lines += ['- 受限不执行：'+c['text'] for c in a['extraction']['restrictedActions']]
    lines+=['', '## 候选与回退','',f'候选：{s["candidate"]["versionId"]}。位置：`{BRANCH}`。只可显式加载此目录下candidate-manifest.json进行开发验证。', '默认candidate-manifest和active-manifest均未修改；旧knowledge-fc9f11a1e72de750保留。回退只需继续加载原目录，无需删除资料或恢复生产。','', '本轮未修改案例启用门槛，也不宣称候选案例已对客户开放。参数前提不全继续追问，reference_only仍不能成为确定方案。','', '## 下一步','', '按本次逐案例失败清单核对受限动作所需的型号、版本和图片条件；不随机扫描或新增FAQ。缺少的2025现场问题工作簿和7月PPT原件列明，保存的索引摘录仍保留价值，不作无效案例删除。']
    (REPORT/'审计与候选说明.md').write_text('\n'.join(lines),encoding='utf8')

if __name__=='__main__':run()
