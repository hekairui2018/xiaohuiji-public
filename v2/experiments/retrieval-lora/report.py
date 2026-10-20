"""Build a factual local receipt from preserved evaluation/training artifacts."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/retrieval-lora-20261020'
RESULTS=WORK/'results'


def main():
    comparison=json.loads((RESULTS/'comparison.json').read_text(encoding='utf-8'))
    training=comparison['training']
    sets=[]
    for name in ['baseline','lora','baseline-1.7b']:
        records=json.loads((RESULTS/f'{name}.raw.json').read_text(encoding='utf-8'))
        sets.append([(r['id'],r['customer']) for r in records])
    assert sets[0]==sets[1]==sets[2], 'Models did not receive identical heldout questions'
    adapter=WORK/'adapter/adapter_model.safetensors'
    assert adapter.stat().st_size<50_000_000
    assert not (WORK/'adapter/model.safetensors').exists()
    interface=json.loads((RESULTS/'interface-verification.json').read_text(encoding='utf-8'))
    dispatch=json.loads((RESULTS/'dispatch-verification.json').read_text(encoding='utf-8'))
    assert interface['passed'] and dispatch['passed']
    samples=json.loads((RESULTS/'gpu-samples.json').read_text(encoding='utf-8'))
    comparison['gpu_peak_total_mib']=max(x['used_mib'] for x in samples)
    comparison['adapter_bytes']=adapter.stat().st_size
    comparison['adapter_sha256']=hashlib.file_digest(adapter.open('rb'),'sha256').hexdigest()
    comparison['interface_passed']=True;comparison['dispatch_passed']=True
    (RESULTS/'comparison.json').write_text(json.dumps(comparison,ensure_ascii=False,indent=2),encoding='utf-8')
    models=[comparison[k] for k in ['baseline','lora','baseline_1_7b']]
    def pct(x):return f'{100*x:.1f}%'
    def table_row(label,values):return '| '+label+' | '+' | '.join(values)+' |\n'
    table='| 指标（同一16题） | 原版0.6B | 0.6B LoRA | 原版1.7B |\n|---|---:|---:|---:|\n'
    table+=table_row('JSON语法合法率',[pct(m['json_valid_rate']) for m in models])
    table+=table_row('V2指令协议合法率',[pct(m['protocol_valid_rate']) for m in models])
    table+=table_row('搜索资料类型（14题）',[f"{m['applicable_metrics']['search_kind']['correct']}/14 ({pct(m['applicable_metrics']['search_kind']['rate'])})" for m in models])
    table+=table_row('型号字段完全匹配（含空字段）',[pct(m['metrics']['models']) for m in models])
    table+=table_row('芯片字段完全匹配（含空字段）',[pct(m['metrics']['chips']) for m in models])
    table+=table_row('版本字段完全匹配（含空字段）',[pct(m['metrics']['version']) for m in models])
    table+=table_row('完整字段与固定关键词均匹配',[f"{round(m['metrics']['strict']*16)}/16 ({pct(m['metrics']['strict'])})" for m in models])
    table+=table_row('平均GPU生成耗时',[f"{m['mean_latency_s']:.2f} 秒" for m in models])
    table+=table_row('输出速度（总输出Token/总生成时间）',[f"{m['aggregate_tokens_per_s']:.2f} Token/s" for m in models])
    table+=table_row('平均输出长度',[f"{m['mean_output_tokens']:.1f} Token" for m in models])
    report=f'''# 小灰机 V2 第一检索动作 LoRA 本地实验（2026-10-20）

## 结论

实际训练已完成，0.6B在指令格式、资料类型选择及不乱填空字段方面有改善；速度没有改善，仍存在芯片、版本和故障检索方向错误。不能据此上线，也不能宣称已经学会工程师的判断过程。1.7B只做原版评估，没有继续微调；其同题结果没有全面优于0.6B LoRA，当前不支持仅靠加大模型或增加轮数解决问题。

## 数据和审核边界

100条候选：80条明确查询意图由本地Agent按用户要求及现有工具/分类完成政策和协议审核，不冒充工程师人工审核；20条真实售后现象的首查方向待工程师审核，全部排除出本轮训练及主评分。真实候选由案例元数据型号与归档现象组成，不是逐字客户会话原文，来源和原现象均保留；没有将历史维修结论作为标签。

实际训练48条、验证16条、独立测试16条。全部不同案例组及字面去重；测试标签没有进入模型提示词，也没有训练测试示例。按既定固定评分，不因测试错误修改标签或增加训练轮数。样本仍较少，且明确意图样本主要为合成表达，不能代表真实售后分布。固定关键词严格匹配可能低估“调试教学视频”等同义表达，不能当独立工程师语义评分。

审核表：tmp/retrieval-lora-20261020/data/review.html；原始数据candidates.jsonl以及train/validation/test.jsonl。20条待审已显著标色，可按ID反馈标签。

## 环境与训练

独立Python虚拟环境位于tmp/retrieval-lora-20261020/venv。官方Qwen/Qwen3-0.6B原始safetensors固定revision c1899de289a04d12100db370d81485cdf75e47ca，并核对官方LFS SHA256；未用GGUF。额外原版1.7B固定revision 70d244cc86ccca08cf5af4e1e306ecf908b1ad5e，两片权重各核对官方SHA。

Unsloth 2026.10.7 + PyTorch2.10.0/cu130 + Windows Triton3.6.0；完整依赖requirements.lock.txt。BF16非量化LoRA，rank8/alpha16，batch1，累积4，序列512，固定36步（3个遍历），学习率2e-4。仅对约504万LoRA参数训练，提示词部分的labels为-100，只学习JSON指令。不写产品参数或最终答案。

训练本身耗时 **{training['train_seconds']:.2f}秒**，首个优化步骤另有smoke.json成功回执；首次安装与下载耗时不包含在这个数字内。PyTorch峰值实际分配 **{training['peak_allocated_mib']:.0f}MiB**、保留 **{training['peak_reserved_mib']:.0f}MiB**；整卡采样峰值 **{comparison['gpu_peak_total_mib']}MiB**，包含桌面等其他程序。没有结束原有服务来释放显存。

仅保存LoRA适配器（**{adapter.stat().st_size:,}字节**）、必要tokenizer及测试结果；原始权重保留在独立缓存供推理复用，没有合并、保存全参数训练检查点或导出GGUF。

## 相同留出集对照

三者使用相同提示词、原始客户问题、Thinking关闭、贪心生成、256 Token安全上限。每个模型先执行相同非计分warmup，再逐题CUDA同步计时。无JSON强制语法、无输出修复、无自动补字段。所有16题输出均少于100 Token。平均时间不含环境安装、模型加载和warmup，独立接口冷启动另有日志。

{table}

0.6B原版常把“资料类型”“version”等占位文字照抄入JSON，因此语法合法但协议不合法。字段指标仍独立计算：协议错不抹去已正确提取的型号。

有实际型号的11题，三者均11/11；型号总体差异主要来自没有型号时是否乱填软件名。有实际芯片的3题，原版0.6B为3/3、LoRA为2/3、原版1.7B为3/3；LoRA减少了空芯片字段编造，却在ICN2153原文题漏提。唯一明确四段版本号的题目三者均漏提/错误，因此总体版本字段93.8%绝不表示已学会版本提取。

## 兼容验证

- 数据与协议单元测试4项通过；100条候选及16条真实LoRA输出通过当前V2动作schema检查。
- 独立127.0.0.1随机端口模型接口3次实际请求均200：型号对比、芯片固件查询、含糊问题追问。只输出JSON，不执行搜索或生成答案，结束后关闭自己的临时进程。
- 模型生成的两条search指令实际交给临时V2应用及已有检索工具执行。型号对比取回6条证据，并用授权句柄读取1条原文；固件查询返回0条，保留空结果，未编造可用固件。
- 验证时8520/8521不在运行，因此使用现有索引目录启动临时只读索引、随机端口，结束后关闭；没有恢复、重启或改动正式服务及其配置。

## 已修复的实验运行问题

CUDA包首次下载损坏：改固定兼容组合并从官方源分段下载、校验哈希。中文缓存路径被Triton原生扩展误解码：改独立英文临时编译缓存。Windows虚拟环境启动器PID与真实Python进程PID不同：独立接口改为每次运行随机nonce核对身份，重试通过。torchao被当前Transformers视为不可用，非量化LoRA明确跳过它，不宣称量化可用。以上均仅在实验环境内处理。

## 剩余问题与下一步证据

本轮有实际格式/路由收益，没有速度收益。原生Windows/BF16/未合并LoRA当前实现不能据此认定比Bonsai快。下一步先审核20条真实候选、补充四段版本号和芯片/软件名边界，再冻结新的测试集；不得继续使用本测试集追分。真实工程优先级、资料适用边界与新证据后改判尚未纳入训练验证。

原始输出、逐题耗时、训练loss、显存采样、SHA、接口和实际检索回执均在tmp/retrieval-lora-20261020/results。所有改动只在本地，没有提交、推送、部署或修改生产模型配置。
'''
    path=ROOT/'docs/v2/reports/2026-10-20-retrieval-lora-local.md';path.write_text(report,encoding='utf-8')
    print(path)


if __name__=='__main__':main()
