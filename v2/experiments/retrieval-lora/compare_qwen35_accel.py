"""Compare all original measurements, retaining slow runs and jitter."""
import json
import statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/qwen35-accel'
OLD=ROOT/'tmp/qwen35-08b-bf16-benchmark'
NEW=WORK/'benchmark'
assert json.loads((WORK/'status.json').read_text())['stage']=='complete'
proof=json.loads((WORK/'kernel-verification.json').read_text(encoding='utf-8'))
assert proof['verified']
def read(folder):
    return [r for line in (folder/'runs.jsonl').read_text(encoding='utf-8').splitlines()
            if not (r:=json.loads(line))['warmup']]
baseline=read(OLD); accelerated=read(NEW)
assert len(baseline)==len(accelerated)==18
for old,new in zip(baseline,accelerated):
    for field in ['prompt_id','prompt','target_max_new_tokens','repeat','input_tokens']:
        assert old[field]==new[field]
old_env=json.loads((OLD/'environment.json').read_text())
new_env=json.loads((NEW/'environment.json').read_text())
for field in ['torch','transformers','gpu','model','thinking','quantization','attention','sampling','repetition_penalty','batch_size','eos_token_id']:
    assert old_env[field]==new_env[field], field
def stat(rows):
    values=[r['decode_tokens_per_s'] for r in rows]
    mean=statistics.mean(values)
    return dict(mean=mean,min=min(values),max=max(values),stdev=statistics.stdev(values),
                cv_percent=statistics.stdev(values)/mean*100,ttft_ms=statistics.mean(r['ttft_s'] for r in rows)*1000,
                prompt_tokens_per_s=statistics.mean(r['prompt_tokens_per_s'] for r in rows),
                total_decode_tokens=sum(r['decode_tokens'] for r in rows),
                aggregate_decode_tokens_per_s=sum(r['decode_tokens'] for r in rows)/sum(r['decode_s'] for r in rows))
groups=[]
for limit in [128,256,512]:
    for prompt in ['engineering','explanation']:
        a=[r for r in baseline if r['target_max_new_tokens']==limit and r['prompt_id']==prompt]
        b=[r for r in accelerated if r['target_max_new_tokens']==limit and r['prompt_id']==prompt]
        sa,sb=stat(a),stat(b)
        groups.append(dict(limit=limit,prompt=prompt,before=sa,after=sb,
                           uplift_percent=(sb['mean']/sa['mean']-1)*100,
                           actual_tokens=[r['actual_generated_tokens'] for r in b]))
a,b=stat(baseline),stat(accelerated)
comparison=dict(before=a,after=b,uplift_percent=(b['mean']/a['mean']-1)*100,
    uplift_vs_33_percent=(b['mean']/33-1)*100,groups=groups,
    max_allocated_mib=max(r['peak_allocated_mib'] for r in accelerated),
    max_reserved_mib=max(r['peak_reserved_mib'] for r in accelerated),
    kernel_launches=proof['launches'],repetition_guard_hits=sum(r['loop_guard_triggered'] for r in accelerated),
    thinking_marker_hits=sum(r['thinking_marker_in_output'] for r in accelerated),
    causal_conv1d_installed=False,original_environments_modified=False)
