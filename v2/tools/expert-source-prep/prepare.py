"""Offline source-preserving expert SQLite preparation. Never activates a runtime."""

import argparse
import collections
import hashlib
import json
import posixpath
import re
import sqlite3
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
HEAD = re.compile(
    r"^\s*[★☆]*\s*(?P<label>(?:\d{1,3}(?:\.\d+)*[、．.)）]|[（(]\d{1,3}[)）]|[一二三四五六七八九十]+[、．.]|[①-⑳]))"
)
INLINE = re.compile(r"(?:^|(?<=[\s；;。]))[★☆]*\s*(\d{1,3})[、．.](?!\d)")
SOLUTION = re.compile(
    r"(?:临时)?(?:解决方法|解决办法|解决方案|解决方式|处理方法|处理方案)\s*[:：]"
)
PHENOMENON = re.compile(
    r"^\s*(?:\d+[、．.]\s*)?(?:问题现象|问题描述|问题情况|问题|故障现象)\s*[:：]"
)
CHIP = re.compile(
    r"(?<![A-Z0-9])(?:ICND|ICN|SM|FM|MBI|DP|RUL|RUC|LS)\d{3,6}[A-Z0-9]*(?![A-Z0-9])",
    re.I,
)
MODEL = re.compile(r"(?<![A-Z0-9])HD[-－][A-Z0-9][A-Z0-9._+/-]*(?![A-Z0-9])", re.I)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def val(node, path):
    found = node.find(path) if node is not None else None
    return found.get(W + "val") if found is not None else None


def paragraph_text(node):
    # Deleted revisions and instruction strings are not displayed source text.
    def walk(el):
        if el.tag in (W + "del", W + "moveFrom"):
            return ""
        if el.tag == W + "t":
            return el.text or ""
        if el.tag in (W + "br", W + "cr"):
            return "\n"
        if el.tag == W + "tab":
            return "\t"
        return "".join(walk(child) for child in el)

    return walk(node).strip()


def fts_tokens(text):
    text = text.upper()
    tokens = re.findall(r"[A-Z0-9][A-Z0-9._+-]*", text)
    for run in re.findall(r"[\u3400-\u9fff]+", text):
        tokens.extend(run[i : i + 2] for i in range(len(run) - 1))
        if len(run) == 1:
            tokens.append(run)
    return " ".join(tokens)


