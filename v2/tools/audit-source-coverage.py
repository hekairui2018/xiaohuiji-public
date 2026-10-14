"""Offline, read-only source coverage audit. No network API, source writes or imports.

SMB reads require the existing Windows share authorization. Outputs stay in tmp.
File names are hints only; content evidence never automatically verifies a rule.
"""
import argparse
import collections
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET

PROJECT = Path(__file__).resolve().parents[2]
DOCS = {'.pdf', '.docx', '.pptx', '.3pptx', '.xlsx', '.doc', '.ppt', '.xls', '.wps', '.rtf', '.md', '.txt', '.json', '.csv', '.html', '.htm'}
EXCLUDED = {'.git', 'node_modules', '.Trash', '.C2CUploadTemp', '__pycache__'}


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def extract(path):
    ext = path.suffix.lower()
    if ext == '.pdf':
        from pypdf import PdfReader
        # Read SMB PDFs sequentially before parsing, avoiding thousands of remote seeks.
        reader = PdfReader(io.BytesIO(path.read_bytes()))
        # Coverage triage, not a repeat full-library engineering analysis.
        # Cover/revision/header sampling is explicit; later deep reads are targeted.
        count = len(reader.pages)
        pages = [reader.pages[i].extract_text() or '' for i in range(min(count, 3))]
        text = '\n'.join(pages)
        unmapped = [{'offset': m.start(), 'codeUnit': f'U+{ord(m.group()):04X}'} for m in re.finditer(r'[\ud800-\udfff]', text)]
        # Retain explicit escaped glyphs; never guess the technical character.
        text = re.sub(r'[\ud800-\udfff]', lambda m: '\\u' + f'{ord(m.group()):04x}', text)
        return text, {'pages': count, 'sampledPages': len(pages), 'textPages': sum(bool(t.strip()) for t in pages), 'unmappedCodeUnits': unmapped, 'method': 'pypdf-first-three-pages-triage', 'completeTextExtraction': count <= 3 and not unmapped, 'metadata': {str(k): str(v) for k, v in (reader.metadata or {}).items()}}
    if ext in {'.docx', '.pptx', '.3pptx', '.xlsx'}:
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if (ext == '.docx' and n.startswith('word/') and n.endswith('.xml')) or (ext in {'.pptx', '.3pptx'} and re.fullmatch(r'ppt/slides/slide\d+\.xml', n)) or (ext == '.xlsx' and n.startswith('xl/') and n.endswith('.xml'))]
            text = '\n'.join(' '.join(t.text or '' for t in ET.fromstring(z.read(n)).iter() if t.tag.rsplit('}', 1)[-1] in {'t', 'v'}) for n in sorted(names))
            # Shared strings / cell indices are NOT reconstructed business records.
            return text, {'parts': len(names), 'method': 'ooxml-text-only', 'limitations': 'images/relations/tables-layout-not-verified; xlsx-cell-values-not-resolved'}
    if ext in {'.doc', '.ppt', '.xls', '.wps', '.rtf'}:
        return '', {'method': 'unsupported-legacy-office', 'needsExtraction': True}
    raw = path.read_bytes()
    for encoding in (('utf-16', 'utf-8-sig', 'gb18030') if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else ('utf-8-sig', 'gb18030')):
        try:
            return raw.decode(encoding), {'method': 'text', 'encoding': encoding}
        except UnicodeError:
            pass
    return '', {'method': 'undecodable', 'needsExtraction': True}


