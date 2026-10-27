# 小灰匠升级固件助手：在线更新服务端对接

交付日期：2026-10-27。仅小灰机服务端；助手端的检查、验签、下载、替换、重启由助手项目实现。本次没有发布任何助手正式EXE。

## 已上线的入口

- 产品标识固定为 `xiaohuijiang-firmware-assistant`。
- 正式查询：`http://43nudj314064.vicp.fun/api/assistant-updates/v1/stable/latest?currentBuild=202610270001`。
- 本机查询：`http://127.0.0.1:8520/api/assistant-updates/v1/stable/latest`。
- 下载格式：`http://43nudj314064.vicp.fun/api/assistant-updates/v1/stable/files/<build>-<sha256>.exe`。必须使用**已验签payload中的downloadUrl**，不能自行猜测文件名。
- GET和HEAD均支持。查询可不传currentBuild；它只是提示计算参数，不是身份凭据。无上传接口，没有远程发布接口。下载不使用日志上传密钥，无任意文件路径参数。
- 测试通道将stable替换为test。签名中明确 `channel="test"`、`latest.testOnly=true`；正式助手必须拒绝此通道。目前测试通道已关闭，返回404。

正式通道已初始化，当前签名内容 `latest=null`，表示暂无正式发布。没有可以交给客户安装的正式下载地址。接口上线不等于助手端已经支持在线更新。

## JSON与字段类型

完整的真实签名测试示例见 [assistant-update-example.json](assistant-update-example.json)，包括外层原始响应和解码后的全部字段。该例仅供协议验签，URL现已因测试通道关闭而不可下载，不能当正式更新。

外层示意：

```json
{
  "algorithm": "RSA-PSS-SHA256",
  "keyId": "1f8e1eeb503f1fe046050894f3060bbe85b9276ec3eb1966b081267fdb4aba49",
  "payload": "<标准Base64编码的UTF-8 JSON原始字节>",
  "signature": "<标准Base64编码的RSA-PSS签名>",
  "status": "published",
  "hasUpdate": true
}
```

前四项都是string。`status`为string、`hasUpdate`为boolean，**它们没有单独签名，仅为提示，客户端必须从验签后的payload重新计算**。

payload解码后的完整结构示意：

```json
{
  "schemaVersion": 1,
  "productId": "xiaohuijiang-firmware-assistant",
  "channel": "stable",
  "sequence": "2",
  "issuedAt": "2026-10-27T12:00:00.000Z",
  "expiresAt": "2026-11-03T12:00:00.000Z",
  "highestBuild": "202610270001",
  "latest": {
    "productId": "xiaohuijiang-firmware-assistant",
    "build": "202610270001",
    "displayVersion": "2.1.2 正式版",
    "publishedAt": "2026-10-27T12:00:00.000Z",
    "notes": "发布人员填写的更新说明",
    "fileName": "202610270001-<64位小写SHA256>.exe",
    "size": 12345678,
    "sha256": "<64位小写SHA256>",
    "downloadUrl": "http://43nudj314064.vicp.fun/api/assistant-updates/v1/stable/files/202610270001-<64位小写SHA256>.exe",
    "testOnly": false,
    "platform": "windows-x64",
    "format": "single-exe"
  },
  "previous": null,
  "revokedBuilds": []
}
```

| 字段 | 类型与含义 |
|---|---|
| schemaVersion | number，当前1 |
| productId/channel | string，必须精确匹配产品及stable |
| sequence | 十进制string，清单修订序号；发布/续签/撤回均递增 |
| issuedAt/expiresAt | ISO 8601 UTC string，清单发行时间及截止时间 |
| highestBuild | 十进制string，曾发布的最高构建号；空通道为"0" |
| latest/previous | 上述release对象或null，previous为上一正式版本 |
| revokedBuilds | string[]，已经撤回且禁止下载的构建号 |
| release.build | 1至20位无前导零的正十进制string，可超JS安全整数 |
| release.size | number，安全整数，EXE确切字节数 |
| release.testOnly | boolean，正式更新必须false |
| 其他release字段 | string；更新说明纯文本，禁止按HTML执行 |

## 构建号比较与撤回行为

建议助手构建脚本生成统一UTC时间形式的唯一递增号 `yyyyMMddHHmmss`，同秒构建必须等待下一秒或采用双方固定的更长格式。发布器还会拒绝不递增构建号；文件属性2.1.2.0和displayVersion均不参与新旧判断。

