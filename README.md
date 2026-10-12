# 小灰机（xiaohuiji）

小灰机是面向 LED 显示屏控制系统的技术支持助手，整合产品资料快查、售后案例检索和屏体配单。网页与企业微信共用核心后端，统一生成答案、物料清单和连接拓扑，再按不同渠道展示。

仓库包含前端、核心后端、企业微信桥、问答质检后台、业务数据索引和工具脚本。本公开审查副本仅公开代码：业务数据提供空结构模板，内部文档和第三方参考资料提供占位说明。真实凭证、客户运行日志和大型资料文件不作为源码交付。产品资料快查面向客户，售后案例与配单目前定位为内部员工使用。

## 功能模块

| 模块 | 功能 | 主要代码 |
|---|---|---|
| 产品资料快查 | 产品参数、规格书、芯片固件、软件、教学视频 | `backend/product-*.cjs`、`chip-firmware.cjs`、`software-catalog.cjs`、`video-catalog.cjs` |
| 售后案例检索 | 按故障现象与标签匹配案例，返回解法和来源 | `backend/specialist/aftersales-specialist.js` |
| 屏体配单 | 选型、带载、接收卡数量、网口分配、BOM、SVG 拓扑、HDSet SSM 文件生成 | `backend/ordering/` |
| 对话理解 | 确定性路由、结构化意图与槽位识别、能力边界校验 | `backend/server.js`、`backend/nlu/` |
| 模型与 OCR | 语言模型接口、截图文字识别 | `backend/llm-client.cjs`、`backend/ocr-client.cjs` |
| 企业微信桥 | 消息连接、核心转发、会话与序号选项、文本及拓扑图片 | `wecom-bridge/src/` |
| 问答质检 | 对话回溯、备注和意图标注 | `admin/` |
| 日志与飞书 | 升级助手日志接收、本地留存、多维表附件同步 | `backend/server.js`、`backend/feishu-bitable.cjs` |

## 技术栈

- **运行环境**：建议 Node.js 22，现有部署与运维脚本以 Windows 为主。
- **后端**：JavaScript、CommonJS、Node.js HTTP/文件系统等内置模块；核心和后台无第三方 npm 运行依赖。
- **前端**：HTML、CSS、原生 JavaScript、SVG，无前端构建步骤。
- **企业微信桥**：ES Modules、`@wecom/aibot-node-sdk`、`dotenv`。
- **数据**：JSON 索引、JSONL 日志、本地文件，无独立数据库服务依赖。
- **外部集成**：语言模型兼容接口、阿里云 OCR/OSS、飞书多维表、企业微信。
- **辅助工具**：PowerShell；DOCX 提取使用 Python/`python-docx`，视频转码使用 FFmpeg，企微拓扑图片使用 Edge/Chrome 无头渲染。

## 项目结构

```text
xiaohuiji/
├── backend/                  核心服务与业务模块
│   ├── server.js             HTTP 入口
│   ├── nlu/                  结构化意图与校验
│   ├── specialist/           售后案例检索
│   ├── ordering/             配单、拓扑、SSM 与规则数据
│   ├── views/                企业微信展示适配
│   └── scripts/              飞书核验、补录与维护工具
├── frontend/                 网页界面
├── admin/                    问答质检后台
├── wecom-bridge/             企业微信桥与独立依赖声明
├── data/                     产品、固件、软件、视频与案例索引
├── reference/                官方选型参考资料
├── scripts/                  数据处理、回归、打包与部署
├── docs/                     架构、接口与操作文档
├── .gitignore                凭证、日志和生成产物排除规则
└── README.md
```

本地还可能存在 `tmp/`、`archive/`、`frontend/official-files/` 等运行产物、归档或资料目录。它们不是 npm 依赖目录，克隆源码不包含全部现网资料和运行数据。

## 启动

安装 Node.js 22，在项目根目录打开 PowerShell。以下为本地开发命令；带现网固定路径的看门狗/重启脚本不是通用安装入口。

### 核心服务

```powershell
$env:PORT = '3789'
$env:HOST = '127.0.0.1'
node backend/server.js
```

无需在根目录执行 `npm install`。代码默认端口为 **3788**，本项目显式使用 **3789**。

- 快查站：`http://127.0.0.1:3789/quick`
- 问答页面：`http://127.0.0.1:3789/huiai`
- 健康检查：`http://127.0.0.1:3789/api/health`