def read_docx(path, asset_dir):
    with zipfile.ZipFile(path) as package:
        root = ET.fromstring(package.read("word/document.xml"))
        styles = ET.fromstring(package.read("word/styles.xml"))
        smap = {s.get(W + "styleId"): s for s in styles.findall(W + "style")}
        default = next(
            (
                s.get(W + "styleId")
                for s in smap.values()
                if s.get(W + "default") == "1" and s.get(W + "type") == "paragraph"
            ),
            None,
        )

        def inherited(sid, prop):
            seen = set()
            while sid in smap and sid not in seen:
                seen.add(sid)
                result = val(smap[sid], W + "pPr/" + prop)
                if result is not None:
                    return result
                sid = val(smap[sid], W + "basedOn")
            return None

        def effective(pr, sid, prop):
            direct = val(pr, prop)
            return direct if direct is not None else inherited(sid, prop)

        rels = {}
        if "word/_rels/document.xml.rels" in package.namelist():
            for rel in ET.fromstring(package.read("word/_rels/document.xml.rels")):
                rels[rel.get("Id")] = dict(rel.attrib)
        numbering = (
            ET.fromstring(package.read("word/numbering.xml"))
            if "word/numbering.xml" in package.namelist()
            else ET.Element("empty")
        )
        nums = {n.get(W + "numId"): n for n in numbering.findall(W + "num")}
        abstracts = {
            n.get(W + "abstractNumId"): n for n in numbering.findall(W + "abstractNum")
        }
        blocks = []

        def visit(parent, location):
            for offset, node in enumerate(parent):
                loc = f"{location}/{offset}:{node.tag.split('}')[-1]}"
                if node.tag not in (W + "p", W + "tbl"):
                    if node.tag not in (W + "sectPr",):
                        visit(node, loc)
                    continue
                kind = "paragraph" if node.tag == W + "p" else "table"
                pr = node.find(W + "pPr") if kind == "paragraph" else None
                sid = val(pr, W + "pStyle") or default
                style_name = val(smap.get(sid), W + "name") or ""
                is_toc = bool(
                    re.search(r"TOC|目录", style_name, re.I)
                    or any(
                        (n.get(W + "anchor") or "").startswith("_Toc")
                        for n in node.iter(W + "hyperlink")
                    )
                )
                outline = (
                    effective(pr, sid, W + "outlineLvl")
                    if kind == "paragraph"
                    else None
                )
                numid = effective(pr, sid, W + "numPr/" + W + "numId")
                ilvl = effective(pr, sid, W + "numPr/" + W + "ilvl") or "0"
                numfmt = number_template = None
                if numid in nums and numid != "0":
                    abstract = abstracts.get(val(nums[numid], W + "abstractNumId"))
                    level = (
                        next(
                            (
                                n
                                for n in abstract.findall(W + "lvl")
                                if n.get(W + "ilvl") == ilvl
                            ),
                            None,
                        )
                        if abstract is not None
                        else None
                    )
                    override = next(
                        (
                            n.find(W + "lvl")
                            for n in nums[numid].findall(W + "lvlOverride")
                            if n.get(W + "ilvl") == ilvl
                            and n.find(W + "lvl") is not None
                        ),
                        None,
                    )
                    level = override if override is not None else level
                    numfmt = val(level, W + "numFmt")
                    number_template = val(level, W + "lvlText")
                cells = []
                if kind == "table":
                    for ri, row in enumerate(node.findall(W + "tr")):
                        for ci, cell in enumerate(row.findall(W + "tc")):
                            cells.append(
                                {
                                    "row": ri,
                                    "column": ci,
                                    "text": "\n".join(
                                        paragraph_text(p) for p in cell.iter(W + "p")
                                    ),
                                    "properties_xml": (
                                        ET.tostring(
                                            cell.find(W + "tcPr"), encoding="unicode"
                                        )
                                        if cell.find(W + "tcPr") is not None
                                        else ""
                                    ),
                                }
                            )
                    text = "\n".join(
                        "\t".join(c["text"] for c in cells if c["row"] == ri)
                        for ri in range(len(node.findall(W + "tr")))
                    )
                else:
                    text = paragraph_text(node)
                links, assets = [], []
                for child in node.iter():
                    for attr in (R + "embed", R + "id", R + "link"):
                        rid = child.get(attr)
                        if rid not in rels:
                            continue
                        rel = rels[rid]
                        if rel.get("TargetMode") == "External":
                            links.append(
                                {
                                    "id": rid,
                                    "target": rel["Target"],
                                    "type": rel.get("Type"),
                                }
                            )
                            continue
                        target = posixpath.normpath(
                            posixpath.join("word", rel["Target"])
                        )
                        if target.startswith("../") or target not in package.namelist():
                            assets.append(
                                {"id": rid, "missing": True, "target": target}
                            )
                            continue
                        data = package.read(target)
                        sha = digest(data)
                        suffix = Path(target).suffix.lower()
                        if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
                            suffix = ".dat"
                        dest = asset_dir / (sha + suffix)
                        if not dest.exists():
                            dest.write_bytes(data)
                        assets.append(
                            {
                                "id": rid,
                                "sha256": sha,
                                "path": "assets/" + dest.name,
                                "target": target,
                                "type": rel.get("Type"),
                                "bytes": len(data),
                            }
                        )
                blocks.append(
                    {
                        "ordinal": len(blocks),
                        "locator": "word/document.xml#" + loc,
                        "kind": kind,
                        "text": text,
                        "outline": (
                            int(outline)
                            if outline is not None and int(outline) < 9
                            else None
                        ),
                        "style": sid,
                        "numid": numid,
                        "num_level": int(ilvl),
                        "numfmt": numfmt,
                        "is_toc": is_toc,
                        "number_template": number_template,
                        "cells": cells,
                        "assets": list({a["id"]: a for a in assets}.values()),
                        "links": list({a["id"]: a for a in links}.values()),
                        "raw_xml": ET.tostring(node, encoding="unicode"),
                    }
                )

        visit(root.find(W + "body"), "body")
    return blocks


