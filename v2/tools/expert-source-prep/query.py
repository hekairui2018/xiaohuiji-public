"""Local read-only candidate search. HTTP authorization must be added by the host."""

import argparse
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from prepare import fts_tokens


@contextmanager
def connect(path):
    db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    try:
        yield db
    finally:
        db.close()


def get_entry(db, entry_id):
    row = db.execute(
        "SELECT e.*,d.name source_name,d.source_path,d.sha256 source_sha256,d.parser FROM entries e JOIN documents d ON d.id=e.document_id WHERE e.id=?",
        (entry_id,),
    ).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["entities"] = [
        dict(r)
        for r in db.execute(
            "SELECT kind,value,basis FROM entry_entities WHERE entry_id=?", (entry_id,)
        )
    ]
    result["evidence"] = [
        dict(r)
        for r in db.execute(
            "SELECT eb.role,eb.start_char,eb.end_char,eb.sequence,b.locator,b.text,b.properties_json FROM entry_blocks eb JOIN blocks b ON b.id=eb.block_id WHERE eb.entry_id=? ORDER BY eb.role,eb.sequence",
            (entry_id,),
        )
    ]
    result["assets"] = [
        dict(r)
        for r in db.execute(
            "SELECT DISTINCT a.path,a.sha256,ba.metadata_json,b.locator FROM entry_blocks eb JOIN blocks b ON b.id=eb.block_id JOIN block_assets ba ON ba.block_id=b.id LEFT JOIN assets a ON a.id=ba.asset_id WHERE eb.entry_id=?",
            (entry_id,),
        )
    ]
    result["use_policy"] = (
        "Original internal source evidence; not a verified remedy or current-site diagnosis. Preserve conditions, images, historical actions and uncertainty."
    )
    return result


def search(db, query, limit=3, model=None, category=None):
    tokens = list(dict.fromkeys(fts_tokens(query).split()))
    if not tokens:
        return []
    expression = " OR ".join('"' + t.replace('"', '""') + '"' for t in tokens[:80])
    conditions = [
        "search_fts MATCH ?",
        "(e.kind!='context' OR (e.rule IN ('parent-section-context','unattached-product-context') AND length(trim(e.body))>length(trim(e.title))))",
    ]
    params = [expression]
    if model:
        # Unknown/category-only entries remain possible evidence, explicitly labelled.
        conditions.append(
            "(EXISTS(SELECT 1 FROM entry_entities ee WHERE ee.entry_id=e.id AND ee.kind='model' AND ee.value=? AND ee.basis IN ('subject-heading','literal-body-no-heading-model')) OR e.subject_state!='explicit')"
        )
        params.append(model.upper())
    if category:
        conditions.append("e.category=?")
        params.append(category)
    rows = db.execute(
        "SELECT e.id,e.entry_group,bm25(search_fts) score FROM search_fts JOIN entries e ON e.id=search_fts.entry_id WHERE "
        + " AND ".join(conditions)
        + " ORDER BY score",
        params,
    )
    found, results = set(), []
    for row in rows:
        if row["entry_group"] in found:
            continue
        found.add(row["entry_group"])
        entry = get_entry(db, row["id"])
        entry["retrieval_score"] = row["score"]
        entry["requested_model_confirmed_in_source"] = bool(
            model
            and any(
                e["kind"] == "model"
                and e["value"] == model.upper()
                and e["basis"] in ("subject-heading", "literal-body-no-heading-model")
                for e in entry["entities"]
            )
        )
        entry["category_only_fallback"] = bool(
            model and not entry["requested_model_confirmed_in_source"]
        )
        results.append(entry)
        if len(results) >= max(1, min(limit, 30)):
            break
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", required=True)
    p.add_argument("--query")
    p.add_argument("--entry")
    p.add_argument("--model")
    p.add_argument("--category")
    p.add_argument("--limit", type=int, default=3)
    p.add_argument("--output")
    args = p.parse_args()
    with connect(args.db) as db:
        result = (
            get_entry(db, args.entry)
            if args.entry
            else search(db, args.query or "", args.limit, args.model, args.category)
        )
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        destination = Path(args.output)
        with destination.open("x", encoding="utf-8") as f:
            f.write(text)
    else:
        print(text)


if __name__ == "__main__":
    main()
