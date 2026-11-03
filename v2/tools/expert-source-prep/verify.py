"""Validate candidate evidence coverage, source identity and assets, not answer accuracy."""

import argparse
import hashlib
import json
from pathlib import Path
from query import connect


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(path):
    failures = []
    with connect(path) as db:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        foreign = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or foreign:
            failures.append("database-integrity")
        for row in db.execute("SELECT * FROM documents"):
            if sha(Path(row["source_path"])) != row["sha256"]:
                failures.append("source-changed:" + row["id"])
        for row in db.execute("SELECT * FROM assets"):
            asset = path.parent / row["path"]
            if (
                not asset.is_file()
                or asset.stat().st_size != row["bytes"]
                or sha(asset) != row["sha256"]
            ):
                failures.append("asset-content:" + row["id"])
        for row in db.execute("SELECT * FROM blocks ORDER BY document_id,ordinal"):
            intervals = [
                (r[0], r[1])
                for r in db.execute(
                    "SELECT start_char,end_char FROM entry_blocks WHERE block_id=? AND role='body' ORDER BY start_char,end_char",
                    (row["id"],),
                )
            ]
            meaningful = bool(row["text"].strip()) or bool(
                db.execute(
                    "SELECT 1 FROM block_assets WHERE block_id=?", (row["id"],)
                ).fetchone()
            )
            if meaningful and not intervals:
                failures.append("unassigned-block:" + row["id"])
            if row["text"] and intervals:
                cursor = 0
                for left, right in intervals:
                    if left != cursor or right < left or right > len(row["text"]):
                        failures.append("source-span-gap-or-overlap:" + row["id"])
                    cursor = right
                if cursor != len(row["text"]):
                    failures.append("source-span-tail:" + row["id"])
        for row in db.execute("SELECT * FROM entries"):
            reconstructed = []
            for part in db.execute(
                "SELECT b.text,eb.start_char,eb.end_char FROM entry_blocks eb JOIN blocks b ON b.id=eb.block_id WHERE eb.entry_id=? AND eb.role='body' ORDER BY eb.sequence",
                (row["id"],),
            ):
                reconstructed.append(part[0][part[1] : part[2]])
            if "\n".join(reconstructed) != row["body"]:
                failures.append("body-not-literal:" + row["id"])
            if row["recommendation_verified"] or row["outcome_state"] != "unknown":
                failures.append("unverified-outcome-promoted:" + row["id"])
        missing = db.execute(
            "SELECT count(*) FROM block_assets WHERE asset_id IS NULL"
        ).fetchone()[0]
        if missing:
            failures.append("missing-asset-relationships:" + str(missing))
        kinds = dict(
            db.execute("SELECT kind,count(*) FROM entries GROUP BY kind").fetchall()
        )
        documents = []
        for doc in db.execute("SELECT id,name FROM documents"):
            documents.append(
                {
                    "name": doc["name"],
                    "kinds": dict(
                        db.execute(
                            "SELECT kind,count(*) FROM entries WHERE document_id=? GROUP BY kind",
                            (doc["id"],),
                        ).fetchall()
                    ),
                }
            )
        counts = {
            table: db.execute("SELECT count(*) FROM " + table).fetchone()[0]
            for table in (
                "documents",
                "blocks",
                "entries",
                "assets",
                "block_assets",
                "search_fragments",
            )
        }
        return {
            "database": path.name,
            "sha256": sha(path),
            "ok": not failures,
            "failures": failures,
            "counts": counts,
            "kinds": kinds,
            "documents": documents,
            "scope": "source and structural invariants; not manual boundary approval or answer accuracy",
        }


def export_review(path):
    with connect(path) as db:
        out = [
            "# " + path.stem + "：条目复核清单",
            "",
            "候选切分；结构未逐条人工批准。原文中的处理记录不等于当前客户适用建议。",
            "",
        ]
        for doc in db.execute("SELECT id,name FROM documents ORDER BY name"):
            out += ["## " + doc["name"], ""]
            for e in db.execute(
                "SELECT id,kind,title,context_text,body FROM entries WHERE document_id=? AND kind!='context' ORDER BY rowid",
                (doc["id"],),
            ):
                out += [
                    "### " + e["title"].replace("\n", " / "),
                    "",
                    "ID：" + e["id"] + "；类型：" + e["kind"],
                    "",
                    "上文：" + e["context_text"].replace("\n", " → "),
                    "",
                    e["body"],
                    "",
                ]
                assets = db.execute(
                    "SELECT DISTINCT a.path,b.locator FROM entry_blocks eb JOIN blocks b ON b.id=eb.block_id JOIN block_assets ba ON ba.block_id=b.id JOIN assets a ON a.id=ba.asset_id WHERE eb.entry_id=?",
                    (e["id"],),
                ).fetchall()
                for asset in assets:
                    out += [
                        "附件：["
                        + Path(asset["path"]).name
                        + "]("
                        + str((path.parent / asset["path"]).resolve()).replace(
                            "\\", "/"
                        )
                        + ")；位置："
                        + asset["locator"],
                        "",
                    ]
        destination = path.with_suffix(".review.md")
        destination.write_text("\n".join(out), encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory", required=True)
    args = p.parse_args()
    root = Path(args.directory)
    results = []
    for name in ("tender", "aftersales"):
        path = root / (name + ".private.sqlite")
        results.append(verify(path))
        export_review(path)
    report = {"ok": all(r["ok"] for r in results), "results": results}
    (root / "verification.private.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False))
    if not report["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