### 质检后台

在另一个终端执行：

```powershell
$env:ADMIN_PORT = '3791'
$env:ADMIN_HOST = '127.0.0.1'
node admin/admin-server.cjs
```

页面地址：`http://127.0.0.1:3791/`，健康检查为 `/api/health`。后台代码默认监听所有网卡，以上命令将开发实例限制在本机。

### 企业微信桥

先配置 `wecom-bridge/.env` 中的机器人凭证，再在另一个终端执行：

```powershell
Set-Location wecom-bridge
npm install
npm start
```

健康检查：`http://127.0.0.1:3790/health`，仅监听本机。企微拓扑图片需要 Edge/Chrome，也可通过 `WECOM_BROWSER_BIN` 指定浏览器路径；出图失败回退到文字回复。

## 依赖与配置

仅 `wecom-bridge/package.json` 声明 npm 依赖：`@wecom/aibot-node-sdk`（`^1.0.7`）、`dotenv`（`^16.4.7`）。当前未跟踪 npm 锁文件。根目录、核心和后台没有 `package.json`；Python 与 FFmpeg 仅用于相应资料处理工具。

| 配置位置 | 用途 | 主要配置项 |
|---|---|---|
| 核心进程环境变量 | 监听与资料地址 | `PORT`、`HOST`、`SPEC_PUBLIC_BASE` |
| `backend/.env` | 模型 | `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_TIMEOUT_MS` |
| `backend/.env` | OCR | `OCR_ACCESS_KEY_ID`、`OCR_ACCESS_KEY_SECRET`、`OCR_ENDPOINT`、`OCR_TYPE` |
| `backend/.env` | 日志鉴权及飞书 | `HUIDU_UPLOAD_KEY`、`AI_ADMIN_TOKEN`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_APP_TOKEN`、`FEISHU_TABLE_ID` |
| `wecom-bridge/.env` | 企微连接及转发 | `WECOM_BOT_ID`、`WECOM_BOT_SECRET`、`CORE_URL`、`BRIDGE_PORT` |
| `scripts/.oss-config.json` | OSS 上传及 OCR 凭证回退 | 按 `scripts/.oss-config.example.json` 填写自己的凭证与桶 |
| 后台进程环境变量 | 监听、浏览器打开 | `ADMIN_PORT`、`ADMIN_HOST`、`ADMIN_NO_OPEN` |
| `data/`、`backend/ordering/data/` | 业务索引与选型规则 | 产品、案例、固件、带载及硬件证据数据 |

真实 `.env` 与 OSS 密钥配置已设为 Git 忽略项。当前没有后端/企微 `.env.example`，配置读取以各模块代码为准。飞书与日志鉴权显式读取 `backend/.env`，仅设置同名系统环境变量不能替代该文件。

没有模型凭证时回退到本地规则；OCR、企微、飞书能力需要各自配置。资料下载依赖相应本地文件或云端资源，公开源码不包含现网凭证与全部资料文件。

本副本用于代码审查。运行依赖业务数据的功能与回归前，须补充自己的授权数据；[基线](docs/BASELINE.md) 的通过结果来自完整原项目，不代表空模板副本的测试结果。

## 回归检查

在项目根目录执行已有检查脚本：

```powershell
node scripts/golden/run-nlu-golden.cjs
node scripts/test-ssm-generator.cjs
node scripts/test-feishu-bitable.cjs
```

分别检查默认确定性意图路由、SSM 生成和隔离环境中的飞书同步。真实凭证下的上传、迁移、补录等维护脚本可能写入外部服务，执行前阅读脚本说明。

## 文档

- [架构说明](docs/architecture.md)
- [接口契约](docs/api-contract.md)
- [代码与页面导航](docs/02_代码与页面导航地图-哪是哪.md)
- [项目检查与公开准备](docs/GitHub公开准备-项目检查.md)
- [项目业务基线](docs/小灰机助手-项目基线与交接-20260921.md)
- [变更日志](CHANGELOG.md)
- [发布与交付规范](docs/发布与交付规范.md)

仓库目前未提供 LICENSE。本次文档准备不替源码、第三方参考代码、案例和资料授予使用许可。公开准备与现网发布分别执行；发布遵循既有项目规范。