def classify(text, name):
    # Claims are candidates, never a proof of manufacturer authorship.
    patterns = {
        'ai': r'(?:本文|本文档|本资料|本报告|本总结|规格书|以下内容|以下分析|来源|生成工具)[^\n。]{0,30}(?:AI|人工智能|大模型|豆包|ChatGPT|Qwen|DeepSeek)[^\n。]{0,12}(?:生成|整理|总结)|(?:豆包|ChatGPT|Qwen|DeepSeek)\s*(?:生成|整理|总结)|(?:AI|人工智能|大模型)\s*(?:生成|整理|总结)的\s*(?:文档|资料|报告|总结|分析)',
        'ai_topic_only': r'豆包|ChatGPT|Qwen|DeepSeek',
        'manufacturer': r'深圳市?灰度科技|Shenzhen\s+Huidu|www\.huidu\.(?:cn|com)|灰度科技有限公司',
        'technical_document': r'规格书|产品说明书|用户手册|User\s+Manual|Specification',
        'engineering': r'现场环境|客户反馈|排查过程|问题现象|研发跟进|处理结果',
        'secondary': r'冻结扫描文件|知识实体：|正文提取：|资料总览|由.+整理生成|自动生成的知识库|^#\s*AI规则库',
    }
    evidence = []
    hits = {}
    for kind, pattern in patterns.items():
        matches = list(re.finditer(pattern, text, re.I))
        hits[kind] = bool(matches)
        for m in matches[:3]:
            evidence.append({'kind': kind, 'offset': m.start(), 'excerpt': text[max(0, m.start()-45):m.end()+100]})
    if hits['ai']:
        category = 'AI生成或整理线索（需原文核验）'
    elif hits['secondary']:
        category = '二次整理资料（AI归属待核实）'
    elif Path(name).suffix.lower() in {'.json', '.md', '.csv'} and (hits['manufacturer'] or hits['engineering']):
        category = '二次整理结构化资料（生成方式待核实）'
    elif hits['manufacturer'] and hits['technical_document']:
        category = '原厂原始资料候选（内容标识待核验）'
    elif hits['engineering']:
        category = '公司工程经验候选（记录归属待核验）'
    else:
        category = '来源不明或证据不足'
    result = {'category': category, 'evidence': evidence, 'filenameHints': re.findall(r'豆包|官方|原版|总结|分析|整理', name), 'authorshipVerified': False}
    if Path(name).suffix.lower() in {'.ppt', '.pptx', '.3pptx'}:
        roles = []
        role_patterns = {
            '官方参数引用候选（需回查原件）': r'规格书|产品参数|技术参数|官方参数|参数来源',
            '工程经验参考': r'现场|故障|排查|调试|售后|技术交流|实操|操作步骤',
            '项目方案经验': r'工程方案|项目案例|应用方案|解决方案|项目实施|拓扑|BOM|配单',
            '宣传资料': r'宣传|推广|营销|发布会|市场分析|产品介绍|商务',
        }
        for label, pattern in role_patterns.items():
            m = re.search(pattern, text, re.I)
            if m:
                roles.append({'type': label, 'offset': m.start(), 'excerpt': text[max(0, m.start()-30):m.end()+80]})
        priority_pattern = r'内部培训|技术培训|岗位培训|培训|工程方案|项目案例|问题分享|技术交流|问题总结|现场|排查|实操'
        content_priority = bool(re.search(priority_pattern, text))
        name_priority = bool(re.search(priority_pattern, name))
        result['presentation'] = {'sourceTypes': roles, 'sourceConfidence': '待核实（不自动赋予官方参数可信性）', 'reviewPriority': '优先核查' if content_priority or name_priority else '常规分类', 'priorityBasis': '正文线索' if content_priority else '文件名线索（不证明来源或价值）' if name_priority else '无明确优先线索', 'knowledgeUse': '经验与方案保留为候选；参数、兼容及固件结论逐条绑定原始证据', 'valueJudgment': '第一轮未判定价值'}
    return result


def strings(value):
    if isinstance(value, dict):
        for key, val in value.items():
            yield from strings(val)
    elif isinstance(value, list):
        for val in value:
            yield from strings(val)
    elif isinstance(value, str):
        yield value


def reference_catalog(knowledge):
    names, hashes = collections.defaultdict(set), collections.defaultdict(set)
    files = list(PROJECT.joinpath('data').glob('*index.json')) + list(PROJECT.joinpath('data').glob('*manifest.json')) + list(PROJECT.joinpath('data/aftersales/sources').glob('*.json'))
    files += list(PROJECT.joinpath('v2/data/evidence').glob('*.json')) + list(PROJECT.joinpath('v2/data').glob('*manifest.json'))
    for source in files:
        try:
            obj = json.loads(source.read_text(encoding='utf-8-sig'))
        except (ValueError, OSError):
            continue
        relative = source.relative_to(PROJECT).as_posix()
        for s in strings(obj):
            if re.fullmatch(r'[0-9a-fA-F]{64}', s):
                hashes[s.lower()].add(relative)
            base = re.split(r'[/\\]', s.split('?')[0])[-1]
            if Path(base).suffix.lower() in DOCS | {'.bin', '.mp4', '.exe', '.zip'} and len(base) < 250:
                names[base.casefold()].add(relative)
    for s in knowledge['sources']:
        hashes[s['sha256']].add(s['file'])
        names[Path(s['file']).name.casefold()].add(s['file'])
    return names, hashes


