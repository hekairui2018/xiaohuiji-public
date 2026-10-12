# 小灰机企业微信瘦桥（wecom-bridge）

只做一件事：**企业微信消息 ↔ 本地核心 3789 的收发转发**，不含任何业务知识。
所有答案（售前快查 / 售后案例 / 配单）都由 `D:\xiaohuiji\backend`（端口 3789）产出，桥只传输与显示适配。

## 三层结构
- `src/wecom.mjs`    连接层：企业微信长连接、连接状态、markdown 文本下发。
- `src/core.mjs`     转发层：POST 3789 `/api/ai/chat`，超时控制。
- `src/session.mjs`  会话层：最近对话历史、手打序号还原（纯内存，重启清空）。
- `src/responder.mjs`编排层：一条文本的完整收发流程。
- `src/config.mjs`   配置；`src/index.mjs` 入口 + 127.0.0.1:3790/health。

## 接口契约
- 请求 3789：`{message, history:[{role,content}], source:"wecom"}`（source 不能是 quick-site）。
- 3789 响应已附 `wecomMarkdown`(正文，末尾含“回复数字选型”序号行) 与 `wecomOptions`(同序选项)。
- 企业微信**不下发按钮卡片**（真机不一定渲染）：桥只发 markdown 文本，并按会话记住 `wecomOptions`；
  客户回 1/2/① 等纯序号时，还原成对应选项 value，等价于他手打该型号/动作。多位型号（410/6363）不会被误吞。

## 配置 `.env`
`WECOM_BOT_ID` / `WECOM_BOT_SECRET`（复用现有小灰机机器人）、`CORE_URL`、`BRIDGE_PORT=3790` 等。

## 启停与看门狗
- 手动前台调试：`node src/index.mjs`
- 安装看门狗计划任务（登录自启 + 每 2 分钟巡检、无窗）：
  `powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1`
- 健康：`http://127.0.0.1:3790/health`（authenticated=true 即已连上企微）。
- 聊天流水：`data/records.jsonl`；运行日志：`logs/`。

## 与旧桥关系
旧桥 `D:\HuiduCustomerPublicSite\wecom-xiaohuiji-bridge`（3400+ 行、耦合旧公共站）保留不删，
其计划任务 `WeComXiaohuijiBridge` 停用后，回退时重新启用旧任务、停用 `XiaohuijiWecomBridge` 即可。
