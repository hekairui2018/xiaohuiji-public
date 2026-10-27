# 灰Desk普通版在线更新接口

2026-10-27，仅小灰机服务端。协议依据灰Desk已实现的OnlineUpdater.SelectManifest；未改灰Desk源码或安装配置。

## 当前状态

- 已加载开发服务8520/8521。清单路径 `GET /api/graydesk/updates/standard/win-x64`；HEAD同样支持。无发布包返回404，不返回空200或虚假版本。
- `.20261027.23`完整离线安装包已经自行计算大小及SHA256并登记为候选，**未上架**。大小96,578,982字节，SHA256 `0a02601c12c3d4794a34e6d386a1311f119f4ba3e702784d2d72d00a137d6ae5`。
- 2026-10-28用户明确要求使用HTTP，更新接口已允许现有HTTP公网地址；管理入口仍限本机鉴权。清单地址：http://43nudj314064.vicp.fun/api/graydesk/updates/standard/win-x64。
- 客户端目标配置为 `{"ManifestUrl":"http://43nudj314064.vicp.fun/api/graydesk/updates/standard/win-x64"}`。现有灰Desk客户端仍硬性拒绝HTTP，须由灰Desk项目将检查源及下载源的校验改为允许这个指定HTTP主机；保留普通版/同域/大小/哈希校验。仅改配置文件不足以生效，本聊天未修改客户端或发布新包。候选仍未上架，当前清单404。

## 清单合同

匿名只读，无登录、无客户端密钥；只发布普通版win-x64。下面是合同示意，`downloadUrl`占位符不能当真实下载地址：

```json
{
  "product": "graydesk",
  "edition": "standard",
  "arch": "win-x64",
  "version": "2.2.0-test.20261027.23",
  "fileName": "灰Desk-2.2.0-test.20261027.23-安装包.exe",
  "downloadUrl": "http://43nudj314064.vicp.fun/api/graydesk/updates/standard/win-x64/files/0a02601c12c3d4794a34e6d386a1311f119f4ba3e702784d2d72d00a137d6ae5.exe",
  "size": 96578982,
  "sha256": "0a02601c12c3d4794a34e6d386a1311f119f4ba3e702784d2d72d00a137d6ae5",
  "releaseNotes": "由发布者填写实际更新说明",
  "publishedAt": "2026-10-27T00:00:00.000Z"
}
```

UTF-8 JSON；清单ETag为内容哈希，支持If-None-Match返回304，缓存30秒。安装包按实际字节返回，Content-Disposition包含正确UTF-8原文件名，支持GET/HEAD及单段`bytes=start-end` Range（206）；不接受任意文件路径或多段Range。文件缺失或损坏返回503，无包或未上架文件404。安装包上限512 MiB；按TCP来源每分钟120次查询/下载，429附Retry-After:60，不信任客户端Forwarded头；隧道共享来源也共享限额。

## 管理与登记

配置：`.private/graydesk-updates/config.json`。字段为`directory`、`sourceRoot`、`publicOrigin`（未配置时null）及独立`adminToken`。运行包与历史为`var/graydesk-updates/`；两目录已Git忽略，不公开管理员密钥或原安装包。配置文件需由部署Windows账号保护读取权限。

管理API限回环地址、localhost/127.0.0.1 Host、无浏览器Origin，必须携带`Authorization: Bearer <adminToken>`；公网/LAN均不开放。没有网页管理页，提供管理API及本机CLI。

- `GET /api/graydesk/updates/admin`：读取候选、当前发布和审计历史。
- `POST .../admin/stage`：登记已落盘完整安装包，不接收网络大文件上传。JSON示例字段为`file, version, edition:"standard", arch:"win-x64", releaseNotes, expectedSHA256`。file只能在配置sourceRoot下，basename严格匹配普通版命名；管理JSON最大16 KiB。可选expectedSHA256只作核对，服务端仍重新计算实际摘要及大小。
- `POST .../admin/publish`：`{"version":"2.2.0-test.20261027.23","confirmVersion":"2.2.0-test.20261027.23"}`。必须先配置已核验的HTTP/HTTPS origin，并已获得具体发布授权；本次没有执行。
- `POST .../admin/withdraw`：清空当前发布，保留历史和包；已缓存清单可能再保留30秒，不承诺即时撤回。

CLI（路径占位符须换为本机实际值）：

```powershell
node v2/tools/graydesk-update.cjs --action status --config <私有配置文件>
node v2/tools/graydesk-update.cjs --action stage --config <私有配置文件> --file <完整安装包路径> --version 2.2.0-test.20261027.23 --notes <真实更新说明> --expected-sha256 <预期哈希>
# 仅在入口已验收并明确获准发布后执行：
node v2/tools/graydesk-update.cjs --action publish --config <私有配置文件> --version 2.2.0-test.20261027.23 --confirm-version 2.2.0-test.20261027.23
```

版本以数字元组比较，拒绝hecheng等后缀及不同渠道；同版本不可覆盖，发布不可降级。stage本身不切换清单；源包/复制包都验证，通过后才保存候选。publish再次核对实际包并用单一原子state文件切换当前版本；跨进程锁防并发。审计保留操作、版本、时间和已鉴权操作者类别（当前一个本机管理角色，没有多人身份系统）。中断复制不登记、锁冲突409；进程崩溃残留锁需要运维确认无发布进程后人工恢复。撤回后相同版本不重新发布，应制作更高版本，避免降级/覆盖。

文件名、人工声明和PE头不能独立证明二进制内部属于普通版；管理员必须核对可信构建回执。本次实际安装包与用户给出的普通版哈希完全一致。安装器可以是x86封装的PE，不能据安装器外壳误判内部win-x64程序。

## 验证范围

20项定向回归通过（更新7项，加既有异常接收、LAN和公网13项）。隔离环境实际96,578,982字节下载及SHA256一致，HEAD/Range/ETag、鉴权、404/503、复制中断、并发原子性和渠道隔离通过。生产清单保持无发布；未运行安装器、未修改灰Desk源码、未替换已安装版、未发布客服机或GitHub安装包。公网HTTP已接通；因候选未上架及客户端仍拒HTTP，未宣称真实灰Desk更新端到端完成。
