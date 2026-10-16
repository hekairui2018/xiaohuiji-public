"""Local full evidence and small independent redacted review archive."""
import csv,hashlib,json,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
import common
from evidence_experiment import WORK,ROOT
from review_evidence import run as review

README='''# 第五阶段：现有客户端实测与完整证据A/B

1. 先看阶段5-客户端与完整证据验收报告.md、paired-summary.json和原文与客户端A-B逐题审查.html。
2. cases.json冻结12题、原文、评分要点、split和第四阶段原始对照。results/保留每题现有/huiai真实输入/发送按钮产生的A/B答案和DOM。没有用后台脚本生成答案冒充界面测试。
3. A自主使用五个只读工具；B直接读完整原文，B请求不包含评分要点、标准回答或旧答案。calls/是真实本机模型流式回执，traces/包含工具选择及原文。配置、原文和标准预先冻结，未修改模型权重。
4. source-evidence.json包含全部B证据与实际A返回原文。evidence-readback.json/empty-table-xml-verification.json可回查原件定位。图片未读，不假装已经理解截图。
5. agent-paired-review.json/paired-review.csv是Agent按原文逐题复核，非模型自评分、独立人工或真机验收。S01、S02、S07、S10及多轮第三轮的问题完整保留。
6. datasets/train.jsonl仅7条训练候选；validation 3条、heldout 2条严格分开，后两者禁止进入训练。对应.json数组是同内容便于审查的副本，不是另一数据集。所有approvedForTraining=false，待独立验收；不等于权重已经训练，也不是新正式知识库或FAQ。
7. client-direct-search、client-browser-summary、client-multi-and-missing保留实际客户端情况。client-backend-disconnected是停止4512编排进程后实测，8080共享模型未停止；不要把它说成物理关闭模型试验。
8. 客户端下载链接、来源版本归属、跨客户缓存和假引用校验修正发生在基线之后，post-baseline-*和implementation-before-fixes保留原始失败。修复不重跑12题刷分，不把静态拦截称作模型能力改善。
9. code/是当前实现文本；original-code-snapshot是原有入口的Git基线。没有第二套客户端/数据库/知识体系，原件、索引、active和第四阶段40题结果未改。
10. 脱敏替换人员/联系信息/凭证/内网地址/本地路径/来源URL；证据ID、版本、技术原文和失败保留。不含完整原件、数据库、大图、权重或浏览器配置。脱敏不等于获得公开公司技术资料的授权。本包未上传。
'''

