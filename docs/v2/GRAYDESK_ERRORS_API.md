# 灰Desk异常日志接收协议

2026-10-26。仅接收导致软件无法继续运行的异常；检测、崩溃后补报及发送队列属于灰Desk客户端。

## 当前交付状态

开发接收端已部署8520/8521；真实飞书写入、重复回传及隐私回读通过。专用表名为“灰desk异常日志”。**公网HTTPS尚未配置成功，不能将当前HTTP地址当作正式接口交付。** HTTP公网请求返回426，不能携带凭证试用。配置有可信证书的HTTPS反向代理后，正式路径为 `POST https://<已配置并验收的域名>/api/graydesk/errors`；必须再做该HTTPS入口的真实鉴权、写入、重复及内部接口隔离验收。

## 鉴权与配置

请求头 `Authorization: Bearer <GRAYDESK_ERROR_UPLOAD_TOKEN>`，以及 `Content-Type: application/json; charset=utf-8`。上报凭证为独立随机256位密钥，与升级助手凭证不同。客户端只接收上报凭证，不接收任何飞书app_secret或tenant_access_token；不能把上报凭证写入日志、URL、公开仓库或网页脚本。原生客户端内的共享上报密钥不具有硬件保密能力，泄露后须在接收端轮换并更新客户端。

接收端配置位于运行目录的 `graydesk.private.json`（不入Git），含 `uploadKey, appId, appSecret, appToken, tableId`。只给客户端的配置应只有 `endpoint, auth_header, auth_scheme, upload_token`。正式endpoint在HTTPS验收前保持未配置，不自动降级HTTP。

## 请求示例

```http
POST /api/graydesk/errors HTTP/1.1
Host: <已验收的HTTPS域名>
Authorization: Bearer <GRAYDESK_ERROR_UPLOAD_TOKEN>
Content-Type: application/json; charset=utf-8
```

```json
{
  "event_id": "f8380507-9835-45db-8f7e-aab941604ceb",
  "occurred_at": "2026-10-26T14:00:00+08:00",
  "software_version": "1.0.0",
  "installation_id": "838a8a96-5305-4bda-9166-fcd1e9d9ba47",
  "category": "no_progress",
  "severity": "critical",
  "stage": "auto_fill_code",
  "remote_software": "ToDesk",
  "stalled_seconds": 31,
  "exception_type": "ProgressTimeout",
  "error_summary": "Automatic code entry stopped making progress",
  "stack_trace": "at GrayDesk.Automation.Runner.Execute()",
  "log_excerpt": "automation watchdog: no progress for 31 seconds",
  "repeat_count": 1,
  "execution_blocked": true,
  "reason_code": "progress_timeout"
}
```

`event_id`每个真实事件生成一个UUIDv4；补传/重试必须保持ID和请求内容完全一致。`installation_id`为安装时随机UUIDv4，不使用机器名、硬件序列号、账号或设备码。时间必须带时区，允许离线历史事件，拒绝超过服务器未来5分钟的时间。字段不接受null，stack_trace及log_excerpt无内容用空字符串。

| category | reason_code | 准入条件 |
| --- | --- | --- |
| crash | process_crash | 软件崩溃 |
| unexpected_exit | unexpected_exit | 进程意外退出 |
| unhandled_exception | unhandled_exception | 无法继续运行的未处理异常 |
| no_progress | progress_timeout | auto_fill_code或password_input阶段，停滞严格超过30秒 |
| operation_hang | operation_deadlock | recognition、launch_client或automation阶段卡死 |

所有事件要求 `execution_blocked=true`，severity仅 `critical/fatal`。阶段只接受 `process/recognition/launch_client/auto_fill_code/password_input/automation`；远程软件只接受 `none/ToDesk/Sunlogin/AnyDesk/TeamViewer/RustDesk/Other`。已知普通业务结果摘要也会被拒绝，但服务器不能从任意文字独立证明真实卡死；客户端必须按本合同正确分类。等待用户输入密码/授权不能作为停滞。

## 响应

首次写入飞书：HTTP200。

```json
{"ok":true,"event_id":"f8380507-9835-45db-8f7e-aab941604ceb","status":"written","retryable":false}
```

