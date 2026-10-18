# V2 Bonsai 自主工具链路恢复（2026-10-18）

## 范围与结论

以本地591ece2为起点。恢复专家对技术问题及追问的理解、search/read/clarify选择权；快速模式的回答策略不变。没有改UI、模型权重、知识库、原件或生产环境。

链路恢复通过，不等于工程诊断质量全部达标。六题最终HTTP200，均真实调用既有Bonsai。复杂售后仍偏向追问，连续追问有重复；不能宣称已能稳定给出完整排查方案。

## 原限制与改动

- chat-intent.cjs新增独立expertIntent：仅完整问候及单一明确资料请求可快捷识别。其余全部交Bonsai；旧分类仅为intentHint，不依关键词或字数指定复杂度或检索计划。明确否定“不是故障排查”不再触发故障入口。
- 初始输入带最后6条历史消息、facts/checks、当前准确型号与历史contextModels。历史型号是上下文候选，不冒充当前新确认型号。clarify提示进入技术链路，不再混入自然闲聊。
- evidence-expert.cjs删除预检索后finalOnly和有效search被拒绝的分支。技术问题不预先强制检索；只有明确简单文件查询准备候选，仍允许补查。
- Bonsai选择products/resources/cases/text/files、原文read、澄清或回答。offline-knowledge.cjs按模型明确选定的工具种类执行既有服务，允许其他型号对照并标明additionalModels，不认定其属于当前设备或已确认兼容。read仍只允许读取本次检索授权的block及其相邻原文。
- 同一工具/种类/规范化查询请求内缓存；不同型号后缀分开。结果ID相同会提示未获得新证据，补查需说明新目标。语义相近但文本不同的查询尚未完整合并。
- 每请求最多5次模型、4次实际工具执行、总90秒；普通聊天240输出token，技术1000；Bonsai可自行申请一次low显式分析900，耗尽最多一次off/800恢复，不默认xhigh，不因格式/表达不佳整轮重生成。最终预算轮才收束到回答/追问，不在首次检索后禁用工具。
- 保留来源ID枚举、原文读取授权、数值核验、兼容性确认及通用建议分区。修正否定兼容结论被关键词检查误拦截：否定限定在本分句，后续肯定兼容仍需确认依据。可读来源保留资料名称/位置，不在正文输出内部ID。

## 真实六题验收

这六题是参与修改的针对性回归，非盲测，不据此声明整体准确率或延迟提升。最后兼容题在误拦截修正后单独复验；其余来自同一轮六题。第3/4题同一会话，其他独立会话。每题没有隐藏重试。

|题目|路由及决策方|总耗时ms|模型/实际工具|结果|
|---|---|---:|---|---|
|你好|social / social-shortcut|2067|1/0|自然问候；不检索|
|C16L说明书，不是故障排查|resources / simple-resource-shortcut|18711|3/3|manual资料意图；未找到确认的说明书，仍有冗余追问|
|C16L升级后闪烁|technical / bonsai|22600|4/3|Bonsai自主案例→目录→原文；最后询问升级对象、异常范围等|
|还是这样|technical / bonsai|4848|1/0|带入C16L升级闪烁背景，不检索；仍重复先前问题|
|C16L右边几排颜色异常，之前换过模组，节目发送正常|technical / bonsai|23842|4/3|自主案例→目录→原文，保留换过模组/发送正常，最终追问异常形态与版本|
|R512和R512S固件能通用吗|technical / bonsai|39918|4/3|按两准确型号查询后补查原文/案例；无法确认通用，不肯定兼容|

所有最终模型响应finish_reason=stop，正文非空；本轮0次格式重试、0次预算恢复、无expert-unexpected-tool。模型未选择analyze，实际显式思考均off；low申请与耗尽恢复只在模拟传输回归验证，不能称本轮已实证复杂显式思考质量。服务未返回原生reasoning_tokens，记录null；reasoning_content长度0，不能伪造原生思考token细分。

## 逐次模型证据（脱敏）

API实际返回model= bonsai，向既有本地chat/completions发请求。技术输出使用动作JSON Schema，问候为自由文本。不公开请求正文、公司案例原文、模型内部思考或地址凭据。