def main():
 summary=review();load=lambda n:json.loads((WORK/n).read_text(encoding='utf8'));save=lambda n,v:common.save(WORK/n,v)
 # The two parser-skipped empty rows are checked against their native Office XML.
 docs=load('source-evidence.json');xml=[];ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 for item in load('evidence-readback.json'):
  if not item['emptyOldIndexSeparator'] or any(x['blockId']==item['blockId'] for x in xml):continue
  d=next(d for d in docs if any(u.get('blockId')==item['blockId'] for u in d['units']));u=next(u for u in d['units'] if u.get('blockId')==item['blockId']);p=next(l['path'] for l in d['locations'] if l['sha256']==d['sha256'])
  with zipfile.ZipFile(p) as z:body=ET.fromstring(z.read('word/document.xml')).find('w:body',ns)
  tables=[n for n in body if n.tag.endswith('}tbl')];row=tables[u['locator']['table']-1].findall('w:tr',ns)[u['locator']['row']-1];cells=[''.join(t.text or '' for t in c.iter() if t.tag.endswith('}t')) for c in row.findall('w:tc',ns)]
  assert all(not c.strip() for c in cells);xml.append({'blockId':item['blockId'],'evidenceId':item['evidenceId'],'locator':u['locator'],'originalCells':cells,'emptyConfirmed':True})
 save('empty-table-xml-verification.json',xml)
 # Recheck actual file bytes obtained by the existing client, not merely valid URLs.
 policy=load('access-policy.json')['resources'];downloadChecks=[]
 for n,name in [('client-backend-disconnected.json','HD-A3L规格书 V1.1.pdf'),('client-fixed-links.json','HD-C16L规格书 V2.0.pdf')]:
  got=load(n)['file'];expected=[h for h,r in policy.items() if r['name']==name];ok=got['status']==200 and got['sha256'] in expected;assert ok;downloadChecks.append({'sourceName':name,'bytes':got['bytes'],'sha256':got['sha256'],'matchesFrozenSource':ok})
 save('actual-client-download-checks.json',downloadChecks)
 multi=load('client-multi-and-missing.json');isolation=not multi['other']['localTrace']['historyBefore'];assert isolation
 save('client-functional-verdict.json',{'existingClientOnly':True,'pages':['/quick','/huiai'],'directTargetFound':4,'directQuestions':4,'sourceReadAndDownloads':True,'modelToolsActual':True,'multiTurnSessionContextPreserved':True,'newCustomerIsolated':isolation,'multiTurnAnswerQuality':'failed: third turn invented PWM/logic-board relation and fake case reference','missingEvidenceAnswer':'correctly not found / asks clarification','physicalModelShutdownTested':False,'actualAIOrchestrationStoppedTestPassed':True,'fullEvidenceOracleNotAutoRetriever':True,'notMatureCustomerService':True})
 rows=load('agent-paired-review.json');matrix='\n'.join('|'+r['id']+'|'+r['split']+'|'+r['A']+'|'+r['B']+'|'+r['reason']+'|' for r in rows);a=summary['performance']['A'];b=summary['performance']['B'];safe=load('safety-final.json')
 report=f'''# 小灰机二代第五阶段：现有客户端实测与完整证据对照

2026-10-16。代码及数据以本报告附件为准。结论：本组单轮样本优先可修复瓶颈是证据交付；但模型忠实性与多轮编造仍是独立阻塞，不能只归咎检索，也不能宣布成熟售后客服。

## 实际客户端与复用

原客户端由frontend/index.html、app.js等共享页面组成，二代v2/adapters/http/server.cjs注入二代专用适配。开工4499未运行，4510资源检索与8080 Bonsai均在线。读取实际源码后，在原4499的/quick、/huiai增加可选本地工具连接，未建新演示客户端、数据库或知识库。
共享frontend及一代后端保持原样，仅二代HTTP入口/静态注入增加显式localKnowledge选项。无选项时沿用原路径；原产品搜索、软件、视频、配单及无AI功能不被本地工具接管。/quick不经过聊天路由。
4510继续用原SQLite全文索引；4512复用已有五工具编排，日志/会话切到独立tmp/client-evidence-stage5-20261016。21个工具授权内容/元数据条目（原19+两份保留题原件），基础搜索仍读取现有完整4510目录，不重建索引。
仅本机开发启动：先运行Python的trial_http.py --port 4512 --work 本阶段工作目录，再设置XHJ_LOCAL_KNOWLEDGE=1运行node v2/adapters/http/server.cjs 4499。原阶段17固定指纹配置不修改，不能声称仍由旧固定配置启动。现有active/共享candidate内容未切换。

## 冻结及方法

12题=9道第四阶段不足题+S04有效流程对照+2道保留题。保留题来自APP/单双色原始人工FQA，整份来源与训练/验证来源不同，所选原文未出现在前三/四阶段实际模型请求日志中。
12题、原始证据、评分要点、7训练候选/3验证/2保留划分均先冻结。案例族及证据块跨组无重叠；训练与验证允许同文件不同案例，故不声称这两者也做到文档级独立。旧40题与答案不改。
A重新运行当前自主检索/续读流程，B由程序给已SHA核对的完整原文（标题、条件、失败、过程、结果），不提供标准答案、评分条目或旧模型回答。S01/S02为包含两条相邻独立故障的原文窗口，不标哪句是正确答案；B仍需区分边界。原文不是人工改写的答案提示。
同一已有Bonsai约27B PTQ1_0服务，temperature=0、seed=42、max_tokens=640、thinking关闭、应用预算8192；服务n_ctx仍131072，未重载或改配置。A/B系统提示相同；A有工具描述和最多4轮/5工具，B无工具且一次答复。因此比较的是受控自主工具规划与oracle证据交付，不是严格只变单一Token的实验。
固定A后B顺序，未随机交叉/重复种子；缓存与热态影响未消除，B耗时不含人工/程序事前选源成本。只能判断这12道目的样本，不能外推全库准确率。
原件核对和逐题审查由当前Agent完成，未冒称新增独立人工工程验收；评价是原文忠实性与信息需求，不是源经验的硬件真值。所有图片均未读，不以文字存在假装理解截图。

## 逐题结果

|题目|划分|A自主|B完整证据|原文复核理由|
|---|---|---|---|---|
{matrix}

A：2正确、5部分、3错误、2未答；B：8正确、3部分、1错误。10道A未完全满足中6道B转为正确，2道双方正确，4道双方均未完全满足；没有隐藏困难题或更换标准。
保留题2道：A1正确/1部分，B2正确。数量小，不作独立泛化准确率估计。L02的容量仅产品介绍，未覆盖宽度>2048折算，不据此验收实际配单；H02 B省略软件菜单细节，作为覆盖不足单列，不把未说内容当作编造。
S01在完整证据下仍自行添Hz，S02把“即可”升级成已解决，S10加入未经原文支持的原因倾向/新判断分支；S07虽然读懂中间版本，仍遗漏高风险适用前提。这些不是增加关键字规则就能宣称修复的模型问题。
P01 A把2026版本说成2025，B正确，说明版本证据对照有用，但A本来也不应把不匹配年份当确认。B变正确不意味着A所有责任都属于检索。
第四阶段P01旧gold按4.0.8.0字面找到过其他芯片记录，此旧附件完整保留；本次B只取明确DP3364S上下两组75接口的2025/09原行及2026同题行，不拿其他芯片充依据，不回改旧标准答案。

## 真实界面验收

所有12组A/B均通过原/huiai输入框和发送按钮执行；保存实际回答、DOM、工具参数/结果/回执，非后台脚本生成答案冒充点击。
/quick实际4题：A3L规格书V1.1、HDPlayer.3.9.209.7安装程序目录、Word连续左移字号43操作、3566S PWM现象，均能定位目标。后端检索耗时13.482—41.981ms；这是检索引擎时间，不冒充精确客户端端到端延迟。软件仅目录，不执行或安装。
仍有问题：正文首选可能只有现象而处理在后续，PWM结果中有无关宣传PPT；A3L返回其他明确标版次的版本，未把它们合并，不称所有查询均严格版本过滤。
已实际点击原文续读，实际客户端读取A3L PDF1686319字节与C16L PDF2343257字节，均HTTP200且同原件SHA。
客户多轮先报闪烁、再3566S、再1.1.34，应用会话有保留；新客户historyBefore为空，未观察到串话。但第三轮编造“4K+2K逻辑板=300、4K+4K=1k”等映射并输出极长假source-case引用，判定多轮业务质量未通过，不用上下文保留成功掩盖回答错误。
不存在型号XYZ999999时模型明确未找到并追问。客户端模拟断开模型连接通过；另真正停止4512 AI编排进程后，AI报本地服务不可用，原产品速查、4510索引查询和原件下载仍工作。共享8080推理进程没有停止，故不声称已完成物理关闭模型进程测试。
Edge实际操作记录无未捕获异常；Agent还查看实际页面截图。没有新增独立客户端，也没有替代用户手工工程验收。

## 本轮实际修复（不刷旧成绩）

1. 同源资料访问：原模型相对/download指向工具端口，在4499不能访问；二代适配器增加本地下载映射和原件按钮。后续仅缓存回放S08/L02核对引用/文件，不重新生成答案或重跑保留题。
2. 来源身份：旧候选白名单把同名VP620A/R712两种不同哈希的全部位置挂给每个版本，发现4条错误成员关联。源文件本身SHA没有变；本轮7份B原件在推理前已按正确hash核对。新增严格内容哈希位置过滤及修正未来候选构造，仅运行时过滤；冻结原policy/索引/active不改。此为额外来源审计缺陷，不能以每个位置各自SHA正确代替版本归属正确。
3. 引用：原校验只检查blk格式，未拦source-case假引用。现在通用校验同时检查两种ID及未闭合标签，离线重放第三轮原始失败可拦。只证明引用校验修好，不能证明模型不再编造有合法引用的事实。
4. 完整证据缓存按session/question校验，防止相同runId被另一客户取用。输入/输出/历史原始基线保留；修正后的保护只做相关检查，没有重跑12题伪造提升。

相关检查：128项Node（原125+本地桥3）、13项既有工具Python、8项实验/引用/会话/来源守卫、26项旧提炼原型Python通过。四个同名不同哈希版本经真实HTTP分别下载，均命中自己的内容SHA；跨客户缓存经HTTP400阻断。检查通过不等于模型回答质量通过。

## 性能与资源

|12题组|平均全流程|p95|模型请求|输入/输出Token|工具调用|
|---|---:|---:|---:|---:|---:|
|A自主检索|{a['answers']['mean']}秒|{a['answers']['p95']}秒|{a['modelRequests']}|{a['promptTokens']}/{a['completionTokens']}|{a['toolCalls']}|
|B完整证据|{b['answers']['mean']}秒|{b['answers']['p95']}秒|{b['modelRequests']}|{b['promptTokens']}/{b['completionTokens']}|0|

A/B首个最终答案Token平均{a['modelFirstAnswerToken']['mean']}/{b['modelFirstAnswerToken']['mean']}秒，p95 {a['modelFirstAnswerToken']['p95']}/{b['modelFirstAnswerToken']['p95']}秒。客户端当前整段显示，不具备模型Token到网页的流式输出；复杂问题25秒平均等待，还不能称流畅。单路，不作5并发容量承诺。
最大实际输入A {a['maxPromptTokens']}、B {b['maxPromptTokens']}Token，均未因8K预算截断关键证据。配对A有1次get_case参数/ID拒绝，无传输超时；校验错误保留。额外客户端多轮/缺证据测试消耗单列，不并入12题成绩。
全部实际66次模型调用（含附加界面测试）输入148888/输出7806 Token；显存5秒采样峰11019MiB约10.76GiB，含原已加载模型，不是本功能新增显存，也可能漏短峰。没有云端或付费API调用。

## 来源与数据安全

{safe['sourceReadbackOccurrences']}次A/B原文投影回读全部一致，137次解析器原始位置匹配，2次为空表格旧分隔符，由原DOCX XML确认；不是139条独立案例。26条位置关联检查（含重复检查），物理源文件没有修改。所有非空证据回读无失败。
SQLite资源库、二代active、共享candidate和第四阶段40题的SHA均保持原样。G原件、一代系统与生产服务未动，不push、不部署、不上传。仅重启本机4499和4512开发进程，既有4510/8080不重启。

## 训练候选及下一步

7条train、3条validation、2条heldout分别JSONL。包含原始/模拟问题类型、证据、条件、候选标准示例、合格模型回答、错误回答和错误层标签。所有approvedForTraining=false，须独立审查；validation与heldout不进入训练文件。标准示例为推理后按冻结原文要求整理，没有回馈模型或改评分，也没写active。
本轮只是积累数据，没有权重训练或专项微调。7条训练候选不足以支持启动27B权重微调，不能因B提升就宣布需要/已经完成训练。
下一步优先：通用案卷/章节边界、版本与日期限定、处理段自动补齐及可读证据包；同时保留单位缺失、怀疑原因、实际结果与多轮引用的忠实性反例评测。别堆型号/问题特例，也别把模型说法自动入库。待独立验收后再决定是否扩大数据或尝试训练。
本阶段结束，停在本地开发成果，等待独立验收，不自动扩大范围。
'''
 (WORK/'阶段5-客户端与完整证据验收报告.md').write_text(report,encoding='utf8');(ROOT/'docs/v2/第五阶段-客户端实测与完整证据对照-20261016.md').write_text(report,encoding='utf8')
 code=WORK/'code';code.mkdir(exist_ok=True)
 for p in list((ROOT/'v2/tool-trial').glob('*.py'))+list((ROOT/'v2/tool-trial').glob('*.cjs'))+[ROOT/'v2/adapters/http'/n for n in ['server.cjs','static-service.cjs','local-knowledge.cjs','public/local-knowledge.js']]:
  (code/(p.name+'.txt')).write_text(p.read_text(encoding='utf8'),encoding='utf8')
 sys.path.insert(0,str(ROOT/'v2/experience-extraction'));from export_review import build
 extras=list((WORK/'results').glob('*.json'))+list((WORK/'traces').glob('p5-*.json'))+list((WORK/'datasets').glob('*.jsonl'))+list(code.glob('*.txt'))+list((WORK/'implementation-before-fixes').glob('*.txt'))+list((WORK/'original-code-snapshot').glob('*.txt'))
 # Also provide JSON arrays for reviewers without a JSONL reader.
 for p in (WORK/'datasets').glob('*.jsonl'):common.save(p.with_suffix('.json'),[json.loads(line) for line in p.read_text(encoding='utf8').splitlines()])
 extras+=list((WORK/'datasets').glob('*.json'))
 result=build(WORK,'小灰机二代_第五阶段客户端与完整证据_脱敏审查包.zip',README,extra_redactions=load('internal-only/author-tokens.json'),extra_files=extras,exclude_files=['zip-integrity-check.json']+[p.name for p in (WORK/'calls').glob('*.json') if not p.name.startswith('p5-')])
 destination=WORK/'zip-verify';destination.mkdir(exist_ok=True)
 with zipfile.ZipFile(result['path']) as z:
  assert z.testzip() is None;names=z.namelist();assert len([n for n in names if n.startswith('results/')])==12
  assert all(n in names for n in ['cases.json','paired-summary.json','source-evidence.json','agent-paired-review.json','datasets/train.json','datasets/validation.json','datasets/heldout.json','datasets/train.jsonl','datasets/validation.jsonl','datasets/heldout.jsonl','client-backend-disconnected.json','client-fixed-links.json','原文与客户端A-B逐题审查.html'])
  assert not any(n.endswith(('.db','.pdf','.docx','.exe','.png')) or 'internal-only' in n for n in names)
  assert all((destination/n).resolve().is_relative_to(destination.resolve()) for n in names);z.extractall(destination)
 manifest=json.loads((destination/'redaction-manifest.json').read_text(encoding='utf8'));assert all(common.sha(destination/x['name'])==x['redactedSHA256'] for x in manifest['files'])
 for split in ['train','validation','heldout']:
  assert [json.loads(x) for x in (destination/'datasets'/f'{split}.jsonl').read_text(encoding='utf8').splitlines()]==json.loads((destination/'datasets'/f'{split}.json').read_text(encoding='utf8'))
 original=json.loads((destination/'source-evidence.json').read_text(encoding='utf8'));ids={u['evidenceId'] for d in original for u in d['units']};assert all(e['evidenceId'] in ids for c in load('cases.json') for e in c['evidence'])
 validCites=[cite for r in load('agent-paired-review.json') for arm in ['A','B'] for cite in load('results/'+r['id']+'.json')[arm]['localTrace'].get('citations',[])];assert all(c in ids for c in validCites)
 save('zip-integrity-check.json',{'path':result['path'],'bytes':result['bytes'],'sha256':common.sha(result['path']),'files':len(names),'results':12,'unzipPassed':True,'redactedHashesMatch':True,'allPairedAndExpectedCitationsResolve':True,'knownMultiturnFakeCitationIntentionallyPreserved':True,'uploaded':False})
 print(json.dumps({'path':result['path'],'bytes':result['bytes'],'sha256':common.sha(result['path']),'verified':True},ensure_ascii=False))

if __name__=='__main__':main()
