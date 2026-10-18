# V2 产品速查接口契约



本节覆盖上文旧的三分类限制；仅扩展已有路由。前端无需新造接口，不要修改飞书、日志、知识快照或资料原件。

### 按钮与请求

| 页面内容 | 请求 | 响应位置 |
|---|---|---|
| 规格书、说明书 | GET `/api/docs?cat=spec` 或 `manual` | `docs.groups[].products[].items[]`；也可用 `docs.items[]` 平铺 |
| 其他资料、待确认 | GET `/api/docs?cat=other` 或 `pending` | 同上；pending也含版号未识别的本地固件候选，按文件的kind显示 |
| 历史版本 | GET `/api/docs?cat=history` | 已比较且被替代的文档、固件；不含签章文件，不含无法比较的未知版本 |
| 某类连同历史 | GET `/api/docs?cat=manual&history=all` | 原分类，文件通过versionStatus区分 |
| 仅某类历史 | GET `/api/docs?cat=firmware&history=only` | 固件既有文件名/槽位规则下的历史记录，不表示硬件兼容审核 |
| 软件工具 | GET `/api/software?q=` | `software.items[]`为既有登记软件；`software.packages[]`为来源目录明确的本地安装包候选；`historicalPackages[]`为明确旧版目录候选 |
| 视频 | GET `/api/videos?q=` | `video.groups[].videos[]`；`outline=1`只返目录，不提供下载身份或已核原件的承诺 |
| 型号速查 | GET `/api/search?q=完整型号` | `results[].docGroups[].items[]`，kind区分资料角色 |

`history`省略为current；`cat=history`始终只返回已知历史，不会将未知版号判成历史。无版号原有资料保留原角色和展示，不标成最新版。可比较版本只在同文档家族/语言/适用范围内选择。固件沿用原文件名和版本槽位隔离规则，仍需人工核对设备兼容，不宣称是工程批准的最新固件。

规格/说明新增`lcd`大类，标签“LCD 产品 · 软件与操作”，来源于已登记的LCD资料目录，按每份资料分组，不把一个型号的所有资料无条件归LCD。归档目录用于浏览分类，不能证明型号适用或兼容性；原文明确标题优先，混合品质父目录不能被整批当成证书。分类/型号冲突保持待核。

### 文件字段（兼容新增）

- `name,kind,url,downloadUrl?,available,unavailableReason,unavailableMessage?`：链接使用返回值；未知/不可用不自行拼链接。PDF原文件预览、Office缓存文本预览及显式下载保持原行为。
- `resourceId,resourceVersionId,versionId`：来自同一资源索引；`resourceVersionId`与`versionId`是兼容别名。没有原件身份时null。
- `fileId`：有SHA时为`sha256:<64位内容哈希>`，否则已登记versionId，均无时null。跨型号、改名副本按内容哈希去重；不能用名称相近作为身份。不把文件ID直接当下载id。
- `associatedModels[]`：导航关联型号，可包含文件名线索；`applicableModels[]`只保留已有原文型号依据。集合标题不会当作型号。`associationStatus,resourceOnly,reviewRequired`必须保留，关联不等于兼容确认。
- `documentVersion,versionBasis,versionSelection,versionStatus`：没有版本保持null/unknown；不能补V或单位。`versionStatus`枚举：`unknown / conflict / historical / latest-confirmed-family / identified-not-compared`。软件旧目录候选额外为`historical-source-folder`，不表示按安装包内容核实版本。
- `classificationBasis,classificationEvidence[],scopeEvidence[]`：已有分类依据、原文块位置和条件；缺失为空，不用其他型号补造。固件/视频没有文档封面字段时为空。
- `parseStatus`：文档可含`state,blockCount,ocrPendingPages,complete`；state来自原解析器，如parsed、parsed-ocr-pending、ocr-pending、unsupported-legacy、misnamed-legacy-office、not-parsed；complete仅表示解析器文本状态，不代表图片操作全部理解。未采集时null，仍可下载原件，不阻塞其他文件。
- 本地正文搜索的results增加`fileId,sha256,resourceVersionId`，与目录和型号速查同源。原有`resourceId/versionId/blockId/evidenceId/locator/download/readUrl`保留。

### 数量、分页与候选边界

`docs.total/associationCount`是资料关联条目数；`uniqueFileCount`为按现有身份去重的计数（含未定位历史引用，不能称作全部可下载原件）；`uniqueAvailableFileCount`才是已可用独立资料数。分页时这些全局数不变，`groups[].count/fileCount`为本页数量；全量请求为全量数量。同一原件仍可在多个型号下出现。

未传limit保持旧行为返回完整目录。传`limit=1..200`启用分页，offset为非负整数，offset不能单独使用。`docs.items`与groups包含同一页；`pagination:{offset,limit,total,returned,nextOffset}`，nextOffset为null表示结束。没有游标快照，目录在翻页期间更新时应从第一页刷新。软件/视频目前没有分页；不要编造页码协议，视频优先请求outline。

安装包候选限定现有已登记软件来源目录及exe/msi/apk格式，按哈希去重；没有可靠用途、版本或型号时标记候选，不自动替换既有软件推荐下载。`filenameVersionHint`仅文件名线索，不能显示为实际安装/升级结果。历史安装包单独返回，不默认混进当前目录。其他来源/未支持的包格式仍在原始资料索引，不冒充已登记软件。

`catalogStatus:{state,reason,lastSuccessfulAt,cacheSeconds}`：ready / stale-cache / unavailable / not-loaded，目录缓存最长30秒；服务失败保留上次缓存并明确状态，原件链接仍逐项校验。软件items保留旧结构，新增packages需要前端显式渲染；本轮未修改前端。