def read_legacy_html(path):
    # wvWare HTML preserves list values and product headings; original OLE stays authoritative.
    from lxml import html

    root = html.fromstring(path.read_text(encoding="utf-8"))
    if root.xpath("//img"):
        raise ValueError("Legacy converted media must be registered before import")
    blocks = []
    for i, div in enumerate(root.xpath("//div[@name]")):
        if div.xpath(".//div[@name]"):
            continue
        text = " ".join("".join(div.itertext()).split())
        if not text:
            continue
        heading = bool(re.search(r"控标点\s*$", text) and "目录" not in text)
        li = next(iter(div.iterancestors("li")), None)
        blocks.append(
            {
                "ordinal": len(blocks),
                "locator": f"converted-wvWare-1.2.9.html#named-div-{i}",
                "kind": "paragraph",
                "text": text,
                "outline": 0 if heading else None,
                "style": div.get("name"),
                "numid": "legacy-list" if li is not None else None,
                "is_toc": div.get("name") == "TOC Heading",
                "num_level": 0,
                "numfmt": "decimal" if li is not None and not heading else None,
                "number_template": li.get("value") if li is not None else None,
                "cells": [],
                "assets": [],
                "links": [],
                "raw_xml": html.tostring(div, encoding="unicode"),
            }
        )
    return blocks


def inline_parts(text):
    matches = list(INLINE.finditer(text))
    # Only split a continuous numbered sequence that starts the paragraph.
    # Decimal specifications (USB 3.0, H.265) and isolated references are not boundaries.
    if len(matches) < 2 or text[: matches[0].start()].strip():
        return [(0, len(text))]
    if any(int(b[1]) != int(a[1]) + 1 for a, b in zip(matches, matches[1:])):
        return [(0, len(text))]
    starts = [m.start() for m in matches]
    return list(zip(starts, starts[1:] + [len(text)]))


def ancestors_for(blocks):
    stack, contexts = [], []
    for block in blocks:
        level = block["outline"]
        if level is not None and block["text"]:
            while stack and stack[-1][0] >= level:
                stack.pop()
            contexts.append([i for _, i in stack])
            stack.append((level, block["ordinal"]))
        else:
            contexts.append([i for _, i in stack])
    return contexts


def make_entry(kind, title, parts, context, rule, flags=None, title_index=None):
    return {
        "kind": kind,
        "title": title,
        "parts": parts,
        "context": context,
        "rule": rule,
        "flags": flags or [],
        "title_index": title_index,
    }


def full_part(block):
    return (block["ordinal"], 0, len(block["text"]))