以任意精度整数比较，或比较数字串长度再按字典序比较；禁止按浮点数、普通字符串字典序或文件版本比较。客户端将自身可信构建号与验签后的latest.build比较：大于自身才提示更新；相等或更小不自动降级。旧包没有可信构建号时先由助手项目明确迁移策略，不把2.1.2.0强行转换成构建号。

回退命令会生成更高sequence的新清单，撤回坏版本、将previous提升为latest，highestBuild保持历史最高值。已安装坏版本的客户端应显示“该构建已撤回”，并按助手项目决定的显式恢复流程处理；不要绕过防降级直接安装旧版。刚下载尚未安装时应再次检查最新有效清单的撤回列表。

## HTTP入口的签名信任规则

现域名HTTPS用正常系统证书验证实测得到空响应，**本次没有有效HTTPS交付**，不能关闭证书验证或声称HTTPS已经配置。HTTP仍可能被阻断、重放、窃听；签名保证内容来源和完整性，不保证网络可用性、保密性或即时获知撤回。

可信公钥位于 [assistant-update-public.pem](assistant-update-public.pem)。助手项目须从这份本地/审阅过的源码交付中内置公钥，不允许从同一HTTP地址下载一个新公钥后自动信任。公钥指纹是SPKI DER字节的SHA256：

```text
1f8e1eeb503f1fe046050894f3060bbe85b9276ec3eb1966b081267fdb4aba49
```

客户端校验顺序：

1. 限制响应/下载大小及超时；查询失败时保持现有助手可用，不替换EXE。
2. 只接受算法 `RSA-PSS-SHA256`、上述keyId和内置公钥。签名验证对象是Base64解码payload的**原始字节**，不是重序列化JSON。RSA 3072位、SHA256、MGF1-SHA256、PSS盐长32字节（.NET的SHA256/Pss对应此设置）。
3. 验签通过后解析JSON，校验schemaVersion、产品、stable、testOnly=false、Windows x64、single-exe、字段类型、URL主机/协议白名单及文件大小上限。禁止跨产品、跨通道复用。
4. 校验issuedAt/expiresAt及本机可信时钟；当前清单有效期7天。按产品+通道持久保存已接受的最大sequence，拒绝更低sequence，避免见过新版后被重放旧清单。同sequence内容变化亦拒绝。首次接入仍有有效期内重放窗口；需要更强即时撤回能力时应迁移到经验证的HTTPS。
5. 下载到临时文件，完整核对验签payload中的size、SHA256。仅在这两项及签名全部通过后交给助手端替换逻辑。独立RSA签名绑定EXE哈希；本次未生成Windows Authenticode证书，不将此签名冒充Windows已签名软件。
6. 换公钥只能通过已信任的助手发布或独立可信渠道批准；签名私钥绝不能交给客户端。

## 错误与缓存

| 情况 | 响应 |
|---|---|
| 暂无版本/撤回后为空 | 200，签名payload.latest=null；外层status=no-release、hasUpdate=false |
| 当前号相等或更高 | 200，仍返回当前正式清单，hasUpdate=false；客户端重新计算 |
| 非法currentBuild或未知查询参数 | 400，`{"error":"invalid-current-build"}` |
| 未配置/未初始化 | 503，updates-not-configured / channel-not-initialized |
| 清单签名错误或过期 | 503，manifest-invalid-or-expired |
| EXE丢失、大小/哈希异常 | 503，package-missing-or-corrupt；不会发送损坏文件 |
| 未发布的合法文件名 | 404，package-not-published |
| 已撤回构建下载 | 410，release-withdrawn |
| 测试通道关闭 | 404，test-channel-disabled |
| 维护排空期间 | 503，service-maintenance，Retry-After:30 |
| 任意路径/非白名单方法 | 公网403，本机404；不提供目录枚举 |

错误JSON不带签名，不可作为安装依据。更新响应及下载均no-store。HEAD可查完整长度；当前不实现Range续传，GET始终返回完整单文件。网络失败可退避重试，不能使用半包。

## 本机发布、续签及回退

持久目录为 `<PROJECT>/var/assistant-updates`，不是tmp，不参与现有构建清理。只按已签名current.json中的latest/previous允许下载；源码、配置、原件及未切换的暂存文件不能下载。私有配置/私钥位于 `<PROJECT>/.private/assistant-updates`，整个目录被Git忽略并设置本地ACL，公钥单独交付。

在项目根PowerShell运行，所有正式动作都必须显式加 `--approve-stable`。下例EXE与构建号均为占位示例，不能直接把测试EXE设成正式发布：

