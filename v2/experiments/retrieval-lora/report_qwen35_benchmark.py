"""Render the completed benchmark's measurements and actual output excerpts."""
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT/'tmp/qwen35-08b-bf16-benchmark'
summary = json.loads((OUT/'summary.json').read_text(encoding='utf-8'))
status = json.loads((OUT/'status.json').read_text(encoding='utf-8'))
assert status['stage']=='complete'
rows = [json.loads(line) for line in (OUT/'runs.jsonl').read_text(encoding='utf-8').splitlines()]
runs = [r for r in rows if not r['warmup']]
assert len(runs)==18
env = summary['environment']
lines = ['# Qwen3.5-0.8B 原始 BF16 独立 GPU 推理测试', '',
         '日期：2026-10-20。只做推理，未训练、未下载、未转换或使用GGUF/量化模型；未改动或停止Studio、Bonsai及小灰机服务。', '',
         f"模型加载耗时 **{env['load_seconds']:.3f} 秒**（from_pretrained开始至CUDA同步结束；不包含Python/库启动和tokenizer加载）。",
         f"环境：RTX3060 12GB / Windows / PyTorch {env['torch']} / Transformers {env['transformers']}，复用原训练venv，未安装依赖。",
         f"权重参数张量全部在CUDA：{env['parameter_devices']}；精度：{env['parameter_dtypes']}。没有CPU offload。", '',
         '两种固定输入：LED整屏突然无画面的分析（engineering），文字如何变成屏幕图像的教程（explanation）。完整输入、实际输出和逐Token到达时间均在runs.jsonl中。每种输入预热32Tokens一次，预热不进入统计；然后每种输入分别128/256/512Tokens各3次，共18次正式测试。', '',
         '| 输入 | 生成上限 | 实际生成（三次） | TTFT均值(ms) | Prompt处理速度均值(Tokens/s) | 纯解码均值(Tokens/s) | 解码范围 |',
         '|---|---:|---|---:|---:|---:|---|']
for g in summary['groups']:
    lines.append(f"| {g['prompt_id']} | {g['max_new_tokens']} | {g['actual_tokens']} | {g['ttft_s']['mean']*1000:.1f} | {g['prompt_tokens_per_s']['mean']:.1f} | {g['decode_tokens_per_s']['mean']:.2f} | {g['decode_tokens_per_s']['min']:.2f}～{g['decode_tokens_per_s']['max']:.2f} |")
lines += ['', '计时方法：', '',
          '- 输入已在CUDA。generate开始前CUDA同步，逐Token streamer同步后记时，首个输出Token时间减开始时间为TTFT，包含生成框架准备、预填充和首Token选取。',
          '- 顶层模型forward钩子单独同步测量首次forward；Prompt处理速度=输入Token数/首次forward耗时。这是预填充forward吞吐，不能与后续解码混算。',
          '- 纯输出解码速度=(实际Token数−1)/(最后Token到达时间−首Token到达时间)，排除首Token预填充；同步及streamer本身会带来少量测量开销。输入tokenizer和磁盘输出时间不算入生成。',
          '- 关闭Thinking，使用本地官方apply_chat_template(enable_thinking=False)，检查提示以关闭思考的模板后缀结束。greedy、batch1、KV cache开启、repetition_penalty=1.1。',
          '- 正确聊天EOS为tokenizer的<|im_end|>（248046）；仅在本次generate调用中指定，没有修改原始config文件。保留自然EOS，没有强迫达到最小长度。',
          '- 安全停止条件为三个连续相同32Token片段；实际输出Token数包含生成序列的特殊Token（如果出现）。', '',
          f"本进程PyTorch峰值allocated：{max(r['peak_allocated_mib'] for r in runs):.1f} MiB；峰值reserved：{max(r['peak_reserved_mib'] for r in runs):.1f} MiB。",
          f"整卡原本占用{env['baseline_gpu']['device_total_used_mib']} MiB（其他现有进程保留），模型加载后{env['after_load_gpu']['device_total_used_mib']} MiB；整卡快照不能全部归因于本模型。",
          f"测试结束释放本次模型后整卡快照：{status['after_release_gpu']}。", '',
          f"重复循环保护触发{summary['loops']}/18次，输出Thinking标记{summary['thinking_markers']}/18次；全部结束原因：{sorted(set(r['finish_reason'] for r in runs))}。",
          '这些较长教程输入用于覆盖指定长度；到达length表示本次输出预算用尽，不代表已经回答完整。样本抽查可见正常中文正文，没有出现此前持续自我反问的思考循环。',
          '性能正常不代表工程判断正确：LED样本仍出现“背光模组”等不适用于自发光LED屏的泛化表述，原版模型不能因此被认为掌握公司工程经验。', '',
          '环境限制：现有环境缺少causal_conv1d与flash-linear-attention，Transformers明确回退参考PyTorch实现，仍在CUDA计算。未为性能指标安装加速包。没有与Studio相同提示、同一适配器、相同解码设置的受控对照，不能将本次速度差异唯一归因于前端。', '',
          '较长输出的重复测试有明显速度波动，全部保留，未剔除较慢结果。测试使用独立Python进程，但没有独占显卡，Studio及其他桌面进程仍在；现有快照不足以把波动唯一归因于GPU争用、CPU调度或其他原因。表格同时给出范围，不能只用最快一轮作为稳定性能。', '',
          '## 实际输出摘录', '']
for prompt in ['engineering','explanation']:
    r=next(r for r in runs if r['prompt_id']==prompt and r['target_max_new_tokens']==512)
    lines += [f"### {prompt}，512Tokens，第1次", '', r['output'], '']
report = '\n'.join(lines)+'\n'
path = ROOT/'docs/v2/reports/2026-10-20-qwen35-08b-bf16-inference.md'
path.write_text(report,encoding='utf-8')
(OUT/'report.md').write_text(report,encoding='utf-8')
print(str(path))
print('ALL_MEAN_DECODE',statistics.mean(r['decode_tokens_per_s'] for r in runs))
print('ALL_TTFT_MS',statistics.mean(r['ttft_s'] for r in runs)*1000)
print('GROUPS',json.dumps(summary['groups']))