def split_tender(blocks):
    contexts = ancestors_for(blocks)
    entries, current, product = [], None, []
    for b in blocks:
        idx, text = b["ordinal"], b["text"]
        if b["outline"] is not None and text:
            current = None
            product = contexts[idx] + [idx]
            entries.append(
                make_entry(
                    "context",
                    text,
                    [full_part(b)],
                    contexts[idx],
                    "product-heading",
                    title_index=idx,
                )
            )
            continue
        if not text and not b["assets"]:
            continue
        if b.get("is_toc"):
            entries.append(
                make_entry(
                    "context",
                    text[:140],
                    [full_part(b)],
                    [],
                    "table-of-contents",
                    title_index=idx,
                )
            )
            continue
        auto = b["numfmt"] not in (None, "bullet", "none", "chineseCounting") and b[
            "numid"
        ] not in (None, "0")
        head = HEAD.match(text)
        sublevel = bool(
            auto and current and b["num_level"] > current.get("num_level", 0)
        )
        if (auto or head) and not sublevel:
            pieces = inline_parts(text)
            for start, end in pieces:
                current = make_entry(
                    "tender_clause",
                    text[start:end].strip()[:140],
                    [(idx, start, end)],
                    product,
                    "auto-number" if auto else "literal-number",
                    title_index=idx,
                )
                current["num_level"] = b["num_level"]
                if len(pieces) > 1:
                    current["flags"].append("inline-number-sequence")
                entries.append(current)
        elif current is not None:
            current["parts"].append(full_part(b))
            if text and not sublevel:
                current["flags"].append("continuation-scope-needs-review")
        else:
            entries.append(
                make_entry(
                    "context",
                    text[:140] or "附件",
                    [full_part(b)],
                    product,
                    "unattached-product-context",
                    title_index=idx,
                )
            )
    return entries


def coarse_aftersales(blocks, spec):
    contexts = ancestors_for(blocks)
    entries = []
    levels = spec.get("entry_levels", [])
    # A higher heading closes a child entry even when it is not an entry itself.
    boundaries = [
        b["ordinal"]
        for b in blocks
        if b["outline"] is not None and b["text"] and b["outline"] <= max(levels or [1])
    ]
    cuts = sorted(set([0, len(blocks)] + boundaries))
    camera_mode = "instruction"
    for start, end in zip(cuts, cuts[1:]):
        selected = blocks[start:end]
        if not any(b["text"] or b["assets"] for b in selected):
            continue
        first = selected[0]
        own = first["outline"] in levels and bool(first["text"])
        if spec.get("camera"):
            chapter = next(
                (
                    blocks[i]["text"]
                    for i in contexts[start] + [start]
                    if blocks[i]["outline"] == 0 and "章" in blocks[i]["text"]
                ),
                "",
            )
            camera_mode = (
                "instruction"
                if re.search(r"第[一二三]章", chapter) or not chapter
                else "case_or_reference"
            )
        if own:
            kind = spec.get("entry_kind", "case_or_reference")
            if spec.get("camera"):
                kind = camera_mode
            title = first["text"]
            rule = "configured-entry-level"
        elif first["outline"] is not None and first["text"]:
            kind = "context"
            title = first["text"]
            rule = "parent-section-context"
        else:
            kind = "context"
            title = first["text"][:140] or "文档前言或附件"
            rule = "document-prefix"
        entries.append(
            make_entry(
                kind,
                title,
                [full_part(b) for b in selected if b["text"] or b["assets"]],
                contexts[start],
                rule,
                title_index=start,
            )
        )
    return entries


