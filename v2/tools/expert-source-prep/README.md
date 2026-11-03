# 专家资料离线准备工具

把来源文档整理为两个独立 SQLite 候选库，供后续专家入口接入。工具不连接运行中的服务，不修改任何既有索引、数据库或源文档。原件、清单、转换产物、数据库、图片和原文检查报告必须留在私有目录。

## 执行

需要 Python 3.12；OOXML 使用标准库。只有读取旧 Word 的转换 HTML 时需要已有的 `lxml`。SQLite 需支持 FTS5。

```powershell
python -m unittest discover -s v2/tools/expert-source-prep -p test_prepare.py -v
python v2/tools/expert-source-prep/prepare.py --manifest PRIVATE_MANIFEST --output NEW_PRIVATE_DIRECTORY
python v2/tools/expert-source-prep/verify.py --directory NEW_PRIVATE_DIRECTORY
python v2/tools/expert-source-prep/query.py --db PRIVATE_DATABASE --query QUERY --limit 3
```

输出目录必须不存在；拒绝覆盖已有候选库。对现有网站没有部署动作。私有清单使用以下结构，路径和词典由接手方提供，禁止把真实清单提交到公开仓库：

```json
{
  "model_vocabulary": {"X1": "HD-X1", "HD-X1": "HD-X1"},
  "sources": [
    {"family": "tender", "path": "PRIVATE_TENDER_DOCX", "category": "产品类别"},
    {"family": "aftersales", "path": "PRIVATE_EXPERIENCE_DOCX", "category": "产品类别", "entry_levels": [2]},
    {"family": "aftersales", "path": "PRIVATE_UNNUMBERED_CASE_DOCX", "category": "产品类别", "entry_levels": [1], "bare_cases": true},
    {"family": "aftersales", "path": "PRIVATE_CLOUD_DOCX", "category": "平台类别", "entry_levels": [2], "entry_kind": "faq", "cloud": true}
  ]
}
```

`entry_levels` 与 OOXML `outlineLvl` 一样从0开始。清单还支持 `camera=true`：前3章保留为教学，其余为案例或参考候选。不同文档的层级必须人工检查，不能统一选择最深层或数量最多的一层。

## 切分与证据

- 递归解析样式继承，段落直接属性优先；空标题不产生边界。有图片而无文字的段落保留。
- 按文档流读取段落、表格、内容控件，保留表格行列、单元格属性、链接和原始 XML。仅处理主文档正文；不声称已执行 OCR 或渲染检查。
- 控标同时识别手写编号和自动编号；同段连续编号可拆分，子步骤和无编号续写保留；目录条目不算条款。续写归属保留复核标记。
- 售后按逐份配置层级切；型号、章节与直接上文保留。无编号区用显式问题与解决段识别候选边界，不用每个数字拆案例。语义边界仍需复核。
- 附件按内容 SHA256 去重，保留每处关系和位置；外部链接只记录，不下载。
- 原文内部本身可能有条件冲突、过时结论或章节错放，工具不替原件纠错。

旧 Word OLE 容器不能当 ZIP 读取。可以先在私有目录用转换器读取副本，再通过 `legacy_html` 指定 wvWare HTML。`conversion.source_sha256` 与 `conversion.html_sha256` 必须匹配。工具不把 HTML 宣称为原生 DOCX，也不声称转换版式、媒体已验证；含转换图片时拒绝导入，须先登记媒体。源文件仍是权威原件。

## SQL 数据结构

`documents` 保存原件路径、SHA256、解析方式和转换绑定；`blocks` 保存有序段落、表格、原始 XML 和位置。`entries` 是完整条目，`entry_blocks` 给出正文及上下文的精确字符范围。`assets`/`block_assets` 保存去重附件及每次引用。

`entry_entities` 为多入口实体索引。主体标题中的型号与正文提到的型号使用不同 `basis`，不能把正文提到别的型号当成当前条款适用于它。不能确认型号时保留类别，不补造型号。

`search_fragments` 与 `search_fts` 是可重建的关键词检索视图；中文用二元词，型号保持英文数字。长记录的片段均指向同一个 `entry_group`，返回时去重再读取整条。**本工具没有生成向量**；后续如使用现有嵌入服务，应沿用条目ID和原件指纹，不重新拆原件。

查询返回原文、上下文、来源、附件、实体依据及复核状态。可选 `--model` / `--category` 限定；类别未知型号的回退带 `category_only_fallback=true`，不能当成精确型号匹配。短泛问可能只命中概览，专家可根据目标再次细查。

## 使用边界

所有条目默认 `review_state=pending`；`outcome_state=unknown` 表示未作可靠性判定，原文状态句仍完整保存在正文和 `outcome_evidence_json`。不能据此抹掉原文明确记载的成功、失败或返厂，也不能将“没有失败词”推断为成功。

`recommendation_verified` 固定为0。历史升级、复位、更换等动作不是自动获准的当前建议；需要独立核对现场条件和适用依据。控标里的检测报告要求不等于已经取得认证。教学与FAQ可以按原文解释，仍需保留版本和前提。

`verify.py` 检查数据库完整性、原件指纹、正文字符全覆盖、无重复或缺口、附件指纹与引用、原文重建一致及无自动提升处理结论。通过这些检查不代表逐条语义边界、图片内容、型号适用性或答案正确率已通过。

`query.py` 只读本地文件，不提供网络授权。接入服务器时必须由现有授权层限制专家内部入口、下载和附件访问，禁止把整个候选目录挂成公共静态目录。
