# V2 前端结构治理交接（2026-10-18）

## 本次交付与职责

当前 8620 已同步到 8520 已验收的最新前端。此交付是治理前的基线同步，不代表结构治理已经完成。前端治理在 work/v2-frontend 分支进行；最终集成由主聊天负责。请不要覆盖主工作区，不要部署生产、重启一代或改动原件。

综合基线：f87402d241574b16a85b94955c484e422acec71b。
同步前前端：f075e31d246bf5414cae633441743e6bec48ab35。
可恢复检查点：checkpoint/v2-integrated-pre-governance-f87402d、checkpoint/v2-frontend-pre-governance-f075e31。
本次同时修复开发代理漏转发现有二维码 GET 图片入口，未增加后端业务功能。

## 治理要求

审查全部实际运行的 HTML、JS、CSS 和静态服务入口，特别是 offline-client.js、conversation-client.js、product-resources.js、styles.css、static-service.cjs。以调用关系、实际执行和可验证的行为为证据，识别重复实现、全局覆盖、加载顺序依赖、重复初始化/事件、失效历史代码、状态分裂、耦合及 CSS 覆盖。不要仅凭文件大小或来自 V1 就认定为技术债。

直接治理已确认的问题：整理初始化和模块职责、去除不必要全局覆盖、合并重复实现、删除确认不可达代码、整理等价 API 调用。不得机械拆分文件或制造新的兼容层。无法证明视觉及功能等价的改动保留原实现，记入剩余债务。

所有外观、布局、响应式效果、交互流程冻结。不得更换框架、恢复 V1 界面、修改后端分类/索引/版本判断/参数规则。CSS 只删除证明不影响最终渲染的冗余。允许修改 v2/frontend/**、前端静态服务与开发启动器及相关测试；其它模块需交主聊天判断。不要覆盖其它未提交修改。

## 已确认入口与审查线索

index.html 顺序：v2-components.js → product-resources.js → app.js → conversation-client.js。
静态服务在 offlineKnowledge 模式注入 site-compat.js 和 offline-client.js；local-knowledge.js 属于另一种模式，需分别确认可达性。

- site-compat.js 覆盖 assistantTextOf / addAssistantMessage。
- offline-client.js 包装 fetch / addAssistantMessage，并替换 sendMessage 和 OCR 发送入口。
- conversation-client.js 在 DOMContentLoaded 后包装消息函数，并管理自己的会话存储。
- local-knowledge.js 在另一路径存在 fetch 和渲染包装。
- static-service.cjs 注入脚本，并对 app 响应做路径替换。

以上是审查起点，尚未证明这些包装均可删除。必须跟踪实际顺序、状态和分支再治理。

## 必须保留的验收行为

产品速查当前完整名称、中文/英文及历史版本、兼容性和关联逻辑不变；左侧已有设备解释保留，文件按钮不追加设备解释。双列连续排列，移动端按现状展示。文件主体预览与右侧下载是并列独立元素，下载不触发预览，不支持格式明确提示。保留轻量元数据预取及请求复用、搜索、展开、会话恢复、OCR、售后和配单。

现有有效版本优先；旧缺件记录不重新放回主界面。操作指南、盖章件归其他资料，英文规格书和使用说明不移动。不得修改分类和原件来配合重构。

## 验证与交付

主工作区 tmp/frontend-governance-baseline-20261018 保存 manifest、浏览器检查、截图比对和截图；同步前两端共16张，8620同步后8张。产品速查、对话、售后、配单的桌面/移动端8组与8520验收基线逐像素一致（仅遮蔽动态吉祥物）。无页面脚本错误及横向溢出。开发代理隔离测试3项通过。此次未单独上传 OCR 文件验证，治理后必须补做。

开发启动：node v2/tools/start-frontend.cjs --port 8620 --backend http://127.0.0.1:8520。
静态代理变更只重启8620，不动8520。

治理完成提交独立 commits，提供：实际运行依赖图、必要 V1 依赖清单、最严重问题及证据、修改模块/文件、去除重复与隐式依赖、验证结果、剩余风险和暂不值得处理的问题。对产品速查/对话/OCR/配单/移动端前后截图比较，并验证预览、下载、检索、会话恢复。

主聊天负责审查治理提交与同步后的增量，按提交合并并解决冲突；不得再次整目录覆盖。最终运行针对性回归，再按项目规范同步公开源码和脱敏报告。GitHub同步不代表部署。

Frontend synchronized baseline commit: `87f2445` (work/v2-frontend). Use this commit as the governance merge base.


## 2026-10-18 启动器配套核验补充

治理版index已显式加载site-compat等脚本，8620必须用前端工作区自己的v2/tools/start-frontend.cjs启动；不要用旧综合工作区静态服务再次注入脚本。后者会重复执行组合入口，对冻结后的FrontendApp.channel赋值报错。现已切换到配套启动器，两入口50型号及悬浮/固定/关闭/键盘/手机/下载检查均无初始化错误；主聊天最终合并时必须同时审查入口与静态服务。
