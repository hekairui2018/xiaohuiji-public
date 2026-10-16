# 小灰机二代公开源码

当前使用独立无模型入口，见[使用和部署说明](../docs/v2/offline-usable.md)。不接27B，不复用一代手工意图路由；保留旧试验代码作历史记录，不作为本轮默认入口。

二代是可追溯资料与工程经验检索系统。本地模型负责可选的理解、工具调度、阅读和答案组织；基础检索不依赖模型。

- `/quick`：独立资料入口，不进入聊天路由。
- `/huiai`：现有对话入口，可在本地开发模式显式接入只读检索工具和本地模型。
- `resource-index/`：SQLite目录及正文位置检索。
- `tool-trial/`：只读工具、会话隔离、证据交付及有界本地模型调用。
- `domain/`、`adapters/`、`app/`：已实现的业务与接口层；历史模块存在不代表当前全部能力通过验收。
- `experience-extraction/`：候选原文加工原型，不能视为已通过无人批量提炼。

公开包不含公司知识库、原件、工程原文或模型权重；现有data占位不代表可直接运行真实业务。详见[输入边界](PUBLIC_INPUTS.md)。仅配置自己有权读取的资料。不要运行构建或扫描脚本指向未知目录。

可复现、无私有资料和无模型的合成测试：

```sh
python -m unittest discover -s v2/tool-trial -p test_public_source.py
```

数据相关历史测试需要独立授权输入，不因缺少私有数据降低原测试标准。参数、固件及工程结论以授权原文和适用条件为依据。

进度与失败：[STATUS](../docs/v2/STATUS.md)、[CHANGELOG](../docs/v2/CHANGELOG.md)、[阶段报告](../docs/v2/reports/2026-10-16-stage6-public.md)。GitHub同步不触发部署。