def split_bare_cases(blocks, entry):
    """Conservative boundaries: explicit new problem, or new prose after a solution.

    Never split on numbered procedure steps. Images between solution and next
    problem remain with the previous record. Ambiguous sections stay together.
    """
    parts = entry["parts"]
    groups, group, seen_solution = [], [], False
    for position, part in enumerate(parts):
        b = blocks[part[0]]
        text = b["text"][part[1] : part[2]]
        solution = SOLUTION.search(text)
        next_text = next(
            (
                blocks[p[0]]["text"][p[1] : p[2]]
                for p in parts[position + 1 :]
                if blocks[p[0]]["text"][p[1] : p[2]].strip()
            ),
            "",
        )
        followed_by_solution = bool(SOLUTION.match(next_text))
        new_problem = bool(
            PHENOMENON.match(text)
            and group
            and any(blocks[p[0]]["text"] for p in group)
        )
        technical_start = bool(
            re.match(
                r"^(?:(?:HD[-－])?[A-Z][A-Z0-9+_.-]*\d[A-Z0-9+_.-]*|模组|灯板|屏幕|显示屏|发送|播放|出现|设备|处理器|电脑|软件|手机|升级|断电|接收卡|控制卡|遥控器|目前所有|现场)",
                text,
                re.I,
            )
        )
        after_solution = bool(
            seen_solution
            and technical_start
            and not b.get("links")
            and not solution
            and not HEAD.match(text)
            and not re.match(
                r"^[。\s]*(?:注|备注|注意|说明|原因|临时|处理|解决|如下|如图|见图|步骤|最后|然后|再|先|并|或|该|此|上图|下图)",
                text,
            )
            and len(text) >= 6
            and (
                followed_by_solution
                or re.search(
                    r"问题|异常|黑屏|花屏|不亮|亮不起|切不了|找不到|重启|失败|无法|不正常|不显示|没声音|没有|不能|不受控|提示|闪|识别|卡死|发绿|偏色|色块|无反应",
                    text,
                )
            )
        )
        bare_title = bool(
            seen_solution
            and not HEAD.match(text)
            and 5 <= len(text) <= 80
            and not b.get("links")
            and re.search(
                r"(?:问题|异常|注意事项|操作说明|设置方法|处理办法)[：:！!。]?$", text
            )
        )
        if new_problem or after_solution or bare_title:
            groups.append(group)
            group, seen_solution = [], False
        group.append(part)
        seen_solution = seen_solution or bool(solution)
    if group:
        groups.append(group)
    result = []
    for group in groups:
        textblocks = [
            blocks[p[0]]["text"][p[1] : p[2]]
            for p in group
            if blocks[p[0]]["text"][p[1] : p[2]]
        ]
        title = next(
            (t for t in textblocks if not re.fullmatch(r"\d+[.、]?", t)), entry["title"]
        )
        substantive = "\n".join(textblocks).strip()
        kind = (
            "context"
            if (
                len(substantive) < 5
                or re.fullmatch(
                    r"(?:通用问题[:：]?|.*经验分享|.*问题总结)", substantive
                )
            )
            else "case_or_reference"
        )
        result.append(
            make_entry(
                kind,
                title[:180],
                group,
                entry["context"],
                "solution-and-problem-boundary",
                ["semantic-boundary-needs-review"],
                title_index=group[0][0],
            )
        )
    return result


def split_aftersales(blocks, spec):
    coarse = coarse_aftersales(blocks, spec)
    if not spec.get("bare_cases"):
        return coarse
    out = []
    for entry in coarse:
        if (
            entry["kind"] == "context"
            and blocks[entry["parts"][0][0]]["outline"] is None
        ):
            out.append(entry)
            continue
        if entry["kind"] in ("instruction", "faq", "information"):
            out.append(entry)
            continue
        # Product headings remain parent context, never counted as cases.
        head = entry["parts"][0]
        if blocks[head[0]]["outline"] is not None:
            out.append(
                make_entry(
                    "context",
                    blocks[head[0]]["text"],
                    [head],
                    entry["context"],
                    "scope-heading",
                    title_index=head[0],
                )
            )
            entry = dict(
                entry, parts=entry["parts"][1:], context=entry["context"] + [head[0]]
            )
        if entry["parts"]:
            out.extend(split_bare_cases(blocks, entry))
    return out


def entities_for(text, vocabulary):
    found = set()
    upper = text.upper()
    for alias, canonical in vocabulary.items():
        if re.search(r"(?<![A-Z0-9])" + re.escape(alias) + r"(?![A-Z0-9._+-])", upper):
            found.add(("model", canonical))
    for match in MODEL.finditer(upper):
        found.add(("model", match[0].rstrip("./-")))
    for match in CHIP.finditer(upper):
        found.add(("chip", match[0]))
    for software in (
        "HDSET",
        "HDPLAYER",
        "HDCALCUBE",
        "HD2020",
        "屏掌控",
        "小灰云",
        "MAGICPLAYER",
        "AITIME2",
        "CCMAX",
    ):
        if software in upper:
            found.add(("software", software))
    return sorted(found)


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE documents(id TEXT PRIMARY KEY,name TEXT NOT NULL,source_path TEXT NOT NULL,sha256 TEXT NOT NULL,
 family TEXT NOT NULL,category TEXT NOT NULL,parser TEXT NOT NULL,conversion_json TEXT NOT NULL);
