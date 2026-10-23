"""Field projections over literal FAQ rows and single source cases, not diagnoses."""
import re
import zipfile
from xml.etree import ElementTree
import engine
import proximity

CHIP = re.compile(r'(?<![A-Z0-9])(?:ICN|IC|SM|FM|LS|DP|MBI|TC|RUL|RUC)\d{3,6}[A-Z0-9]*(?![A-Z0-9])', re.I)


def docx_headings(path):
    """Direct Word paragraph formatting; no OCR or interpretation of images."""
    ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    attr='{'+ns['w']+'}val'
    with zipfile.ZipFile(path) as package:
        if package.getinfo('word/document.xml').file_size>30_000_000:
            raise ValueError('word-structure-budget-exceeded')
        document=ElementTree.fromstring(package.read('word/document.xml'))
    found, paragraph = set(), 0
    nodes=list(document.find('w:body',ns))
    for index,node in enumerate(nodes):
        if node.tag!='{'+ns['w']+'}p':
            continue
        paragraph+=1
        text=''.join(x.text or '' for x in node.iter() if x.tag=='{'+ns['w']+'}t').strip()
        outline=node.find('w:pPr/w:outlineLvl',ns)
        if outline is not None and int(outline.get(attr,'9'))<9:
            found.add(paragraph)
            continue
        if not 5<=len(text)<=180 or re.fullmatch(r'[A-Za-z0-9._+/-]+',text):
            continue
        title=re.sub(r'^\d+(?:\.\d+)*[、.．]?\s*','',text)
        if re.match(r'^(?:解决方法|解决办法|处理方法|问题原因|原因分析|注意事项|操作步骤|问题现象|模组信息|设备信息|使用|打开|点击|选择|勾选|进入|设置|检查|确认|观察|替换|断电|重启|导入|建议|将|把|调节|调整|修改|关闭|开启|先|再|然后)',title):
            continue
        bold=0
        for run in node.findall('w:r',ns):
            value=''.join(x.text or '' for x in run.findall('w:t',ns))
            marker=run.find('w:rPr/w:b',ns)
            if marker is not None and marker.get(attr,'true') not in ('false','0'):
                bold+=len(value)
        style=node.find('w:pPr/w:pStyle',ns)
        numbered=bool(re.match(r'^\d+[、.．]',text))
        # A native list item followed by an explicit solution is one case,
        # unlike a numbered remedy inside the preceding case.
        following=[]
        for next_node in nodes[index+1:index+5]:
            value=''.join(x.text or '' for x in next_node.iter() if x.tag=='{'+ns['w']+'}t').strip()
            if value:following.append(value)
        native_case=node.find('w:pPr/w:numPr',ns) is not None and following and re.match(r'^(?:解决方法|解决办法|处理方法)\s*[:：]',following[0])
        if native_case or (bold>=len(text)*.6 and (numbered or text.endswith(('：',':')) or re.search(r'问题|异常|现象',title))) or style is not None and re.search('heading|标题',style.get(attr,''),re.I):
            found.add(paragraph)
    return found


def compact(value):
    return re.sub(r'\s+', '', value or '').upper()


def module_facts(text):
    # Only literal module descriptions. P2.5 alone is a pitch, not a unique model.
    text = text or ''
    labelled = re.search(r'(?:模组型号|灯板型号)\s*[:：]\s*([^\n，,；;]{1,80})', text)
    description = re.search(r'([^\n，,；;：:]{0,30}?P\s*\d+(?:\.\d+)?\s*(?:\d+\s*[sS扫])?\s*模组)', text, re.I)
    source = labelled[1] if labelled else description[1] if description else text
    pitch = re.search(r'(?<![A-Z0-9])P\s*(\d+(?:\.\d+)?)(?![\d.])', source, re.I)
    scan = re.search(r'(?<![A-Z0-9])(\d{1,3})\s*(?:S|扫)(?![A-Z0-9])', source, re.I)
    if labelled and not re.fullmatch(r'\s*P\s*\d+(?:\.\d+)?\s*', labelled[1], re.I):
        identity = compact(labelled[1])
    elif description and pitch and scan:
        before = re.split(r'P\s*\d', description[1], maxsplit=1, flags=re.I)[0].strip()
        # Generic location/usage phrases do not identify a module manufacturer.
        brand = before if before and not re.search(r'模组|户外|户内|室内|室外|使用|这个|那个|客户|采用|现场|请问', before) else None
        identity = compact(brand + '|P' + pitch[1] + '|' + scan[1] + 'S') if brand else None
    else:
        identity = None
    return {'identity': identity, 'description': source.strip() if labelled or description else None,
            'pitch': 'P'+pitch[1] if pitch else None, 'scan': scan[1]+'S' if scan else None,
            'identityBasis': 'literal-labelled-model' if identity and labelled else 'literal-brand-pitch-scan' if identity else 'insufficient-module-identity'}


