"""Local evidence report. Never exports Studio databases, credentials or user chats."""
import hashlib,json,sqlite3
from pathlib import Path
import urllib.request
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'tmp/studio-fast-chat-20261020'
ui=json.loads((OUT/'ui-results.json').read_text(encoding='utf-8'))
protocol=json.loads((OUT/'protocol-tests.json').read_text(encoding='utf-8'))
ready=json.loads(urllib.request.urlopen('http://127.0.0.1:8890/health').read())
original=ROOT/'tmp/qwen35-08b-base/model.safetensors-00001-of-00001.safetensors'
digest=hashlib.file_digest(original.open('rb'),'sha256').hexdigest()
assert digest=='04b1c301231dd422b8860db31311ab2721511346a32cb1e079c4c4e5f1fe4696'
manifest=[]
for p in (OUT/'backups').iterdir():
    if p.is_file():manifest.append({'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()})
(OUT/'backups/manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
lines=['# Unsloth Studio BF16 CUDA Graph 本地接入验收','',
'2026-10-20；Windows / RTX 3060 12GB。全部速度来自实际 Studio 界面输入、发送与流式输出。',
'','## 使用','',
'双击项目根目录 `Open-Unsloth-Fast-Chat.cmd`。聊天顶部模型下拉 → Connected → 本机 Qwen3.5 BF16 · CUDA Graph：',
'','- `Qwen3.5-0.8B-BF16-Fast-Greedy`：原版高速贪心。',
'- `Qwen3.5-0.8B-LoRA-Fast-Greedy`：已有 LoRA 高速贪心。',
'- `...-Normal`：普通推理，保留采样。',
'- 原来的 `qwen35-08b-base LoRA` 是 Studio 原生普通入口，继续保留，并未自动切换用户已有聊天。',
'','高速模式名称明确约定贪心解码，关闭 Thinking，遵守 EOS；不以忽略 EOS 的基准结果冒充真实聊天速度。普通模式接受 Temperature/Top P。',
'','## 最终完整界面复测','',
'| 测试 | 实际输出 Tokens | 解码 t/s | 后端首 Token ms | 峰值 allocated MiB |',
'|---|---:|---:|---:|---:|']
for r in ui['results']:
    s=r['server']
    lines.append(f"| {r['name']} | {s['completion_tokens']} | {s['tokens_per_s']:.2f} | {s['ttft_ms']:.2f} | {s['peak_allocated_mib']:.2f} |")
lines+=['',
'首 Token 为 CUDA 同步测得的后端预填充时间；不包含浏览器传输、界面绘制或冷启动。解码计时从首 Token 后开始，包含真实分块流式传输和 CPU 文本解码开销；CUDA 完成同步后结束。实际 token 数量和每步缓存位置均记录，不用字符数估算。',
'','一次前轮完整复测原版为 127.23–129.38 t/s，LoRA 为 112.02–117.74 t/s；最终复测见上表，未达到独立实验 152 t/s。',
'','## 初始化','',
f"- 原始 BF16 权重加载 {ready['metrics']['load_seconds']:.2f} 秒；已有 LoRA 加载 {ready['metrics']['adapter_load_seconds']:.2f} 秒。",
f"- 本次启动基础模型编译与录图 {ready['metrics']['base']['compile_seconds']:.2f} 秒；LoRA {ready['metrics']['adapter']['compile_seconds']:.2f} 秒。两套在服务 ready 前完成。",
'- 后续多轮、不同长度、普通/高速切换没有再次编译。FLA 的预填充与 recurrent CUDA kernel 实际调用已记录在 ready.json / protocol-tests.json。',
'- 使用现有 speed-lab Python、Transformers 5.17、FLA、causal-conv1d；未安装或升级依赖。显式 CUDA Graph 保留，关闭 torch.compile 自带 graph-tree，修复 Windows HTTP 工作线程的 TLS 断言。',
'- 现有可选 torchao 0.15 与 PEFT 不匹配，仅在本独立 BF16 进程跳过 torchao 分派；未改量化、训练环境和模型文件。',
'','## 状态与回退验证','',
'- 两个原版固定问题，高速与普通贪心前 48 Tokens 逐个相同；重复请求完全相同。',
'- 每个高速请求检查 token 位置及 KV 长度按真实计算步数推进；每次新请求重置 KV、Gated DeltaNet/SSM 状态。多轮上下文由 Studio 的 messages 显式传入。',
'- LoRA 严格逐 Token 一致测试有一例失败，未掩盖：第 18 个 Token 分歧。随后逐步固定相同前缀，48 步中 47 步 argmax 一致，另一步高速选项是普通参考第二名，分数仅差 0.0625（该值处一个 BF16 单位）。静态/动态普通参考都检查过。编译路径不保证位级一致；这与缓存停滞分开记录，详见 lora-teacher-forcing.json。',
'- 长输入 5011 Tokens 自动回退普通 CUDA 推理；高速固定容量为 2048，要求输入加最大输出及余量小于容量。',
'- 断开高速流后可继续下一条请求；同一 GPU 忙时另一请求返回 429，不覆盖在途状态。',
'- 模型预热状态在测试前后完全一致；6 组状态/恢复检查通过，另行保留上述严格数值一致性失败。',
f"- UI 完整复测 {len(ui['results'])} 项，浏览器错误 {len(ui['errors'])} 个；Python/Node 语法与双击入口复用检查通过。",
'','## 实际接入范围及保留项','',
'- 使用 Studio 原生 Custom/OpenAI 兼容连接和原生模型选择、聊天历史、流式渲染、速度显示；新增独立 127.0.0.1:8890 服务。没有更换 Studio 内部模型 worker 或其 Transformers 5.3 训练侧环境。',
'- 未修改任何既有 Studio 源码文件；仅通过官方 API 添加一条本机 provider。修改前 SQLite 在线备份和原 provider 列表保存在 backups（私有，不发布）。',
'- 本次未停止或重启 Studio、Bonsai、小灰机；只重载了本轮自己创建的独立加速进程。没有训练、量化、下载新模型、提交、推送或部署。',
'- 高速目前仅文本、单路贪心；超容量/编译不可用回退正常，图像和工具请求明确拒绝，保留 Studio 原始入口处理其他能力。',
'- 原始模型 SHA256：`'+digest+'`，与接入前一致。',
'- 当前默认列出一份已存在且核对过的 LoRA；切换其他适配器需要重新加载并录图，不能复用旧图。',
'- Studio 的长度到顶提示由原生前端生成；不是 GPU 内存不足的证据。',
'','## 证据文件','',
'`ui-results.json`、`ui-*.png`、`chat-runs.jsonl`、`ready.json`、`protocol-tests.json`、`lora-teacher-forcing.json`、`server-v3.stderr.log`。这些文件均为本地资料。']
(OUT/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
(OUT/'final-verification.json').write_text(json.dumps({'ui_tests':len(ui['results']),'browser_errors':ui['errors'],
    'state_tests':len(protocol['tests']),'bf16_weights_sha256':digest,'ready':ready},ensure_ascii=False,indent=2),encoding='utf-8')
print('Local report saved:',OUT/'README.md')