(WORK/'comparison.json').write_text(json.dumps(comparison,indent=2),encoding='utf-8')
lines=['# Qwen3.5-0.8B BF16：隔离FLA加速验证与对照', '',
       '2026-10-20。Windows / RTX3060 12GB。仅原始BF16推理，不使用量化、GGUF或其他模型，不训练，不停止/重启现有服务。', '',
       '## 原因与实际安装', '',
       '原始Transformers日志明确显示chunk_gated_delta_rule、fused_recurrent_gated_delta_rule及causal_conv1d均回退参考PyTorch实现。',
       '独立测试虚拟环境 tmp/qwen35-accel/venv 通过.pth只读复用旧训练环境site-packages，自己的site-packages优先；只安装现成flash-linear-attention0.5.2和fla-core0.5.2 wheel，--no-deps/--only-binary，没有重新安装torch、CUDA或Transformers。',
       '隔离环境的Triton最初找不到自带CUDA与C编译器；仅在测试进程设置CUDA_PATH和CC指向既有triton-windows工具，修复后GPUTarget为cuda/sm86，FLA设备cuda。未设置全局环境变量。',
       '官方Unsloth匹配Windows cp312/torch2.10/CUDA13的causal-conv1d1.7.0预编译包下载因GitHub TLS失败，未转源码编译；卷积仍是PyTorch CUDA参考实现。因此是部分加速，不声称两类扩展全部装好。', '',
       '## 内核确实被调用', '',
       '对实际本地模型的8Tokens试运行挂接Triton launch_enter_hook，CUDA同步成功后记录内核名。既有chunk预填充内核，也有fused_recurrent_gated_delta_rule_fwd_kernel逐Token解码内核；记录见kernel-verification.json。探针设置一次180秒超时，成功后才进入测速；没有反复尝试源码编译。测速期间不保留launch计数钩子。', '',
       '## 同脚本、同输入、同参数结果', '',
       '直接导入并调用原benchmark_qwen35_bf16.py，仅将输出目录切换到隔离环境结果目录。Torch/Transformers、模型、两种提示词、关闭Thinking、greedy、重复惩罚1.1、128/256/512上限、每组三次与同步计时方法一致，脚本逐字段核验。预热和探针不纳入统计。', '',
       '| 输入 | Tokens | 原均值 Tokens/s | FLA均值 Tokens/s | 实际提升 | FLA三次范围 | FLA变异系数 |',
       '|---|---:|---:|---:|---:|---|---:|']
for g in groups:
    lines.append(f"| {g['prompt']} | {g['limit']} | {g['before']['mean']:.2f} | {g['after']['mean']:.2f} | {g['uplift_percent']:+.1f}% | {g['after']['min']:.2f}～{g['after']['max']:.2f} | {g['after']['cv_percent']:.1f}% |")
lines += ['',f"全部18次每次解码速度的算术均值：原{a['mean']:.2f} → FLA {b['mean']:.2f} Tokens/s，{comparison['uplift_percent']:+.1f}%。",
    f"相对用户给定约33 Tokens/s参考值，FLA均值提升{comparison['uplift_vs_33_percent']:+.1f}%。原完整基准并非恒定33，512档曾降至13.72，因此两种提升口径分开列出。",
    f"按总解码Tokens/总解码时间的加权总体吞吐：{a['aggregate_decode_tokens_per_s']:.2f} → {b['aggregate_decode_tokens_per_s']:.2f} Tokens/s。",
    f"平均TTFT：{a['ttft_ms']:.1f} → {b['ttft_ms']:.1f}ms；Prompt forward吞吐均值：{a['prompt_tokens_per_s']:.1f} → {b['prompt_tokens_per_s']:.1f} Tokens/s。",
    f"FLA本进程峰值allocated {comparison['max_allocated_mib']:.1f}MiB，reserved {comparison['max_reserved_mib']:.1f}MiB。全部参数权重仍CUDA BF16。",
    f"输出循环保护命中{comparison['repetition_guard_hits']}/18，Thinking标记{comparison['thinking_marker_hits']}/18。所有原始输出、实际Token数、逐Token计时保存在benchmark/runs.jsonl。", '',
    '稳定性只依据本轮每组三次的范围及变异系数，不是长时间压力测试。现有服务和桌面进程保留，显卡不是独占；不剔除慢结果，不能唯一归因所有波动。内核实调用与同参数速度改善可证实本方案有效，但不能将含明显抖动的完整原基准均值作为普遍提升保证。', '',
    '原训练及Studio环境没有安装FLA，没有自动将测试方案切入任何服务。Windows下普通Triton首次JIT已成功；未进行causal-conv1d源码编译或大规模环境重装。', '',
    '来源：[FLA官方项目](https://github.com/fla-org/flash-linear-attention)、[Unsloth官方预编译发布](https://github.com/unslothai/unsloth/releases/tag/prebuilt-wheels-cu13)。']
path=ROOT/'docs/v2/reports/2026-10-20-qwen35-08b-fla-acceleration.md'
path.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(comparison,indent=2))