def case_fields(text):
    split = re.search(r'(?:解决方法|解决办法|处理方法|解决方案|处理措施)\s*[:：]', text)
    before = text[:split.start()] if split else text
    solution = text[split.start():] if split else ''
    module = module_facts(before)
    module_lines = re.findall(r'(?:模组信息|灯板信息)\s*[:：][^\n]+',before)
    module_information = '\n'.join(module_lines) or module['description'] or ''
    clauses = [c.strip() for c in re.split(r'[，,；;\n]',before) if c.strip() and c.strip() != '|']
    phenomenon = '\n'.join(c for c in clauses if c != module_information and
                            not re.fullmatch(r'[+、/\s芯片]*',CHIP.sub('',c)))
    # Fault+solution remain one source case. Their roles are exposed separately.
    return {'module': module, 'moduleInformation': module_information,
            'chips': sorted({m.upper() for m in CHIP.findall(before)}),
            'phenomenon': phenomenon or before.strip(), 'solution': solution.strip(),
            'outcomeVerified': False, 'notDiagnosis': True}


def compare(query, fields, chips=None):
    wanted = module_facts(query); actual = fields['module']
    matches, missing, conflicts = [], [], []
    if wanted['identity']:
        if not actual['identity']:
            missing.append('module-identity')
        elif wanted['identity'] != actual['identity']:
            conflicts.append('module-identity')
        else:
            matches.append('same-module')
    for field in ('pitch', 'scan'):
        if wanted[field]:
            if not actual[field]:
                missing.append(field)
            elif wanted[field] != actual[field]:
                conflicts.append(field)
            else:
                matches.append(field)
    requested = set(chips or []) | {m.upper() for m in CHIP.findall(query)}
    known = set(fields['chips'])
    if requested:
        if known and not requested.issubset(known):
            conflicts.append('chips')
        elif not known:
            missing.append('chips')
        else:
            matches.append('chips')
    def features(text):
        # Reuse the existing equivalence vocabulary and Chinese FTS n-grams.
        # Similarity is a ranking signal, never a new fault classifier.
        text = CHIP.sub('',text)
        for group in proximity.ALIASES:
            for word in sorted(group,key=len,reverse=True):
                text = re.sub(re.escape(word),group[0],text,flags=re.I)
        return set(engine.fts_tokens(text).split())
    topic = query.replace(wanted['description'] or '\0','')
    qfeatures, actualfeatures = features(topic), features(fields['phenomenon'])
    overlap = qfeatures & actualfeatures
    similarity = len(overlap)/max(1,len(qfeatures))
    unique_model = wanted['identityBasis'] == actual['identityBasis'] == 'literal-labelled-model' and 'same-module' in matches
    return {'score': (100 if 'same-module' in matches else 0) + 10*len(matches) + 3*similarity,
            'matchedFields': matches, 'missingFields': missing, 'conflictingFields': conflicts,
            'symptomSimilarity': round(similarity,4), 'symptomMatchedTokens': sorted(overlap),
            'moduleIdentityConfirmed': unique_model,
            'conditional': bool(missing) or not unique_model, 'notDiagnosis': True}


def faq_columns(header):
    def columns(pattern):
        return [i for i, value in enumerate(header) if re.search(pattern, str(value))]
    return {'question': columns(r'问题内容|问题描述|问题现象|客户问题|^问题$'),
            'site': columns(r'现场|环境|模组|灯板|芯片|设备型号|工况|触发条件'),
            'keywords': columns(r'^关键词$'),
            'answer': columns(r'解决方案|解决方法|解决办法|^答案$|标准答案|处理方法'),
            'historicalAgentOutput': columns(r'输出结果|Agent回答|AI回答')}


def faq_mask(text, cells, columns):
    keep = set(columns['question'] + columns['site'] + columns['keywords'])
    values = [str(cell or '') for cell in cells]
    raw = ' | '.join(values)
    if raw.strip() != text:
        raise ValueError('faq-cell-not-in-literal-row')
    masked = ' | '.join(value if i in keep else ''.join('\n' if c == '\n' else ' ' for c in value) for i, value in enumerate(values))
    left = len(raw)-len(raw.lstrip())
    return masked[left:left+len(text)]


def faq_fields(cells, columns):
    field = lambda key: '\n'.join(str(cells[i] or '') for i in columns.get(key, []) if i < len(cells)).strip()
    answer = field('answer')
    return {'question': field('question'), 'siteInformation': field('site'), 'keywords': field('keywords'),
            'answer': answer, 'historicalAgentOutputIsAnswer': False,
            'resolutionState': 'pending-action' if re.search(r'反馈研发|待研发|待处理|未解决', answer) else 'recorded-unverified',
            'outcomeVerified': False}