def trace_knowledge(knowledge, results, out):
    """Original-content comparisons. No absent substring is labelled incorrect."""
    originals = collections.defaultdict(list)
    for r in results:
        if r.get('coverage') == '尚未接入':
            r['coverage'] = '未发现现有索引关联（待核实）'
        elif r.get('coverage') == '尚未接入（或不属于知识文件）':
            r['coverage'] = '未发现清单关联（或非知识文件）'
        if r.get('textFile') and r['extension'] in {'.pdf', '.docx', '.pptx', '.xlsx'}:
            originals[r['name'].casefold()].append(r)
    norm = lambda s: re.sub(r'\s+', '', s or '')
    text_cache = {}
    def raw_text(r):
        if r['sha256'] not in text_cache:
            text_cache[r['sha256']] = norm((PROJECT / r['textFile']).read_text(encoding='utf-8'))
        return text_cache[r['sha256']]
    sources = {}
    for p in (PROJECT / 'data/aftersales/sources').glob('*.json'):
        d = json.loads(p.read_text(encoding='utf-8-sig'))
        source_strings = list(strings({key: val for key, val in d.items() if key in {'sourceFile', 'source', 'documents'}}))
        refs = []
        for s in source_strings:
            base = re.split(r'[/\\]', s)[-1].casefold()
            refs.extend(originals.get(base, []))
        sources[p.relative_to(PROJECT).as_posix()] = list({r['sha256']: r for r in refs}.values())
    cases = []
    for c in knowledge['cases']:
        source_file = (c.get('sourceReference') or {}).get('file', '')
        docs = sources.get(source_file, [])
        steps = []
        for check in c.get('checks', []):
            matched = [r for r in docs if norm(check['text']) and norm(check['text']) in raw_text(r)]
            steps.append({'checkId': check['checkId'], 'status': '原件文本字面支持（非工程验证）' if matched else '原件未匹配或需版面核验', 'matches': [{'path': r['path'], 'sha256': r['sha256'], 'category': r['classification']['category']} for r in matched]})
        solution = c.get('historicalSolution')
        matches = [r for r in docs if solution and norm(solution) in raw_text(r)]
        cases.append({'legacyId': c['legacyId'], 'sourceIndex': source_file, 'originalCandidates': [{'path': r['path'], 'sha256': r['sha256']} for r in docs], 'checks': steps, 'solutionLiteralMatches': [r['sha256'] for r in matches], 'status': '找到同名原件候选' if docs else '原件尚未定位', 'engineeringVerified': False})
    products = []
    for p in knowledge['products']:
        docs = list({r['sha256']: r for d in p.get('documents', []) for r in originals.get(d['name'].casefold(), [])}.values())
        products.append({'modelId': p['modelId'], 'claims': len(p.get('claims', [])), 'originalCandidates': [{'path': r['path'], 'sha256': r['sha256'], 'versions': r['versions'], 'category': r['classification']['category']} for r in docs], 'status': '原件可回查，参数仍待逐条核验' if docs else '仅派生索引，未定位关联原件'})
    dump(out / 'case-original-trace.json', cases)
    dump(out / 'product-original-trace.json', products)
    return {'productsWithOriginalCandidates': sum(bool(p['originalCandidates']) for p in products), 'casesWithOriginalCandidates': sum(bool(c['originalCandidates']) for c in cases), 'checksWithLiteralOriginalSupport': sum(s['status'].startswith('原件文本字面支持') for c in cases for s in c['checks']), 'solutionsWithLiteralOriginalSupport': sum(bool(c['solutionLiteralMatches']) for c in cases), 'note': '同名候选及字面支持不证明作者、同版本、条件齐全或工程正确性'}


