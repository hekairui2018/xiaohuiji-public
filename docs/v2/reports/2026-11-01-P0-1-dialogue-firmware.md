# P0-1：对话固件切至正式清单

本批仅修改对话固件取数链路，不推进P0-2及其他批次。正式范围保持108份、22型号；没有将固件范围绑定到134个官网产品，没有修改六大类/28子类、原件、SQLite、RAGFlow或公网权限。

## 改动与根因

旧build-knowledge.cjs从历史firmware-manifest编译products[].firmware；resource-service.cjs据uploaded/publicUrl直接形成可交付固件，未经过正式清单。

- firmware-scope.cjs增加只读resolve/dialogueItems及产品投影，生成正式字段与本地sha256下载地址；不在清单中的旧条目标记retired-not-current，撤掉URL。
- build-knowledge.cjs以正式清单覆盖旧映射并登记正式清单的来源哈希；本轮未执行整库重建。
- load-knowledge.cjs对现有知识包进行只读固件投影，提供独立的108条formalFirmware供查询；病例、FAQ与参数原文不变。
- resource-service.cjs从正式适配层查询固件，允许固件库型号独立于产品列表；缺失时返回not-found和明确说明，不回退历史固件。
- resource-reply.cjs仅渲染正式本地固件链接；没有对应固件时给出明确话术。
- dialogue-curated-firmware.test.cjs覆盖旧链接退役、清单外型号不编造、库型号不受产品列表约束、错误sha不回退同名文件。

## 验证命令与真实输出

```text
node --test v2/tests/dialogue-curated-firmware.test.cjs v2/tests/resource-contract.test.cjs v2/tests/mapped-firmware-candidates.test.cjs
# tests 13
# pass 13
# fail 0
# skipped 0
```

该摘要来自Node实际输出的测试总数（原始符号为ℹ）。

```text
node tmp/implementation-20261101/verify-P0-1.cjs
108 size 108
{"topic":"C16L 固件","http":200,"aliyuncs":0,"binCount":4,"in108":true,"ms":10}
{"topic":"下载C16L固件","http":200,"aliyuncs":0,"binCount":4,"in108":true,"ms":18}
{"topic":"C16L FPGA","http":200,"aliyuncs":0,"binCount":4,"in108":true,"ms":14}
{"topic":"C16L firmware","http":200,"aliyuncs":0,"binCount":4,"in108":true,"ms":3}
{"topic":"A3L 固件","http":200,"aliyuncs":0,"binCount":0,"in108":true,"ms":13}
regression: homepage=200 health=200 firmware=108 models=22 download=200 bytes=272038 sha256=match
P0-1: PASS
```

C16L对话集合与Wiki登记集合一致，为9_16_18_0、9_16_13_63、9_16_26_65、9_16_16_99四份；旧9_16_13_0未返回。只读SQLite核验正式108个sha全部存在，C16L四份也一致。未改SQLite数据。知识加载投影与原包对比：casesUnchanged=2231、assetsUnchanged=true、formalFirmware=108；C16L保留1条退役历史记录且无下载地址。

## 部署与失败留痕

本批预先备份五个源码文件、正式清单及发布配置。两次发布均先在备用端口通过health、首页、108固件和实际下载大小/SHA校验，再用现有看门狗计划任务上线，未自行启动常驻服务。前端Copy-Item复用当前版本，文件数21。

首次实际验证发现无固件的原始/v2/dialogue结构没有可读的缺失说明；已补资源message及not-found语义后重测通过。验收器最初误读原始端点的顶层reply也已修正为读取resources.message，未跳过断言。首次脚本换行定位失败及主站启动未就绪探测失败均保留，不计成功。

最终开发运行20261101-dialogue-fw-02，PID42824/Python索引38116。知识版本保持knowledge-fc9f11a1e72de750，未重建案例库；上一可用版本和发布独立哈希可恢复。原始回执、备份及对话记录在tmp/implementation-20261101，不公开原文或私有配置。

## 未解决与验收范围

本批P0-1四项要求通过。已验证列出的五种实际问法和同类合成边界，不能以有限测试证明所有自然语言表达均正确。P0-2公共发布身份安全、RAG第391份、源根配置、闸门边界覆盖、发布全链路gate及P2全量体检/用户体验均未在本批完成，不声称整站通过。
