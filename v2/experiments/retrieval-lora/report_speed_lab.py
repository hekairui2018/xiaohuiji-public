"""Publish measured results only, not theoretical throughput or answer quality."""
import json
from pathlib import Path
import statistics
ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/qwen35-speed-lab'
suite=json.loads((WORK/'suite-status.json').read_text(encoding='utf-8'))
assert suite['stage']=='complete'
names={'01_fla_hf':'FLA，本轮基线','02_fla_conv_hf':'FLA + causal-conv1d',
    '03_no_penalty':'上项 + 关闭重复惩罚','04_manual_dynamic':'上项 + 低开销逐Token循环',
    '05_static':'上项 + 静态KV/SSM缓存','06_graph':'上项 + CUDA Graph单步',
    '07_graph8':'CUDA Graph，每次重放8步','08_compile':'静态缓存 + torch.compile',
    '09_winner_retest':'第一阶段最快组合复测',
    '10_compile_graph':'torch.compile + CUDA Graph单步',
    '11_compile_graph8':'torch.compile + CUDA Graph八步',
    '12_final_retest':'最终最快组合完整复测'}
complete=[r for r in suite['outcomes'] if not r['quick'] and r['exit_code']==0 and r.get('runs')==12]
table=['| 方案 | 平均 t/s | 最高 t/s | 显存峰值 allocated / reserved |',
       '|---|---:|---:|---:|']
for r in complete:
    table.append(f"| {names.get(r['name'],r['name'])} | {r['aggregate_tokens_per_s']:.2f} | {r['maximum']:.2f} | {r['peak_allocated_mib']/1024:.2f} / {r['peak_reserved_mib']/1024:.2f} GiB |")
failed=[r for r in suite['outcomes'] if r['exit_code']!=0]
lines=['# Qwen3.5-0.8B BF16 单路生成速度优化', '', '日期：2026-10-20。RTX3060 12GB / Windows。', '',
    *table, '',
    '平均t/s统一使用总解码Token数/总解码秒数，最高t/s为各次完整生成的最高吞吐，不是瞬时值。显存是本测试进程PyTorch峰值allocated与reserved，不含既有服务。', '',
    '## 固定测试协议', '',
    '- 原始本地Qwen3.5-0.8B，全部模型参数CUDA BF16；没有Q4/GGUF、量化、训练、权重修改或其他模型下载。',
    '- 基于原FLA环境，新增隔离venv复用原torch2.10.0+cu130/transformers5.17.0。causal-conv1d官方Windows/Python3.12/PyTorch2.10/CUDA13预编译包在隔离venv安装，原环境未覆盖。',
    '- 输入固定为此前engineering提示及同一系统提示，官方模板enable_thinking=False；单路、greedy，忽略EOS直到指定数量。没有语义/质量评估，重复Token照常计入。',
    '- 每个成功全量方案分别生成128、256、512、1024Tokens各3次，共12次；32及128Tokens预热排除，探针排除。模型加载、编译、Graph捕获、预填充均不计入解码速度。',
    '- decode_tokens=N−1：首Token属于预填充；开始和结束CUDA同步，后续N−1次真正逐Token模型执行计时。手动/Graph方案的GPU输出Token写入计时，整段CPU导出不计时。',
    '- HF基线保留原streamer，因此有逐Token CPU回传；低开销循环移除此生成调度并保留GPU输出。手动解码结束后，核验位置计数和缓存序列长度确实推进N−1步，防止重复重放固定位置。',
    '- 成功Graph方案每次先reset缓存并重新prefill原输入，固定缓存容量为输入长度+1040。每次图内计算下一Token、更新KV/SSM状态与位置，单路自回归；8步图逐一保存8个真实输出，不将它当并行batch。',
    '- 一次只改一项：卷积扩展→重复惩罚→生成调度→静态缓存→Graph，另以静态缓存为父项测试torch.compile。每个新兼容方案先单次128Tokens探针，通过后跑全量。探针不参与最终表。',
    '- 最快初测方案按加权总吞吐选择，新进程重新加载、预热并完整12次复测。现有服务保留，不是独占显卡；波动不剔除，不保证这是硬件绝对上限。', '',
    f"初测最快方案：{suite['winner']}。", '', '## 每个长度的复测数据', '',
    '| 方案 | 生成Tokens | 三次t/s | CV |', '|---|---:|---|---:|']
for r in complete:
    records=[json.loads(s) for s in (WORK/'results'/r['name']/'runs.jsonl').read_text().splitlines()]
    for count in [128,256,512,1024]:
        values=[x['tokens_per_s'] for x in records if not x['warmup'] and x['tokens']==count]
        lines.append(f"| {names.get(r['name'],r['name'])} | {count} | {', '.join(f'{v:.2f}' for v in values)} | {statistics.stdev(values)/statistics.mean(values)*100:.2f}% |")
lines += ['', '## 跳过或失败的方案', '']
for r in failed:
    lines += [f"- {r['name']}：退出码{r['exit_code']}，耗时{r['seconds']:.1f}秒。完整日志 `{r['name']}.stderr.log`；末尾：",'```',r.get('error_tail','')[-1700:],'```']
if not failed:lines.append('本轮列出的方案均完成。')
lines += ['', '## 原件与复现', '',
    '实验脚本 `v2/experiments/retrieval-lora/speed_lab.py`；串行调度和限时 `run_speed_lab.py`。结果、逐Token输出ID、元数据和所有stdout/stderr位于 `tmp/qwen35-speed-lab`。每种方案的environment.json保留原生causal-conv1d fwd/update实际调用次数，计数钩子只在预热开启，正式测量前移除。',
    '没有停止/重启现有服务，没有超频或更改全局Python/系统CUDA；没有提交、推送或部署。', '',
    '[官方Unsloth预编译包](https://github.com/unslothai/unsloth/releases/tag/prebuilt-wheels-cu13)。']
report='\n'.join(lines)+'\n'
(ROOT/'docs/v2/reports/2026-10-20-qwen35-bf16-speed-lab.md').write_text(report,encoding='utf-8')
(WORK/'report.md').write_text(report,encoding='utf-8')
(WORK/'final-table.md').write_text('\n'.join(table)+'\n',encoding='utf-8')
print('\n'.join(table))
print('WINNER',suite['winner'])
print('FAILURES',[r['name'] for r in failed])