CREATE TABLE blocks(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),ordinal INTEGER NOT NULL,
 locator TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,outline INTEGER,properties_json TEXT NOT NULL,raw_xml TEXT NOT NULL,
 UNIQUE(document_id,ordinal));
CREATE TABLE assets(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,path TEXT NOT NULL,bytes INTEGER NOT NULL);
CREATE TABLE block_assets(block_id TEXT NOT NULL REFERENCES blocks(id),relationship_id TEXT NOT NULL,
 asset_id TEXT REFERENCES assets(id),metadata_json TEXT NOT NULL,PRIMARY KEY(block_id,relationship_id));
CREATE TABLE entries(id TEXT PRIMARY KEY,entry_group TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),
 kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,context_text TEXT NOT NULL,category TEXT NOT NULL,
 subject_state TEXT NOT NULL,starred INTEGER NOT NULL,original_number_json TEXT NOT NULL,
 outcome_state TEXT NOT NULL DEFAULT 'unknown',outcome_evidence_json TEXT NOT NULL,
 recommendation_verified INTEGER NOT NULL DEFAULT 0 CHECK(recommendation_verified=0),
 review_state TEXT NOT NULL DEFAULT 'pending',review_flags_json TEXT NOT NULL,rule TEXT NOT NULL,access_scope TEXT NOT NULL DEFAULT 'expert_internal');
CREATE TABLE entry_blocks(entry_id TEXT NOT NULL REFERENCES entries(id),block_id TEXT NOT NULL REFERENCES blocks(id),
 role TEXT NOT NULL,start_char INTEGER NOT NULL,end_char INTEGER NOT NULL,sequence INTEGER NOT NULL,
 PRIMARY KEY(entry_id,role,sequence));
CREATE TABLE entry_entities(entry_id TEXT NOT NULL REFERENCES entries(id),kind TEXT NOT NULL,value TEXT NOT NULL,
 basis TEXT NOT NULL,PRIMARY KEY(entry_id,kind,value));
CREATE INDEX entries_kind_category ON entries(kind,category);
CREATE INDEX entity_lookup ON entry_entities(kind,value,entry_id);
CREATE TABLE search_fragments(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES entries(id),sequence INTEGER NOT NULL,
 text TEXT NOT NULL,locator_json TEXT NOT NULL);
CREATE VIRTUAL TABLE search_fts USING fts5(fragment_id UNINDEXED,entry_id UNINDEXED,tokens);
CREATE TABLE review_log(entry_id TEXT NOT NULL REFERENCES entries(id),reviewer TEXT NOT NULL,
 boundary_ok INTEGER NOT NULL,conditions_ok INTEGER NOT NULL,assets_ok INTEGER NOT NULL,notes TEXT NOT NULL,
 reviewed_at TEXT NOT NULL,PRIMARY KEY(entry_id,reviewer));