已存在：HTTP200，`status`为`exists`，其余结构相同。不会累计网络重试次数，不覆盖人工处理状态或备注。

临时写入失败：HTTP503，并附 `Retry-After: 30`。

```json
{"ok":false,"error":"storage-unavailable","retryable":true}
```

不符合异常范围：HTTP422。

```json
{"ok":false,"error":"ordinary-business-outcome","retryable":false}
```

其他错误：400 invalid-json；401 invalid-credential；405 method-not-allowed；409 event-id-conflict；413 request-too-large；415 json-required/compression-not-supported；422字段校验失败；426 https-required；429限流（Retry-After:60）；503 receiver-not-configured（Retry-After:60）/receiver-busy（30）。仅200且`ok=true`表示可以从客户端发送队列移除。任何其他响应、超时、断网或无法解析响应均不能当作写入成功。

## 大小、限流和重试

- 单个JSON请求最多65,536字节；不接受压缩、multipart、附件或截图。正文读取超时10秒。
- error_summary最多1000字符，stack_trace最多12000，log_excerpt最多8000；超长拒绝，不静默截断。异常类名最多160字符且仅类名字符；软件版本只接受数字点版本及可选预发布后缀。
- 每个TCP来源每分钟120次（隧道可能共享一个来源），鉴权后的整把凭证每分钟60次，每安装标识每分钟10次；固定一分钟窗口，重复回传同样计数。不信任客户端X-Forwarded-For。
- 最多16个在途事件，飞书写入串行执行；超过返回503。单次飞书HTTP调用最多12秒，获取应用token最多10秒；客户端总超时建议至少60秒。
- 网络错误、408、429、5xx保留原事件；先遵守Retry-After，否则指数退避30秒、60秒、120秒，封顶30分钟并加入随机抖动，联网后续传，不制造新ID。不限定离线保留天数；客户端自行决定队列容量并明确记录溢出。
- 400/401/409/413/415/422/426等永久错误不要无限热重试，应保留诊断并修正配置或数据；401/426修复配置后可继续提交原事件。
- 本地先保存脱敏事件和稳定接收时间作为待确认凭据，远端按事件ID查询，并使用相同UUIDv4作为飞书client_token。响应丢失后先查远端再写；飞书未成功/未确认时返回503。本地记录不等于成功写入，当前无后台自动补传，依赖客户端重试。
- 一个生产接收进程使用一个独占运行目录，不通过启动多个独立副本扩容；多实例需要另加共享事务存储和分布式限流。

## 隐私与字段映射

请求仅允许示例中的字段；截图、设备码、密码、账号、聊天、附件等额外字段直接422，不持久化原始请求。自由文本先屏蔽用户路径、邮件/IP/MAC、长数字和可识别标识，并整行丢弃包含密码、账号、设备码、聊天等敏感标记的内容，再存本地与飞书。**客户端也必须先脱敏，不能依赖服务器正则识别所有未知格式的敏感内容；不要发送任意客户对话或原始全量日志。** 不保存原始正文、请求头或凭证。当前日志留存没有自动删除策略，删除/期限另行明确。

| 飞书字段 | 来源/类型 |
| --- | --- |
| 事件ID | event_id，文本主列 |
| 发生时间 | occurred_at转毫秒，日期 |
| 接收时间 | 接收端首次接收时间，日期 |
| 软件版本 | software_version，文本 |
| 匿名安装标识 | installation_id，文本 |
| 异常类别 | category，文本 |
| 严重程度 | severity，文本 |
| 发生阶段 | stage，文本 |
| 涉及的远程软件 | remote_software，文本 |
| 停滞秒数 | stalled_seconds，数字，默认0 |
| 异常类型 | exception_type，文本 |
| 错误摘要 | error_summary脱敏后，文本 |
| 异常堆栈 | stack_trace脱敏后，文本 |
| 脱敏日志片段 | log_excerpt再次脱敏后，文本 |
| 重复次数 | repeat_count，数字，默认1；仅客户端合并的实际发生次数 |
| 处理状态 | 新建时“待处理”，后续不自动覆盖 |
| 处理备注 | 新建时空，后续不自动覆盖 |

飞书client_token与一致性接口依据：[官方新增记录文档](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create)。