def run(args):
    out = PROJECT / args.output
    if not out.resolve().is_relative_to(PROJECT / 'tmp'):
        raise ValueError('Audit outputs must stay under project tmp; source roots are read-only')
    roots = json.loads(Path(args.roots).read_text(encoding='utf-8-sig'))
    inventory, errors, seen = [], [], set()
    previous_roots = []
    if args.reuse_inventory or args.extend_inventory:
        saved = json.loads((out / 'inventory.json').read_text(encoding='utf-8'))
        if args.reuse_inventory and saved['roots'] != roots:
            raise ValueError('Roots changed; do not reuse another scope')
        if args.extend_inventory and not set(saved['roots']).issubset(roots):
            raise ValueError('Extension cannot remove already audited roots')
        inventory, errors = saved['files'], saved['errors']
        previous_roots = saved['roots']
        seen = {r['path'].casefold() for r in inventory}
    for root in ([] if args.reuse_inventory else [r for r in roots if r not in previous_roots]):
        path = Path(root)
        if not path.is_dir():
            errors.append({'path': root, 'error': 'directory-not-accessible'})
            continue
        def walk_error(e):
            errors.append({'path': e.filename, 'error': str(e)})
        for directory, dirs, files in os.walk(root, onerror=walk_error, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED and str(Path(directory, d)).casefold() not in {r.casefold() for r in previous_roots} and not Path(directory, d).is_symlink())
            for name in sorted(files):
                p = Path(directory, name)
                if str(p).casefold() in seen:
                    continue
                seen.add(str(p).casefold())
                try:
                    if p.is_symlink():
                        continue
                    s = p.stat()
                    inventory.append({'path': str(p), 'root': root, 'relativePath': str(p.relative_to(root)), 'name': name, 'extension': p.suffix.lower(), 'bytes': s.st_size, 'mtimeNs': s.st_mtime_ns, 'attributes': getattr(s, 'st_file_attributes', 0)})
                except OSError as e:
                    errors.append({'path': str(p), 'error': str(e)})
            if len(inventory) % 500 < len(files):
                print(json.dumps({'phase': 'listing', 'files': len(inventory), 'directory': directory}, ensure_ascii=True), flush=True)
        print(json.dumps({'phase': 'root-complete', 'root': root, 'files': len(inventory)}, ensure_ascii=True), flush=True)
    dump(out / 'inventory.json', {'roots': roots, 'files': inventory, 'errors': errors, 'time': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'manual-copy-snapshot-not-live-company-drive'})
    print(json.dumps({'phase': 'inventory', 'files': len(inventory), 'bytes': sum(x['bytes'] for x in inventory), 'formats': dict(collections.Counter(x['extension'] for x in inventory)), 'errors': len(errors)}, ensure_ascii=True), flush=True)
    if args.inventory_only:
        return
    active = json.loads((PROJECT / 'v2/data/knowledge/active-manifest.json').read_text(encoding='utf-8-sig'))
    kp = PROJECT / 'v2/data/knowledge' / active['versionId'] / 'index.json'
    k = json.loads(kp.read_text(encoding='utf-8-sig'))
    names, hashes = reference_catalog(k)
    cache_path = out / 'content-cache.json'
    cache = json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}
    results = []
    if args.finalize_only:
        results = json.loads((out / 'coverage.json').read_text(encoding='utf-8'))
        if len(results) != len(inventory) or any(r['path'] != i['path'] for r, i in zip(results, inventory)):
            raise ValueError('Saved coverage is not the complete same inventory')
    elif args.resume:
        progress = out / 'coverage-progress.json'
        if progress.exists():
            results = json.loads(progress.read_text(encoding='utf-8'))
            for old, current in zip(results, inventory):
                if any(old[k] != current[k] for k in ('path', 'bytes', 'mtimeNs')):
                    raise ValueError('Inventory changed; cannot resume old prefix')
            if len(results) > len(inventory):
                raise ValueError('Progress exceeds inventory')
    for item in inventory[len(results):]:
        p = Path(item['path'])
        if p.name.casefold() == '.wedrive' or p.suffix.casefold() in {'.wedrive', '.folderdownload'}:
            item['auditState'] = 'download-marker-not-content'
            item['coverage'] = '下载标记/占位（不算实体正文）'
            results.append(item)
            continue
        if item.get('attributes', 0) & (0x1000 | 0x400000):
            item['auditState'] = 'offline-placeholder-not-opened'
            item['coverage'] = '仅占位文件（未读取/未触发下载）'
            results.append(item)
            continue
        if re.search(r'AI采集|黄金测试|500.*问|真实客户问法', p.name, re.I):
            item['auditState'] = 'deferred-customer-test-data'
            item['coverage'] = '客户测试资料暂缓（仅盘点）'
            results.append(item)
            continue
        if p.suffix.lower() not in DOCS:
            item['auditState'] = 'binary-metadata-only'
            item['coverage'] = '仅有索引' if names.get(p.name.casefold()) else '尚未接入（或不属于知识文件）'
            item['indexReferences'] = sorted(names.get(p.name.casefold(), []))
            results.append(item)
            continue
        try:
            sha = digest(p)
            item['sha256'] = sha
            if sha not in cache:
                text, info = extract(p)
                text_path = out / 'texts' / (sha + '.txt')
                text_path.parent.mkdir(parents=True, exist_ok=True)
                text_path.write_bytes(text.encode('utf-8'))
                cache[sha] = {'extraction': info, 'classification': classify(text, p.name), 'characters': len(text), 'versions': sorted(set(re.findall(r'(?i)\bV\d+(?:\.\d+){1,4}\b', text)))[:80], 'textFile': str(text_path.relative_to(PROJECT))}
            item.update(cache[sha])
            exact = sorted(hashes.get(sha, []))
            hints = sorted(names.get(p.name.casefold(), []))
            item['hashReferences'] = exact
            item['indexReferences'] = hints
            # Exact equality of extracted index JSON is not raw-source validation.
            item['coverage'] = '已绑定哈希证据（完整解析仍待确认）' if exact else '仅有索引（同名线索未证明同版本）' if hints else '尚未接入'
            if item['classification']['category'].startswith('AI') and (exact or hints):
                item['risk'] = '已接入资料出现AI二次整理线索，技术结论需回查原件'
            after = p.stat()
            if (after.st_size, after.st_mtime_ns) != (item['bytes'], item['mtimeNs']):
                item['changedDuringRead'] = True
                item['risk'] = '文件读取期间变化，哈希不可作为稳定快照'
        except Exception as e:
            item['auditState'] = 'read-or-extract-failed'
            item['error'] = str(e)
        results.append(item)
        if len(results) % 50 == 0:
            dump(cache_path, cache)
            dump(out / 'coverage-progress.json', results)
            print(json.dumps({'phase': 'extract', 'processed': len(results), 'total': len(inventory), 'uniqueTextHashes': len(cache)}), flush=True)
    dump(cache_path, cache)
    # Re-evaluate per-file names from locally cached original text, with no SMB reread.
    # A copied company logo in an index/summary must not promote it to an original.
    for r in results:
        if args.supplement_formats and ((r.get('auditState') == 'binary-metadata-only' and r['extension'] in DOCS) or (r.get('auditState') == 'read-or-extract-failed' and r['extension'] == '.pdf')):
            p = Path(r['path'])
            try:
                sha = digest(p)
                text, info = extract(p)
                text_file = out / 'texts' / (sha + '.txt')
                text_file.write_bytes(text.encode('utf-8'))
                r.update({'sha256': sha, 'textFile': str(text_file.relative_to(PROJECT)), 'extraction': info, 'characters': len(text), 'versions': sorted(set(re.findall(r'(?i)\bV\d+(?:\.\d+){1,4}\b', text)))[:80], 'coverage': '仅有索引（同名线索未证明同版本）' if r.get('indexReferences') else '尚未接入', 'auditState': 'supplemental-format-audited'})
                r.pop('error', None)
                r['hashReferences'] = sorted(hashes.get(sha, []))
                cache[sha] = {key: r[key] for key in ('textFile', 'extraction', 'characters', 'versions')}
            except Exception as e:
                r.update({'auditState': 'read-or-extract-failed', 'error': str(e)})
        if r.get('textFile'):
            r['classification'] = classify((PROJECT / r['textFile']).read_text(encoding='utf-8'), r['name'])
            cache[r['sha256']]['classification'] = r['classification']
            if r['classification']['category'].startswith(('AI', '二次整理')) and (r.get('hashReferences') or r.get('indexReferences')):
                r['risk'] = '二次资料与现有索引有关联线索；参数、兼容和工程结论须回查原件'
    by_hash = collections.defaultdict(list)
    for r in results:
        if r.get('sha256'):
            by_hash[r['sha256']].append(r['path'])
    duplicate_groups = [{'sha256': sha, 'paths': paths} for sha, paths in by_hash.items() if len(paths) > 1]
    by_name = collections.defaultdict(list)
    for r in results:
        if r.get('sha256'):
            by_name[r['name'].casefold()].append(r)
    name_conflicts = [{'name': name, 'files': [{'path': r['path'], 'sha256': r['sha256'], 'versions': r.get('versions', [])} for r in records], 'status': '同名不同内容（版本候选，不等于参数冲突）'} for name, records in by_name.items() if len({r['sha256'] for r in records}) > 1]
    dump(out / 'same-name-versions.json', name_conflicts)
    trace = trace_knowledge(k, results, out)
    claims = [c for p in k['products'] for c in p.get('claims', [])]
    source_status = collections.Counter(c.get('verificationStatus', 'unknown') for c in claims)
    cases_by_source = collections.Counter(c.get('sourceReference', {}).get('file', 'unresolved') if c.get('sourceReference') else 'unresolved' for c in k['cases'])
    # Explicit high risk: support against intermediate JSON proves literal consistency only.
    risks = [{'area': 'product-claims', 'count': len(claims), 'statuses': dict(source_status), 'reason': '多数参数来源为派生索引；未逐条回查原始文档，不能推断原厂核验'}, {'area': 'aftersales', 'count': len(k['cases']), 'sources': dict(cases_by_source), 'reason': 'literal-source-supported是对历史JSON的一致性，不证明原始现场记录、作者或工程普适性'}, {'area': 'conflicts', 'parameterConflicts': k.get('parameterConflicts', []), 'quarantinedAssociations': len(k.get('rejectedDocuments', []))}]
    risks.append({'area': 'secondary-materials-linked-to-indices', 'files': [{'path': r['path'], 'sha256': r.get('sha256'), 'classification': r['classification'], 'indexReferences': r.get('indexReferences', []), 'hashReferences': r.get('hashReferences', []), 'risk': r['risk']} for r in results if r.get('risk') and r.get('classification', {}).get('category', '').startswith(('AI', '二次整理'))], 'note': '同名线索不证明这份二次资料已被业务读取；须结合调用链核验'})
    summary = {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'knowledgeVersion': active['versionId'], 'knowledgeHashUnchanged': digest(kp) == active['sha256'], 'products': len(k['products']), 'cases': len(k['cases']), 'files': len(results), 'documentFiles': sum(r['extension'] in DOCS for r in results), 'uniqueDocumentHashes': len(by_hash), 'duplicateGroups': len(duplicate_groups), 'classification': dict(collections.Counter(r.get('classification', {}).get('category', '未提取/非文档') for r in results)), 'coverage': dict(collections.Counter(r.get('coverage', '提取失败') for r in results)), 'extractionFailures': sum('error' in r for r in results), 'walkErrors': errors, 'completeParsingConfirmed': 0, 'limitations': ['来源分类均为候选，不基于文件名确认可信性', '文本提取不等于完整解析/表格图片/参数与版本核验', '仅文档计算SHA256；安装包/视频/固件先统计元数据', '同名索引匹配不是同内容证明；未匹配也不能证明从未接入', '资料为手动副本，不证明微盘当前最新版本', '禁止本审计自动修改知识库或放行技术结论']}
    summary['sameNameDifferentContents'] = len(name_conflicts)
    summary['originalTrace'] = trace
    recovery = out / 'long-path-check.json'
    if recovery.exists():
        recovered = json.loads(recovery.read_text(encoding='utf-8'))
        summary['longPathMetadataRecovered'] = sum(r['extendedReadSucceeded'] for r in recovered)
    presentations = [{'path': r['path'], 'sha256': r.get('sha256'), 'extraction': r.get('extraction'), 'classification': r.get('classification'), 'auditState': r.get('auditState')} for r in results if r['extension'] in {'.ppt', '.pptx', '.3pptx'}]
    dump(out / 'presentation-classification.json', presentations)
    summary['presentations'] = {'files': len(presentations), 'priorityCandidates': sum(r.get('classification', {}).get('presentation', {}).get('reviewPriority') == '优先核查' for r in presentations), 'note': '多标签内容分类，非价值判断或官方参数核验；PPT不排除'}
    dump(out / 'coverage.json', results)
    dump(out / 'duplicates.json', duplicate_groups)
    dump(out / 'high-risk-sources.json', risks)
    dump(out / 'summary.json', summary)
    dump(cache_path, cache)
    print(json.dumps(summary, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--roots', required=True, help='JSON list of read-only source directories')
    parser.add_argument('--output', default='tmp/source-coverage-20261014')
    parser.add_argument('--inventory-only', action='store_true')
    parser.add_argument('--reuse-inventory', action='store_true', help='Reuse saved directory listing; hashes still read actual files')
    parser.add_argument('--extend-inventory', action='store_true', help='Only list new roots; previously listed subtrees are skipped')
    parser.add_argument('--resume', action='store_true', help='Resume the same inventory snapshot from saved progress')
    parser.add_argument('--finalize-only', action='store_true', help='Recompute reports using saved coverage and local extracted text only')
    parser.add_argument('--supplement-formats', action='store_true', help='Read only previously unhandled document formats from saved coverage')
    run(parser.parse_args())
