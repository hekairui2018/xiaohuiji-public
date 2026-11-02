"""Read-only, source-bound SQL lookup for quick answers. No case corpus or model."""

import json, math, re, sqlite3
from pathlib import Path
from section_search import tokens, modelkey, compact
from quick_source_policy import excludes_software_scope


class QuickKnowledge:
    def __init__(self, file):
        self.file = Path(file).resolve()
        db = self.connect()
        try:
            self.models = sorted(
                {modelkey(m) for r in db.execute("SELECT models FROM records") for m in json.loads(r[0])},
                key=len,
                reverse=True,
            )
        finally:
            db.close()

    def connect(self):
        db = sqlite3.connect(self.file.as_uri() + "?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        return db

    def lookup(self, query, kind, requested_models=None, focus=None, software=None, unknown=None):
        if (
            kind not in ("parameter", "faq", "empty-points")
            or not isinstance(query, str)
            or not query.strip()
            or len(query) > 240
        ):
            raise ValueError("invalid-quick-query")
        mentions = [
            m
            for m in self.models
            if re.search(r"(?<![A-Z0-9])(?:HD[-_ ]?)?" + re.escape(m) + r"(?![A-Z0-9+_-])", query.upper())
        ]
        requested = [modelkey(m) for m in (requested_models or mentions)]
        qterms = set(tokens(" ".join(focus or [query])))
        # Product identifiers locate a row, rather than establish relevance to an arbitrary attribute.
        qterms -= set(tokens(" ".join(requested)))
        qterms -= set(
            tokens("这个 那个 请问 请帮我 帮忙 怎么 如何 怎样 是不是 能不能 多少 哪个 哪些 支持 参数 查询")
        )
        qterms = {t for t in qterms if len(t) > 1}
        if not qterms:
            return {"results": [], "retrievalBackend": "quick-knowledge-sql"}
        db = self.connect()
        try:
            expression = " OR ".join('"' + t.replace('"', '""') + '"' for t in sorted(qterms))
            rows = db.execute(
                """SELECT r.*,s.name source,s.sha256 FROM records r JOIN sources s ON s.id=r.source_id
              WHERE r.kind=? AND r.id IN (SELECT record_search.rowid FROM record_search JOIN records rr ON rr.id=record_search.rowid
                WHERE record_search MATCH ? AND rr.kind=? ORDER BY bm25(record_search,4,1,1,2) LIMIT 300)""",
                (kind, expression, kind),
            ).fetchall()
            ranked = []
            for row in rows:
                r = dict(row)
                if kind == "faq" and r["status"] != "ready":
                    continue
                identity_text = (
                    " ".join(json.loads(r["models"]))
                    + " "
                    + r["parameter"]
                    + " "
                    + r["conditions"]
                    + " "
                    + r["question"]
                )
                if unknown and not all(modelkey(m) in modelkey(identity_text) for m in unknown):
                    continue
                if kind == "faq" and "LCD" not in query.upper():
                    if excludes_software_scope(software or [], r["source"]):
                        continue
                scoped = [modelkey(m) for m in json.loads(r["models"])]
                if requested and scoped and not any(m in scoped for m in requested):
                    continue
                if kind == "parameter" and not scoped:
                    # Firmware capability columns require their complete example version;
                    # they cannot become unconditional facts for every receiver card.
                    if "固件示例：" in r["conditions"]:
                        version = r["conditions"].split("固件示例：", 1)[1].split("；", 1)[0]
                        if version.lstrip("Vv").lower() not in query.lower():
                            continue
                    elif "4G模块地区选型" == r["sheet"] and not any(
                        t in (r["parameter"] + " " + r["value"]).lower() for t in qterms
                    ):
                        continue
                label = set(tokens(r["parameter"] + " " + r["keywords"]))
                body = set(tokens(r["value"] + " " + r["conditions"]))
                label_hits = qterms & label
                all_hits = qterms & (label | body)
                if not all_hits:
                    continue
                if kind == "parameter" and not label_hits and "4G模块地区选型" != r["sheet"]:
                    continue
                if kind == "parameter" and any(
                    angle not in r["parameter"] for angle in re.findall(r"\d+\s*度", query)
                ):
                    continue
                coverage = len(all_hits) / len(qterms)
                # FAQ selection needs strong question/keyword agreement, not a coincidental word in an answer.
                if kind == "faq" and (
                    len(label_hits) < min(2, len(qterms)) or len(label_hits) / len(qterms) < 0.42
                ):
                    continue
                # Asking how to do something and reporting a fault share words but not
                # answers. Never answer a procedure question with a troubleshooting row.
                if (
                    kind == "faq"
                    and re.search(r"怎么|如何|怎样|步骤|方法|教程", query)
                    and re.search(
                        r"不满|不全|找不到|黑屏|花屏|异常|失败|报错|不亮|闪烁|无信号|无法|不显示|不能|丢失|没有了",
                        r["question"],
                    )
                ):
                    continue
                # An explicit interface qualifier narrows the row, it does not score it:
                # "4G" must appear in the row, otherwise 接收 matches 红外接收头.
                qualifiers = [
                    t
                    for t in ("4G", "5G", "Wi-Fi", "WiFi", "HDMI", "DP", "USB", "SD")
                    if t.lower() in query.lower()
                ]
                if kind == "parameter" and any(
                    t.lower() not in (r["parameter"] + " " + r["conditions"]).lower() for t in qualifiers
                ):
                    continue
                if kind == "empty-points":
                    pitch = re.search(r"(?i)P?\s*(1\.86|3\.076)", query)
                    scan = re.search(r"(?i)(\d+)\s*(?:S|扫)", query)
                    if pitch and pitch[1] not in r["parameter"]:
                        continue
                    if scan and not re.search(r"(?i)(?<!\d)" + scan[1] + r"S", r["parameter"]):
                        continue
                score = (
                    len(label_hits) * 4
                    + len(all_hits - label_hits)
                    + coverage
                    + (2 if requested and scoped else 0)
                )
                r.update(score=score, coverage=coverage, models=json.loads(r["models"]))
                ranked.append(r)
            ranked.sort(key=lambda r: r["score"], reverse=True)
            if kind == "parameter" and ranked:
                best = ranked[0]["score"]
                ranked = [r for r in ranked if r["score"] >= best * 0.7]
            selected = ranked[: 12 if kind == "faq" else 50 if kind == "empty-points" else 12]
            results = []
            for r in selected:
                unknown = r["status"] != "ready" or r["value"].strip() in ("", "/", "未注明")
                results.append(
                    dict(
                        evidenceId="quick-sql-" + str(r["id"]),
                        sourceKind="faq-original" if kind == "faq" else "parameter-original",
                        name=r["source"],
                        sha256=r["sha256"],
                        models=r["models"],
                        parameter=r["parameter"],
                        value=r["value"],
                        text=(r["question"] + "\n" if kind == "faq" else r["parameter"] + "：") + r["value"],
                        conditions=r["conditions"],
                        locator={"sheet": r["sheet"], "cell": r["cell"]},
                        status=r["status"],
                        unknown=unknown,
                        coverage=r["coverage"],
                        score=r["score"],
                        sourceCellId=r["id"],
                        exactQuestion=kind == "faq" and compact(query) == compact(r["question"]),
                    )
                )
            return {"results": results, "retrievalBackend": "quick-knowledge-sql", "kind": kind}
        finally:
            db.close()
