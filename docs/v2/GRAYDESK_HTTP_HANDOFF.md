# 灰Desk项目HTTP对接

2026-10-28用户要求所有灰Desk入口使用HTTP，已明确同意上报凭证及脱敏日志的明文传输。

- 更新清单：http://43nudj314064.vicp.fun/api/graydesk/updates/standard/win-x64（当前未上架，404）。
- 异常接收：POST http://43nudj314064.vicp.fun/api/graydesk/errors，Bearer凭证取本机既有客户端专用私有配置。
- update-source.json目标：`{"ManifestUrl":"http://43nudj314064.vicp.fun/api/graydesk/updates/standard/win-x64"}`。
- 当前OnlineUpdater.CheckAsync及SelectManifest只允许HTTPS，灰Desk项目需改为允许这个精确HTTP主机，并允许同主机HTTP下载；其他主机、定制版、版本比较、大小和SHA256规则保持。此变更需重新出客户端包，不能把改配置说成已支持HTTP。
- 服务端不向客户端传递飞书应用密钥，管理接口不对公网开放。
- 此次未发布灰Desk安装包、未修改客户端源码、未切换已安装版本。
