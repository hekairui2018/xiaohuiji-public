"""Export all frozen successes/failures as a separate redacted local ZIP."""
import collections,hashlib,json,sys,zipfile
from pathlib import Path
from common import ROOT,WORK,load,save,sha

README='''# 小灰机二代第四阶段：真实三组问答对照

先读阶段4-三组问答验收报告.md，然后用三组问答逐题审查.html逐题对照。
本包是独立脱敏副本；没有自动上传或取得公开公司技术内容的许可。

- questions.json冻结原36题；supplemental-real-log-questions.json另冻结4条现有问题日志原句。预期依据为原文件/人工FQA，不使用旧AI答案。
- results/完整40题各含A纯检索、B检索+27B、C相同27B无检索结果。B的9条明确文件请求绕过模型，31条复杂题才进行原生工具问答。
- traces/保留真实工具参数、返回内容、会话历史与最终回答；calls/保留真实本地模型请求、流式响应、Token与显存采样。早期pilot失败与日期修复补测也保留，但不混进40题成绩。
- source-evidence.json包含实际返回及预期原文，包括系统遗漏的处理方法。用resourceId、versionId、blockId、evidenceId和原始段落/行/页定位。
- agent-source-review.json/source-review.csv为Agent逐题原文审查，不是模型自评、独立人工验收或现场成功率。automatic-diagnostics只是字面诊断，不替代质量评价。
- 138个工具片段中136个由解析器回读完全一致，另2个是旧索引空表格行，已直接回读DOCX XML确认；见readback-empty-row-findings.json。
- post-baseline-date-fix.json仅2题独立补测，不覆盖原40题。初版定位带CSV原始cells，故日期原本可见；当前工具只返安全位置，日期独立元数据。初版日志中的原文/人员等已在本包脱敏。
- code/提供实现文本，interfaces.md给接口和限制。无索引DB、模型权重、大图、原件二进制或浏览器配置。
- 性能是单路本机目的样本测量。8K为应用请求预算，既有模型服务仍为131072配置；未重新启动或加载模型。未进行5路容量测试。
- author/phone/email/credential/private IP/source URL/absolute path被独立替换；原始内部日志和G原件未覆盖。技术型号、参数、失败与证据定位保留。
- 缺少图片阅读、全库访问和现场验证，不能据本包宣布成熟售后客服。当前只接受独立质量审查，不自动扩大或发布。
'''