公网仍只取原批准快照和云端白名单，不加载本地新增目录，内部文件ID/原文证据移除；不能把本地结果搬到公网页面。13条未定位的当前旧引用继续url:null并说明错误，不自动借用相近型号或其他版本。历史入口还可能包含无法定位的旧历史引用。

## 网页入口

资料页仅使用`/wiki`，旧`/quick`网页已移除。`/huiai`保持独立。开发代理应使用后端工作区最新版`v2/tools/start-frontend.cjs`，`--frontend-root`指向前端独立资源目录；旧前端分支代理需停止，不能继续用旧路由。内部兼容产品查询API与网页路径分别维护，不删除已有业务功能。

## 规格书、说明书、操作视频：来源目录与平铺（2026-10-17）

本轮只整理这三类，软件/固件的原API与按钮保持。来源目录为类别和浏览分组主要依据，不能证明型号适用或兼容。目录与明确正文/格式冲突用`classificationConflict`标记并保留待确认，文件名仅线索；原始路径和版本记录仍在索引，不由前端改写。

- 推荐目录请求：`GET /api/docs?cat=spec&view=flat`，说明书用`cat=manual`；`view=grouped`（默认）保留现有兼容结构。非法view返回400。
- flat响应：`docs.groups:[{key,label,count,items:[文件]}]`，没有products子层。直接渲染分类标题和文件列表，不能再展开来源目录、系列、型号文件夹。每份文件的`associatedModels[]`可作为行内型号标签。
- `docs.flatGroups`始终提供同类的一层平铺结果。flat模式分页基于各平铺组去重后的文件条目；同一原件跨分类仍可能有多个入口，顶层uniqueFileCount保持内容身份去重。grouped模式的原关联分页语义不变。
- 来源分类K/R接收卡、A/H播放盒、云平台/APP合并；B/C/D/T/VP/MS、分布式中控、信号传输、配件等沿用真实来源分类。LCD不同来源入口合并LCD。没有来源分类时只保留一个分类待确认组，不由型号前缀继续发明分类。
- `GET /api/videos`及`outline=1`本地仅操作视频，`groups[].videos[]`直接是文件；`purpose,purposeBasis`说明来源目录或仅标题线索，未读取视频不能声称内容已核实。`excludedNonOperationCount`为宣传/培训/用途不明确候选数，不是删除数。outline数量在原件验证/去重后可变化。
- 型号查询仍用`/api/search`，新增`results[].resourceGroups`为规格书/说明书/操作视频三个直接文件数组；`pendingResources`单列。软件、固件原docGroups/firmwareGroup不移除；没有可靠的型号-视频关联时数组为空，不把全局视频混进型号结果。
- 历史、未知版本、型号范围与目录分类分别处理；不得为了展示简洁丢掉原始身份或把未知版本当旧版。正文搜索、原件URL、预览URL仍复用返回值。

8520是后端和已集成应用，8620是独立前端开发代理；两个工作区各有自己的页面，不以同一个/wiki路径把两套页面合并。正常顶层浏览器链接已不再被误当跨站API，但跨站接口、iframe、写请求和不允许的Host/来源仍禁止。


### Lightweight browse metadata

`GET /api/docs?cat=spec|manual|firmware|other|pending&list=1` retains the existing groups/products/items layout, counts, order, file identities, names, version and download fields. It omits repeated docs.items/docs.flatGroups and deep classification evidence; full default and history responses stay available. No pagination is required for the current compact per-category lists (largest observed compressed payload about174KB). Existing offset/limit and view parameters remain valid.

Local software/video and document metadata responses support gzip and Server-Timing. Cache freshness is30 seconds; a last successful response can be served while revalidating for at most an additional60 seconds. Original downloads retain live checks. The isolated runtime prepares common lists before listening; startup preparation duration is logged. Public requests remain separately scoped.

## 2026-10-18：可用原件与缺失引用分离（本地）

实际原件解析后，本地当前目录及产品查询不再把`original-not-registered`、`registered-original-unavailable-or-changed`的缺失引用混入主要资料/下载列表。此行为不表示不同版本已经确认互相替代。

- `/api/docs?cat=spec`等当前文档列表：`docs.groups/products/items`及总数、分页按主要列表计算；新增`docs.unavailableRecords`（文件原字段、`model`、`categoryLabel`）和`docs.unavailableReferenceCount`保留缺失证据。轻量`list=1`也保留该字段。
- `/api/search?q=型号`：主要`docGroups`、`specGroups`及`specFiles/specLinks`使用现有原件；新增`unavailableResources`保留缺失引用。
- `history=all/only`保留原有查询结果。未知版本、不同硬件、内容身份冲突及临时服务失败不按缺失旧引用处理。
- 前端将缺失记录单独收起；普通列表展示实际可用文件，不改原文件名及预览/下载地址，不删除知识快照记录。


## 2026-10-18 说明书及固件浏览大类

本地说明书 groups 使用规格书已确认的型号归属和同序大类，原 sourceGroup、associatedModels、身份、版本及链接不修改。没有明确归属的放“其他”。

本地固件保持原 groups（型号→items）以兼容已有客户端，新增 firmwareCategories: [{key,label,models:[型号]}]，只索引型号，不重复固件文件载荷。分页仍作用于原 groups/items；浏览客户端按 models 对当前返回的型号行建立二级菜单。此字段也适用于 list=1。固件选择、硬件条件及原件下载不变。


## 2026-10-18 公网日志接收

指定publicOrigin可POST /api/huidu/log，沿用X-Upload-Key密钥验证、1MiB正文上限、原有结构校验/幂等/TXT留底及飞书outbox。不支持无密钥写入、跨站浏览器写入或GET读日志。OCR、对话、会话、日志状态及内网原件仍不对公网开放。客户端使用已配置的完整外网域名/api/huidu/log，不发送到域名解析IP。
