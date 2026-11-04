# 配单控制系统 BOM 与导出契约

版本：`xhj-control-bom/1`。网站与 Excel 共用 `result.controlBom`，接入方读取同一结果，不拼接参数或另算数量。本轮未修改企微适配器。

## 数据

配单回复的 `result` 包含：

| 字段 | 含义 |
| --- | --- |
| `controlBom` | 下述统一 BOM |
| `selectedOptionId` | 当前方案编号，切换时保持编号与按钮位置 |
| `options` | 本次计算的可选方案 |
| `selectionToken` | 方案集合校验标识；随会话使用，不代表访问授权 |
| `deliverySessionId` | 当前计算结果所属会话，用于绑定导出 |

`controlBom` 字段：

| 字段 | 类型与含义 |
| --- | --- |
| `schemaVersion` | 固定 `xhj-control-bom/1` |
| `title` / `fileStem` | 屏幕规格、暂定状态及方案编号；fileStem 去除文件名非法字符 |
| `optionId` | 正整数方案编号 |
| `provisional` | 是否暂定；暂定时标题含“暂定” |
| `resolution` / `pitch` | 屏体像素与点间距；未知为未确认/null |
| `columns` | 固定：序号、名称、型号、参数、数量、单位、备注 |
| `items` | 仅发送端设备、发送端输出板卡、外购接收卡 |
| `warnings` | 默认条件、适用条件与必要说明 |

每个 item 为 `{index,kind,name,model,parameters,quantity,unit,remarks}`。`quantity` 为原方案物料数量。内置接收单元不另购，说明保留在备注或 warnings。表内不列模组、电源、箱体、线材、报价。

`parameters` 每项为 `{label,value,unit,type,source}`：`type=rated` 是有来源且型号对应的额定参数；`type=actual` 是本方案使用值，source 为 `current-validated-plan`。未记载的额定参数不生成。其他输出板不继承主控的额定带载。

## 复用现有计算结果（首选）

沿用网站核心服务现有认证及资料访问边界，POST：

```text
/v2/ordering/bom?sessionId=会话ID&optionId=2&token=selectionToken&format=json
/v2/ordering/bom?sessionId=会话ID&optionId=2&token=selectionToken&format=xlsx
/v2/ordering/bom?sessionId=会话ID&optionId=2&token=selectionToken&format=csv
/v2/ordering/ssm?sessionId=会话ID&optionId=2&token=selectionToken
/v2/ordering/package?sessionId=会话ID&optionId=2&token=selectionToken
```

查询参数须使用 URLSearchParams 等正确编码。BOM 无需请求体。配置包可传现有 `{deployment:{...}}` 设置，保持原导出器允许的设置范围；不接收客户端 plan。

JSON 返回 `{status:'ready',bom,modelCallCount:0}`；xlsx/csv/ssm/zip 返回文件响应，`Content-Disposition` 标明方案编号。BOM 复用已有结果；SSM 和配置包再次执行原几何及文件校验，不调用模型、不重新选型。

400：参数/格式错误；403：访问边界或来源校验失败；409：会话方案过期、token 不符或数据集已变化，应重新取得配单结果；422：当前方案未支持该配置导出或校验失败。失败不能改用另一方案的文件。

切换方案沿用聊天接口，消息为 `配单方案：2`，同时传原 `sessionId` 与 `orderingSelectionToken`。返回的 result、BOM、连接图与下载上下文一起替换；模型调用数为 0。普通客户自然语言修订条件仍走原专家入口。

## 无会话的既有接口

`POST /v2/ordering/bom` 请求 `{demand:原配单条件,optionId:2,format:'json'|'xlsx'|'csv'}`；该路径沿用原算法重新计算并校验，不能用它替代已有会话的方案复用。返回的 BOM 仍使用同一字段结构。既有导出校验、资料权限保留。

## 实现位置

- `v2/adapters/http/control-bom.cjs`：原物料数量转换。
- `v2/domain/ordering/output/control-bom-data.cjs`：统一 BOM 数据。
- `v2/domain/ordering/output/control-workbook.cjs`：服务端 Excel。
- `v2/frontend/ordering-bom-data.js`、`ordering-workbook.js`：网页同源数据与 Excel。
- `v2/adapters/http/ordering-choice.cjs`、`ordering-export.cjs`：已有方案复用与导出校验。
- `v2/adapters/http/offline-knowledge.cjs`、`server.cjs`：HTTP 接口。
- `v2/frontend/v2-components.js`：表格与当前方案下载。

修改 BOM 规则后运行 `node v2/tools/sync-control-bom.cjs` 同步浏览器文件；契约测试检查两份内容一致。