```powershell
$packageFile = '<ARTIFACTS>/小灰匠/经审核的正式助手.exe'
$packageSize = (Get-Item -LiteralPath $packageFile).Length
$packageHash = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash.ToLowerInvariant()
node v2/tools/assistant-release.cjs --config .private/assistant-updates/config.json --key .private/assistant-updates/signing-private.pem --channel stable --action publish --approve-stable --file $packageFile --build 202610280001 --display-version '2.1.2 正式版' --notes-file '<ARTIFACTS>/小灰匠/更新说明.txt' --size $packageSize --sha256 $packageHash

# 撤回当前新版并恢复上一正式版（必须确实存在previous）
node v2/tools/assistant-release.cjs --config .private/assistant-updates/config.json --key .private/assistant-updates/signing-private.pem --channel stable --action rollback --approve-stable

# 全部下架，返回签名的“暂无版本”
node v2/tools/assistant-release.cjs --config .private/assistant-updates/config.json --key .private/assistant-updates/signing-private.pem --channel stable --action withdraw --approve-stable

# 保持当前版本、延长清单有效期并增加sequence；应在7天到期前续签
node v2/tools/assistant-release.cjs --config .private/assistant-updates/config.json --key .private/assistant-updates/signing-private.pem --channel stable --action renew --approve-stable
```

发布按源EXE预期大小/哈希及x64 PE头校验，复制到同卷partial并fsync，再复核，重命名为不可变构建包，最后原子替换签名current.json。版本信息和EXE不会分别指向不同提交。发布目录保留包、history清单和release-audit.jsonl；上一版不被覆盖。重复完全相同发布幂等返回原清单；同构建号改内容拒绝。切换前中断不会让孤立包被HTTP下载，同包重试可复用已验证孤立包。损坏的孤立包拒绝。

全局.publish.lock阻止并行发布；异常断电可能留下锁，先确认没有发布进程，再人工移除锁后重试。不要直接编辑签名JSON或手工改current。发布与回退不需要重启8520。

测试发布须用 `--channel test`，并在私有config中显式启用testEnabled；stable清单不会引用test包。测试完成关闭testEnabled。本次没有自动续签任务，7天前需要运行renew；过期时接口安全失败为503，不会悄悄长期信任旧清单。

迁公司服务器：受控迁移发布目录及私钥备份，修改config.directory/publicOrigin/publicKey，设置进程环境变量 `XHJ_ASSISTANT_UPDATE_CONFIG` 指向新配置；在新服务器正常配置并验证HTTPS后，对stable/test分别运行renew，重新签出新域名下载URL。保持产品标识、公钥、构建号及sequence连续；严禁用一个新密钥无提示替换客户端信任根。

## 运维、验收与当前状态

沿用8520/8521的原启动参数、看门狗及stdout/stderr；更新查询也进入原本机API活动日志。新增本机运维接口 `/api/operations/maintenance`：GET读active/routes，POST进入最多5分钟排空窗口，DELETE恢复；仅回环Host与地址、无浏览器跨源请求时可用，公网403。维护期间拒绝新业务并让既有处理/下载结束；不能在active非零时停止服务。原日志上传认证、补传/合并身份、飞书及资料权限未变。

- 21项定向回归通过：6项更新发布/HTTP/故障组测试，以及现有日志接收、飞书契约、GrayDesk、LAN与公网边界回归。故障测试使用隔离合成PE包和模拟接口，不把它称为实际助手功能测试。
- 公网使用本地编译的3072字节诊断EXE，完整下载两次、SHA256一致：`c6c1f9f4fda54e522e2dcf52646e614c0b22e004962d5f62b64541a8fe5b08cc`。它只打印测试提示，无升级功能，未执行客户升级。
- 实测有更新/相同或更高号无更新、撤回新测试版410、恢复上一测试版200、重复下载、stable始终无版本、源码/私钥路径403、错误日志密钥403、公网wiki200。测试通道验收后关闭。
- 缺文件、损坏、大小/哈希不符、发布中断/重试、重复发布、签名篡改/过期/跨通道、并行发布锁及维护等待均在隔离测试通过；没有为了测试故障去破坏正式包。
- 8520/8521部署前连续三次空闲核验，日志队列0；已完成切换并核验wiki、聊天、签名查询和索引。回退源码、配置和详细回执保存在本地 `tmp/assistant-update-20261027`，不公开。
- **服务端已部署；正式助手包未发布、助手端尚待实现和真实验签/替换验收。有效HTTPS未提供；没有绕过证书校验。**