"""


def build_database(specs, output, family, vocabulary):
    destination = output / (family + ".private.sqlite")
    if destination.exists():
        raise FileExistsError(
            "Refusing to replace existing candidate database: " + str(destination)
        )
    db = sqlite3.connect(destination)
    db.executescript(SCHEMA)
    db.execute("INSERT INTO metadata VALUES (?,?)", ("schema", "expert-source-prep-1"))
    db.execute(
        "INSERT INTO metadata VALUES (?,?)",
        ("activation", "offline-candidate-not-connected"),
    )
    reports = []
    for spec in specs:
        path = Path(spec["path"])
        sha = digest(path.read_bytes())
        docid = sha[:24]
        conversion = spec.get("conversion", {})
        if zipfile.is_zipfile(path):
            blocks = read_docx(path, output / "assets")
            parser = "ooxml-ordered-v1"
        else:
            if not spec.get("legacy_html") or conversion.get("source_sha256") != sha:
                raise ValueError("Legacy conversion must be bound to original SHA256")
            html_path = Path(spec["legacy_html"])
            if conversion.get("html_sha256") != digest(html_path.read_bytes()):
                raise ValueError("Legacy HTML fingerprint mismatch")
            blocks = read_legacy_html(html_path)
            parser = "wvWare-1.2.9-html"
        db.execute(
            "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)",
            (
                docid,
                path.name,
                str(path),
                sha,
                family,
                spec["category"],
                parser,
                encoded(conversion),
            ),
        )
        for block in blocks:
            bid = f"{docid}:{block['ordinal']}"
            props = {
                k: v
                for k, v in block.items()
                if k
                not in (
                    "text",
                    "raw_xml",
                    "ordinal",
                    "locator",
                    "kind",
                    "outline",
                    "assets",
                )
            }
            db.execute(
                "INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    bid,
                    docid,
                    block["ordinal"],
                    block["locator"],
                    block["kind"],
                    block["text"],
                    block["outline"],
                    encoded(props),
                    block["raw_xml"],
                ),
            )
            for asset in block["assets"]:
                if asset.get("sha256"):
                    db.execute(
                        "INSERT OR IGNORE INTO assets VALUES (?,?,?,?)",
                        (
                            asset["sha256"],
                            asset["sha256"],
                            asset["path"],
                            asset["bytes"],
                        ),
                    )
                db.execute(
                    "INSERT INTO block_assets VALUES (?,?,?,?)",
                    (bid, asset["id"], asset.get("sha256"), encoded(asset)),
                )
        entries = (
            split_tender(blocks)
            if family == "tender"
            else split_aftersales(blocks, spec)
        )
        parent_context = {
            e["title_index"]: [i for i, _, _ in e["parts"]]
            for e in entries
            if e["kind"] == "context" and e["title_index"] is not None
        }
        for sequence, entry in enumerate(entries):
            entry["context"] = list(
                dict.fromkeys(
                    i
                    for parent in entry["context"]
                    for i in parent_context.get(parent, [parent])
                )
            )
            eid = f"{docid}:e{sequence}"
            body = "\n".join(blocks[i]["text"][a:b] for i, a, b in entry["parts"])
            context = "\n".join(blocks[i]["text"] for i in entry["context"])
            if family == "aftersales" and spec.get("cloud") and entry["kind"] == "faq":
                if not re.search(
                    r"问题|禁用|失败|错误|无法|不能|不显示|怎么|如何|为什么|收不到|打不开|异常|不全|卡|故障",
                    entry["title"],
                ):
                    entry["kind"] = "information"
            entities = entities_for(context + "\n" + body, vocabulary)
            heading_entities = set(entities_for(context, vocabulary))
            heading_models = {v for k, v in heading_entities if k == "model"}
            subjects = (
                sorted(heading_models)
                if family == "tender"
                else sorted(heading_models or {v for k, v in entities if k == "model"})
            )
            state = (
                "explicit"
                if subjects
                else "category_known" if spec["category"] else "unknown"
            )
            evidence = [
                {"text": line, "interpretation": "literal-source-only"}
                for line in body.splitlines()
                if re.search(
                    r"临时|未解决|未复现|返厂|挂起|已解决|恢复正常|更换后正常|无效|仍然|试了",
                    line,
                )
            ]
            numbers = [
                {
                    "locator": blocks[i]["locator"],
                    "literal": (
                        HEAD.match(blocks[i]["text"][a:b])[0]
                        if HEAD.match(blocks[i]["text"][a:b])
                        else None
                    ),
                    "numid": blocks[i]["numid"],
                    "level": blocks[i]["num_level"],
                    "format": blocks[i]["numfmt"],
                    "template": blocks[i]["number_template"],
                }
                for i, a, b in entry["parts"]
            ]
            flags = list(
                dict.fromkeys(
                    entry["flags"]
                    + (["legacy-conversion-needs-layout-review"] if conversion else [])
                    + (["no-confirmed-model"] if not subjects else [])
                )
            )
            db.execute(
                "INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    eid,
                    eid,
                    docid,
                    entry["kind"],
                    entry["title"],
                    body,
                    context,
                    spec["category"],
                    state,
                    int("★" in body),
                    encoded(numbers),
                    "unknown",
                    encoded(evidence),
                    0,
                    "pending",
                    encoded(flags),
                    entry["rule"],
                    "expert_internal",
                ),
            )
            for role, parts in (
                ("body", entry["parts"]),
                ("context", [full_part(blocks[i]) for i in entry["context"]]),
            ):
                for n, (i, a, b) in enumerate(parts):
                    db.execute(
                        "INSERT INTO entry_blocks VALUES (?,?,?,?,?,?)",
                        (eid, f"{docid}:{i}", role, a, b, n),
                    )
            for kind, value in entities:
                basis = (
                    "subject-heading"
                    if (kind, value) in heading_entities
                    else (
                        "body-mention"
                        if family == "tender" or heading_models
                        else "literal-body-no-heading-model"
                    )
                )
                db.execute(
                    "INSERT INTO entry_entities VALUES (?,?,?,?)",
                    (eid, kind, value, basis),
                )
            # Short search fragments point back to one complete parent entry.
            # They are retrieval views, never independent cases or answers.
            fragment_parts, fragment_text, fragment_no = [], [], 0

            def flush_fragment():
                nonlocal fragment_no, fragment_parts, fragment_text
                if not fragment_parts:
                    return
                text = "\n".join(fragment_text)
                fid = f"{eid}:f{fragment_no}"
                db.execute(
                    "INSERT INTO search_fragments VALUES (?,?,?,?,?)",
                    (fid, eid, fragment_no, text, encoded(fragment_parts)),
                )
                db.execute(
                    "INSERT INTO search_fts VALUES (?,?,?)",
                    (
                        fid,
                        eid,
                        fts_tokens(entry["title"] + "\n" + context + "\n" + text),
                    ),
                )
                fragment_no += 1
                fragment_parts, fragment_text = [], []

            for i, a, b in entry["parts"]:
                piece = blocks[i]["text"][a:b]
                if sum(map(len, fragment_text)) + len(piece) > 1100:
                    flush_fragment()
                # Oversize paragraphs get offset-preserving retrieval windows.
                spans = list(range(a, b, 1000)) or [a]
                for left in spans:
                    right = min(left + 1000, b)
                    fragment_parts.append(
                        {"block": f"{docid}:{i}", "start": left, "end": right}
                    )
                    fragment_text.append(blocks[i]["text"][left:right])
                    if len(spans) > 1:
                        flush_fragment()
            flush_fragment()
        report = {
            "document": path.name,
            "source_sha256": sha,
            "parser": parser,
            "blocks": len(blocks),
            "nonempty_headings": sum(
                bool(b["text"]) and b["outline"] is not None for b in blocks
            ),
            "entries_by_kind": dict(collections.Counter(e["kind"] for e in entries)),
            "image_relationships": sum(len(b["assets"]) for b in blocks),
        }
        reports.append(report)
    db.commit()
    if (
        db.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
        or db.execute("PRAGMA foreign_key_check").fetchall()
    ):
        raise ValueError("Database integrity failure")
    db.close()
    return {
        "database": destination.name,
        "sha256": digest(destination.read_bytes()),
        "documents": reports,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    (output / "assets").mkdir()
    vocabulary = manifest.get("model_vocabulary", {})
    results = [
        build_database(
            [s for s in manifest["sources"] if s["family"] == family],
            output,
            family,
            vocabulary,
        )
        for family in ("tender", "aftersales")
    ]
    write_json(
        output / "build.private.json",
        {"activation": "not-connected", "results": results},
    )
    print(encoded({"output": str(output), "results": results}))


if __name__ == "__main__":
    main()