|题号|轮次|耗时ms|输入token|输出token|目的|思考|finish_reason|
|---|---:|---:|---:|---:|---|---|---|
|1|1|2040|117|25|social-reply|off|stop|
|2|1|4163|682|53|autonomous-answer-or-tool|off|stop|
|2|2|4728|915|62|autonomous-answer-or-tool|off|stop|
|2|3|7180|1123|111|autonomous-answer-or-tool|off|stop|
|3|1|2936|562|29|autonomous-answer-or-tool|off|stop|
|3|2|5216|1345|52|autonomous-answer-or-tool|off|stop|
|3|3|6403|2100|47|autonomous-answer-or-tool|off|stop|
|3|4|7619|2287|67|autonomous-answer-or-tool|off|stop|
|4|1|4834|708|69|autonomous-answer-or-tool|off|stop|
|5|1|2989|573|34|autonomous-answer-or-tool|off|stop|
|5|2|6236|1588|64|autonomous-answer-or-tool|off|stop|
|5|3|6922|1824|72|autonomous-answer-or-tool|off|stop|
|5|4|7229|2044|68|autonomous-answer-or-tool|off|stop|
|6|1|2963|576|26|autonomous-answer-or-tool|off|stop|
|6|2|5255|1281|53|autonomous-answer-or-tool|off|stop|
|6|3|5483|1487|52|autonomous-answer-or-tool|off|stop|
|6|4|23324|1702|455|autonomous-answer-or-tool|off|stop|

## 工具轨迹及补查

- 第1题：无工具。
- 第2题：simple-resource-candidate: resources，候选0，2422ms → bonsai-requested: resources，候选0，116ms → bonsai-requested: files，候选0，90ms。
- 第3题：bonsai-requested: cases，候选3，50ms → bonsai-requested: resources，候选4，146ms → bonsai-requested: text，候选0，213ms。
- 第4题：无工具。
- 第5题：bonsai-requested: cases，候选3，10ms → bonsai-requested: resources，候选0，354ms → bonsai-requested: text，候选0，98ms。
- 第6题：bonsai-requested: resources，候选4，2799ms → bonsai-requested: text，候选0，35ms → bonsai-requested: cases，候选0，27ms。

第3题候选为3条历史案例、4项固件目录记录，原文补查为空。第5题候选为3条历史案例，后续目录/原文为空；没有把候选案例当作当前原因。第6题4项文件名候选不能证明兼容，后续原文/案例为空。最终显示文件名称而非内部ID；“未找到历史案例”的句子引用了文件候选，这是引用支持范围仍不足的实例，不能把引用身份校验当作逐句语义证明。

复杂题实际补查权已恢复，但未测得真实read调用：read授权、search→补查→read、缓存及有界low恢复由自动化回归覆盖。不能声称实机六题覆盖了全部动作。

## 实际复杂题回复

> HD-C16L右侧几排颜色异常，且已换过模组、节目发送正常。请确认：1）异常是整排/局部灰屏、偏色还是RGB通道错乱？2）当前模组型号和FPGA/接收卡固件版本是多少？

这条回复保留现场条件，但仍以澄清为主，没有提供完整无损排查步骤，不将其列为诊断质量完全通过。过去66.37秒与29.01秒是另一条问题/回答策略，不能与本轮不同输入计算提升百分比。

## 验证、加载与剩余限制

- 54项针对性测试通过，覆盖精确后缀、否定路由、上下文、工具补查/读取、重复缓存、来源/数值/兼容检查、取消生成、模型离线、快速独立、原件服务及公网边界。
- 本地8520已加载；真实浏览器快速问候0模型/0工具，专家问候1模型/0工具，错误提示可读。知识版本保持原值；未改UI，不进行无意义截图回归；未重启模型或一代生产。
- 中间失败保留在本机：恢复工具初版出现重复改写查询耗尽预算；兼容题否定表述两次被旧/过宽正则误拦截，修正后再实测HTTP200。没有把失败候选藏成全通过。
- 思考由模型申请，非规则按长短分级；模型本轮没有申请low，分析深度、追问重复、候选相关性和英文/多关键词搜索召回仍有限。不同查询仍可能返回同一资料，多轮等待未消失。
- 数字、引用身份、明确兼容断言可校验；无法用现有传统程序完全证明每个自然语言结论被引用语义支持。未新增模型替其背书。
- 无新增依赖、无答案缓存、无全库扫描、无知识重建；模型只能调用受限只读工具，不能修改原件。
