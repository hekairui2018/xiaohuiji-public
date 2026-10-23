## 2026-10-23：配单重复运行复验

- 实际35组54轮首测34组通过，发现同句后续模组偏好抢走前述整屏米数；修复为数值所属分句识别，保留首次失败记录。
- 修复候选及重启后8520均35组54轮复验通过，12次相同完整句的清单/连接图一致；网页另独立运行3次共18轮，含修改排列和390px检查。316项定向回归通过，全程无模型调用，不是客户盲测。
- 仅替换V2一份运行解析源码，未变原件/索引或一代；报告docs/v2/reports/2026-10-23-ordering-repeated-acceptance.md；原始记录tmp/ordering-repeat-20261023。

## 2026-10-23：缺模组规格的条件配单与几何推导

- 修复“不知道模组/按常规配”脱离当前配单；关键用途条件齐全后交付条件清单和连接图，未知规格保留为假设，不重复索要整套参数。支持点间距、物理尺寸与像素的精确推导，冲突及非整数像素不放行。
- 八轮实际接口、六轮浏览器及390px检查通过，314项定向回归通过；V2七份运行源码已切换并重新验收，保留原参数和其他已有改动。十宽十高按模组排列，十米须明确单位；大型未求解工程如实说明，不冒称全部多机方案已实现。
- 报告：docs/v2/reports/2026-10-23-ordering-conditional-inference.md；私有回执tmp/ordering-inference-20261023。一代与原始资料未变，带假设方案仍不生成现场导入配置。

## 2026-10-23：V2 客服检索与诊断可靠性

- 按参数、操作、案例及文件线索建立只读派生索引；保留原文身份、条件及分页，修复参数误引案例、操作章节丢失、错字解释和跨轮条件接续。
- 专家诊断状态跨轮保留，下一步对照使用模型选择与受控模板，区分重插/已完成对照、真实/假设拓扑及软件/屏体故障；不直接确诊。
- 定向 Node 333 项、Python 47 项通过；公开无私有数据子集 147/21 项。首次上线专家失败后恢复原版，修正后再次上线，最终九轮快速问答及一轮真实专家验收通过，专家该题约 12.9 秒。开发回归不是客户盲测。
- V2 核心和索引已切换并核验本机/公网，原始索引哈希不变；仅同步可公开源码、合成测试与脱敏报告，一代未参与。报告：docs/v2/reports/2026-10-23-customer-service-reliability.md。

## 2026-10-22: experimental quick routing source checkpoint

Unified action/entity handling, progressive ordering integration, registered FAQ row retention and necessary access/grouping dependencies. 217 targeted controlled-data checks passed; customer answer acceptance remains incomplete. See reports/2026-10-22-quick-routing-candidate-review.md. Source sync only, no deployment; private datasets and question bank excluded.

# 第七阶段

2026-10-17：当前交付为[无模型可用版](offline-usable.md)。资料、历史案例与原文、结构化条件/会话、本地OCR、配单及隔离飞书日志接通，实际本机页面可用。没有修改一代、active或原件；未做正式客户部署。飞书实表仍待V2独立配置。见[功能验证](stages/offline-usable-result.json)。下文历史研究记录不代表当前默认入口。

授权范围前置、文件证据ID、独立五会话排队与可选简单交互实验。保留两轮提示词失败及最终退化，未通过，不默认启用。报告：reports/stage7-simple-questions.md。未部署或影响一代。

# 二代变更记录

## 2026-10-16：第六阶段及后续公开交付规范

- 同步已完成的独立检索、工具集成、连续案例上下文及证据压缩实现，保留既有一代代码和公开历史。
- 按所属原记录型号线索过滤未标型号处理段；不推断硬件兼容。
- 保留固定12题新旧对照及4题独立盲测统计，明确两项B退化和未解决问题；原始工程数据不公开。
- 新增公开可复现的合成测试入口及源码/敏感内容检查记录，内部数据相关回归结果独立注明。
- 未部署、未训练权重、未改变正式active知识；完整历史内部报告未覆盖或删除。

后续每阶段在reports新增报告，并更新STATUS；GitHub同步不触发生产部署。