def run():
 perf=load('performance-summary.json');quality=load('quality-summary.json');safety=load('source-safety-summary.json')
 actual=[json.loads(p.read_text(encoding='utf8')) for p in (WORK/'calls').glob('*.json')]
 groups=collections.defaultdict(list)
 for c in actual:
  tag='baseline' if c['callId'].startswith(('hybrid-','bare-')) else 'date-metadata-fix' if c['callId'].startswith('date-fix-') else 'pilot'
  groups[tag].append(c)
 usage={k:{'calls':len(v),'promptTokens':sum((c.get('usage')or{}).get('prompt_tokens',0) for c in v),'completionTokens':sum((c.get('usage')or{}).get('completion_tokens',0) for c in v),'loggedSeconds':round(sum(c.get('seconds',0) for c in v),3),'failures':sum(bool(c.get('error')) for c in v)} for k,v in groups.items()}
 save(WORK/'all-logged-model-usage.json',{'groups':usage,'scope':'all persisted actual calls including pilot and two post-baseline trials; initial startup capability probe was observed separately, not part of these receipt totals','automaticRetries':0,'argumentCorrections':'8 baseline tool arguments rejected and returned as errors for model continuation; not hidden transport retries'})
 baseline=perf['usage'];complex_time=perf['timings']['complex'];files=perf['timings']['files'];q=quality['counts']
 report=f'''# 小灰机二代第四阶段：Bonsai 27B三组问答验收

日期：2026-10-16。结论：已证实27B能原生、连续调用知识工具，并改善部分工程资料问答；尚不适合无人审核的正式售后客服。

## 实际实现与隔离

新增独立v2/tool-trial，不接入既有默认客户入口，不修改检索引擎、G原件、active或共享candidate。
复用4510所用只读SQLite；4510 /health实际在线，4499连接拒绝，未擅自启动。新试验入口仅127.0.0.1:4512。
五个只读普通工具全部实际被调用：search_resources、search_document_blocks、read_document、search_cases、get_case。
search_cases/get_case目前提供有来源原文摘录，并非已核验独立案例，不将2231旧案例自动启用。
固定授权19个内容/元数据资源条目、24个存放位置，安装程序只目录。10个允许的PDF下载已逐项HTTP读取并与原始SHA比对通过。没有扩大权限到全盘或其他资源。

## 模型与调用

复用8080既有llama-server，别名bonsai，实际26,895,998,464参数、PTQ1_0三值量化约1.75bpw，单槽。未重复加载模型或改其配置。
原生OpenAI工具调用可用，无JSON伪工具或固定回答替代。30题有实际工具请求，21题连续多次调用；9题明确文件查询直接绕过模型，1题安全拒绝不调用工具。
各客户会话由应用分开保存，交错甲/乙三轮真实测试没有观察到串话；不是依赖模型服务持久记忆。未检验长周期多客户或5路容量。
应用按真实tokenizer控制8192上下文预算并预留640输出Token；服务实际n_ctx仍131072，不能把请求预算称作显存缩小配置。温度0、seed42、关闭thinking、最多4轮/5工具、单路。

## 样本与公平性

40道目的样本：36条真实原文/人工FQA改写、既有文件定位题与受控会话/反例，另4条现有业务问题日志原句。不是40条独立抽样客户成功记录。
每题A直接使用累计客户原话（非模型改写），最多3结果并读首条相邻上下文；B模型可改写查询并多次阅读；C同模型和同审慎回答提示，但没有工具或公司原文。
因此对照反映此有界工具编排的实际效果，不证明27B所有可能提示/配置的最优性能。每题固定A→B→C顺序，未随机交叉，缓存与热态影响未消除；简单文件B较A略快不代表AI加速。旧AI答案不作为标准。原始40题输出/排序/标准不覆盖，补测单列。

## 业务质量（逐题原文复核）

|项目|纯小灰机检索A|检索+27B B|无检索27B C|
|---|---|---|---|
|9道明确资料|9/9找到目标，L01规格书排第二；EXE仅目录|8正确、1部分；无模型|9未提供目标资料|
|31道复杂问题|19证据充分、9部分、1空、2不适用|17正确、9部分、3错误、2未答|8正确、6部分、4错误、13未答|
|20道售后/多轮|12充分、7部分、1不适用|9正确、7部分、2错误、2未答|5正确、5部分、2错误、8未答|

B复杂题严格满足信息需求17/31（54.8%），C 8/31（25.8%），均包含恰当追问/拒绝，不等于已解决故障。全部40题B25正确、10部分、3错、2未答；其中8条正确文件题未用模型，不混成模型能力分数。
A可评预期来源命中30/34，B同为30/34。这是目标资源命中，不是答案准确率；A不生成客服回答，不能和B/C硬凑同一种答案准确率。
复核人为当前Agent逐题阅读原文，不是27B自评或独立人工/硬件验收；等待外部审查。每题理由、预期原文、实际输出及失败均留存。

## 可复核改善与失败

- O01/O02：检索后识别HDPlayer RGB减一及Word格式转TXT，裸模型误解为OSD/键盘。
- S03/S04：能保留527开全屏失败后关全屏正常，并与另一条开全屏经验并列，条件不足时追问。
- MB2/MB3：随乙补充C16L/R712继续限定检索，保留HUB发送卡与播放盒差别；甲3566S没有串入。
- S01严重错误：把原文“三百”补成300Hz，没有单位依据。
- S02：原文“即可”被说成已显示正常，夸大结果。
- P01：未找到已存在的2025/4.0.8.0，回答2026/4.0.30.0；A实际能返回旧记录。不是缺知识，也不能说工具完全没日期，初版CSV定位单元格已含日期。
- S05/S07/S08：漏掉59Hz、中间升级版本与信号源条件、K08正常卡参数回读下发，属于上下文窗口/工具选择/停止阅读问题。原件有处理，不得把失败归咎公司没资料。
- S09：R732接口定义原文已在A，B却选到另一案例，C误作组态点表。
- L02/L04：产品带载适用条件表达不足、通用HDPlayer手册被说成A4专项证据，范围仍需收紧。
- N03：没有泄漏凭证，但B重复直到640输出Token上限，原始失败没有删除。

## 协议问题与已做通用修正

40题没有模型HTTP超时/传输失败，仍有8次工具参数校验拒绝（7次radius超限、1次get_case把evidenceId当caseId），全部记录并将错误回给模型，不算“零失败”。早期pilot原始失败也保留。
模型可见schema起初没写radius上限，接口本身也有责任；目前已补0..2及caseId格式，未重跑40题刷分，效果待后续验收。
初版工具CSV定位返回raw cells，带非必要人员等元数据；本轮已改为仅位置白名单、recordDate独立元数据，并屏蔽内网地址。原始日志保留内部，审查副本脱敏。
日期字段修复只补测P01/P02：P01仍漏旧版本，P02仍正确，没有宣称修好版本召回；此补测发生在最终定位/schema收窄之前，不能视为所有最终代码已做40题验收。
13项工具/权限/隔离/离线单元检查、26项既有提炼原型Python回归、125项既有Node回归通过。离线验证为显式模拟模型不可用，未停止用户模型服务。最终代码另做真实HTTP日期、定位脱敏、case-not-found与基线SHA检查通过。
真实Edge浏览器已点击搜索和新客户按钮；HTTP四十题和10个下载已实际执行。UI仅本地实验，不冒充/quick、/huiai现网联调。

## 单路性能

|类型与分组|平均耗时|p95|
|---|---:|---:|
|纯检索：9资料|{files['direct']['mean']}秒|{files['direct']['p95']}秒|
|B资料直返（无AI）|{files['hybrid']['mean']}秒|{files['hybrid']['p95']}秒|
|C资料请求|{files['bare']['mean']}秒|{files['bare']['p95']}秒|
|纯检索：31复杂|{complex_time['direct']['mean']}秒|{complex_time['direct']['p95']}秒|
|B复杂全流程|{complex_time['hybrid']['mean']}秒|{complex_time['hybrid']['p95']}秒|
|C复杂回答|{complex_time['bare']['mean']}秒|{complex_time['bare']['p95']}秒|
|B首个最终答案Token|{complex_time['hybridFirstAnswerToken']['mean']}秒|{complex_time['hybridFirstAnswerToken']['p95']}秒|
|C首个答案Token|{complex_time['bareFirstAnswerToken']['mean']}秒|{complex_time['bareFirstAnswerToken']['p95']}秒|

逐次模型TTFT与工具耗时另见calls/和traces/；B最终答案TTFT包含前置检索/工具轮，不与首轮工具Token混淆。p95采用nearest-rank，小样本尾延迟不代表长期SLA。PDF下载校验不计入搜索时延。
主40题B {baseline['hybrid']['modelCalls']}次模型请求、输入{baseline['hybrid']['promptTokens']} / 输出{baseline['hybrid']['completionTokens']}Token；C {baseline['bare']['modelCalls']}次、输入{baseline['bare']['promptTokens']} / 输出{baseline['bare']['completionTokens']}Token。
最大实际请求输入B {baseline['hybrid']['maxActualPromptTokens']}Token；GPU每5秒采样峰值{perf['gpuPeakSampledMiB']}MiB（约10.74GiB，包括既有已加载模型，不是应用新增显存，可能漏掉短峰）。所有已落盘pilot/补测消耗另列all-logged-model-usage.json。

## 原文、证据与安全

24处源文件元数据一致，有哈希的文档全部SHA一致；EXE仅元数据、不额外全读。138个不同工具片段的公开文字投影全部匹配SQLite原文。
其中136个原文定位可由解析器完全重建；2个旧索引空表行“|”由原始XML确认，不是技术证据。没有重建/修复资源索引。source-evidence同时保存实际返回及未检出预期原文供复核。
资源数据库、二代active及共享candidate的SHA均不变。未改G原件、一代、现网、既有4499/4510及8080模型配置；无云端AI/付费调用/上传/push/部署。
独立ZIP不含原件、数据库、图片或模型权重，保留40题完整失败证据与调用轨迹。脱敏不等于公司技术内容获公开授权，仍等待用户独立验收。

## 验收结论与待完善

本轮最小原生工具流程已实现、可独立运行，实际证明B在若干公司资料问题上比C有用；也证明接入检索不能自动消除27B工程误述。
当前判定：允许本地独立审查，未达到无人审核正式售后服务条件。主要阻塞为长案例阅读边界、版本限定查询、字段/单位/结果忠实度，以及工具schema和敏感元数据防护需独立复核。
未开展全库提炼、5路并发、训练、现网切换或第二轮功能扩展。完成后停止，等待独立验收。
'''
 (WORK/'阶段4-三组问答验收报告.md').write_text(report,encoding='utf8')
 (WORK/'interfaces.md').write_text('''# 独立只读接口

本地4512；原4510/4499不改，模型服务只用8080现有bonsai。

- GET /health：独立试验进程健康，不等于模型在线。
- POST /tool：{"name":"search_resources","arguments":{"query":"A3L规格书","model":"A3L","version":"V1.1","limit":2}}
- search_document_blocks：同查询参数，返回正文、locator、evidenceId、blockId、resourceId、versionId、适用范围警告、imagesRead=false。
- read_document：必填resourceId/versionId，可带blockId、radius(0..2)、offset(0..200000)；锚点上限1000字符，邻块450；继续读依nextOffset/readMore。
- search_cases：有来源的工程原文检索，未认证独立案例，返回source-case:块号；默认2，最多3。
- get_case：caseId须source-case:数字，不是evidenceId；没有案例则case-not-found，HTTP工具层400。
- POST /chat：question、session、arm(hybrid/bare)、可选directMode=files、filters、runId。明确文件请求由调用方选直接模式，不做复杂意图规则。runId重放返回原始trace；更换问题不可复用。
- GET /download?resourceId=…&versionId=…：仅白名单可下载PDF，实时SHA/元数据不符则拒绝。软件EXE只目录，工程内参不下载。
- 所有资源/版本必须成对匹配白名单；只读SQLite；无任意路径、写入、固件或设备操作接口。无远程公开访问/生产级鉴权，禁止直接开放客户网络。
- CSV仅输出问题/处理原文，日期独立元数据，定位不含raw cells。图像未读、型号提及不代表兼容、原记录非普遍结论。
- 每会话独立应用JSON，原生tool loop最多4轮/5工具，单路锁；超8K预算明确拒绝，不静默截关键工程证据。未做长期会话裁剪，明确文件直返未纳入聊天历史。
- 本地运行：在项目根目录以Python执行v2/tool-trial/trial_http.py --port 4512。需要现有WORK资料及资源索引，不是可脱离内部数据直接公开部署的产品。
- 候选回退：停止4512本进程即可；不改原4510、4499或active。会话、日志和候选都在tmp/tool-trial-stage4-20261016。
''',encoding='utf8')
 code=WORK/'code';code.mkdir(exist_ok=True)
 for p in (ROOT/'v2/tool-trial').iterdir():
  if p.suffix in ['.py','.cjs']:(code/(p.name+'.txt')).write_text(p.read_text(encoding='utf8'),encoding='utf8')
 sys.path.insert(0,str(ROOT/'v2/experience-extraction'))
 from export_review import build
 extras=list((WORK/'results').glob('*.json'))+[p for p in (WORK/'traces').glob('*.json') if not p.name.startswith('unit-')]+list(code.glob('*.txt'))
 result=build(WORK,'小灰机二代_第四阶段三组问答对照_脱敏审查包.zip',README,extra_redactions=load('internal-only/author-tokens.json'),extra_files=extras,exclude_files=['zip-integrity-check.json'])
 archive=Path(result['path']);destination=WORK/'zip-verify';destination.mkdir(exist_ok=True)
 with zipfile.ZipFile(archive) as z:
  assert z.testzip() is None
  names=z.namelist();required=['questions.json','supplemental-real-log-questions.json','agent-source-review.json','source-evidence.json','performance-summary.json','三组问答逐题审查.html','interfaces.md','阶段4-三组问答验收报告.md','README.md']
  assert all(n in names for n in required);assert sum(n.startswith('results/') for n in names)==40
  assert not any('internal-only' in n or 'unit-' in n or n.endswith(('.db','.docx','.pdf','.exe','.png')) for n in names)
  assert all((destination/Path(n)).resolve().is_relative_to(destination.resolve()) for n in names)
  z.extractall(destination)
 manifest=json.loads((destination/'redaction-manifest.json').read_text(encoding='utf8'))
 assert all(sha(destination/Path(x['name']))==x['redactedSHA256'] for x in manifest['files'])
 # Link each actual literal citation and expected source ID to included original evidence.
 docs=json.loads((destination/'source-evidence.json').read_text(encoding='utf8'));ids={u['evidenceId'] for d in docs for u in d['units'] if u.get('evidenceId')}
 missing=[]
 for p in (destination/'results').glob('*.json'):
  r=json.loads(p.read_text(encoding='utf8'));missing.extend(x for x in r['hybrid'].get('citations',[]) if x not in ids)
 assert not missing
 verify={'zipSHA256':sha(archive),'bytes':archive.stat().st_size,'entries':len(names),'actualResults':40,'allRequiredFilesPresent':True,'allRedactedSHA256Match':True,'allBaselineCitationsResolve':True,'unzipPassed':True,'largeOriginalsIncluded':False,'uploaded':False}
 save(WORK/'zip-integrity-check.json',verify);print(json.dumps(verify,ensure_ascii=False))
 (ROOT/'docs/v2/Bonsai27B工具接入与三组问答第四阶段验收-20261016.md').write_text(report,encoding='utf8')

if __name__=='__main__':run()
