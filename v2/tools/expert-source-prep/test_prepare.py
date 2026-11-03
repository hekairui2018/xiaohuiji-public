"""Synthetic structural invariants; no private source text."""

import importlib.util
import json
import sqlite3
import tempfile
import unittest
import zipfile
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "prepare", Path(__file__).with_name("prepare.py")
)
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)
sys.path.insert(0, str(Path(__file__).parent))
from query import connect, get_entry, search


def block(n, text, outline=None, **kw):
    return dict(
        ordinal=n,
        text=text,
        outline=outline,
        kind="paragraph",
        assets=[],
        numfmt=kw.get("numfmt"),
        numid=kw.get("numid"),
        num_level=kw.get("num_level", 0),
    )


class SplittingTests(unittest.TestCase):
    def test_inline_sequential_but_not_specification_numbers(self):
        text = "★1、支持USB 3.0；2、支持H.265；3、提供报告"
        spans = prep.inline_parts(text)
        self.assertEqual(len(spans), 3)
        self.assertEqual("".join(text[a:b] for a, b in spans), text)
        specification = "1、提供2路USB 3.0，H.265解码"
        self.assertEqual(prep.inline_parts(specification), [(0, len(specification))])

    def test_product_boundaries_and_continuations(self):
        bs = [
            block(0, "HD-X1控标点", 0),
            block(1, "1、支持输出"),
            block(2, "检测要求：提供报告"),
            block(3, "HD-Y2控标点", 0),
            block(4, "支持输入", numfmt="decimal", numid="2"),
        ]
        es = prep.split_tender(bs)
        clauses = [e for e in es if e["kind"] == "tender_clause"]
        self.assertEqual(len(clauses), 2)
        self.assertEqual([p[0] for p in clauses[0]["parts"]], [1, 2])
        self.assertEqual(clauses[1]["context"], [3])

    def test_empty_outline_and_picture_do_not_split(self):
        bs = [
            block(0, "章节", 0),
            block(1, "问题", 2),
            block(2, "", 2),
            block(3, "处理正文"),
        ]
        bs[2]["assets"] = [{"id": "image"}]
        es = prep.split_aftersales(bs, {"entry_levels": [2]})
        case = next(e for e in es if e["kind"] == "case_or_reference")
        self.assertEqual([p[0] for p in case["parts"]], [1, 2, 3])

    def test_solution_steps_stay_with_case(self):
        bs = [
            block(0, "型号", 1),
            block(1, "问题现象：画面异常"),
            block(2, "解决方法：核查条件"),
            block(3, "1、先检查连接"),
            block(4, "2、再读取参数"),
            block(5, "问题现象：声音异常"),
            block(6, "解决方法：核查音源"),
        ]
        es = prep.split_aftersales(bs, {"entry_levels": [1], "bare_cases": True})
        cases = [e for e in es if e["kind"] == "case_or_reference"]
        self.assertEqual(len(cases), 2)
        self.assertEqual([p[0] for p in cases[0]["parts"]], [1, 2, 3, 4])

    def test_higher_level_closes_previous_entry(self):
        bs = [
            block(0, "章节甲", 0),
            block(1, "问题甲", 2),
            block(2, "答案甲"),
            block(3, "章节乙", 0),
            block(4, "本章限制"),
            block(5, "问题乙", 2),
            block(6, "答案乙"),
        ]
        es = prep.split_aftersales(bs, {"entry_levels": [2]})
        case = next(e for e in es if e["title"] == "问题甲")
        self.assertEqual([p[0] for p in case["parts"]], [1, 2])

    def test_model_boundaries_do_not_truncate_unknown_suffix(self):
        v = {"X1": "HD-X1"}
        es = prep.entities_for("X1PRO HD-X1-NEW", v)
        self.assertNotIn(("model", "HD-X1"), es)
        self.assertIn(("model", "HD-X1-NEW"), es)

    def test_shopping_link_is_not_a_new_fault(self):
        bs = [
            block(0, "U盘问题", 2),
            block(1, "问题现象：U盘不识别"),
            block(2, "解决方法：核查设备版本，推荐如下U盘"),
            block(3, "闪迪U盘，车载商务学习使用，品牌规格信息"),
            block(4, "A3L播放黑屏"),
            block(5, "解决方法：核对条件"),
        ]
        bs[3]["links"] = [{"target": "https://example.invalid"}]
        es = prep.split_aftersales(bs, {"entry_levels": [2], "bare_cases": True})
        cases = [e for e in es if e["kind"] == "case_or_reference"]
        self.assertEqual(len(cases), 2)
        self.assertIn(3, [p[0] for p in cases[0]["parts"]])

    def test_new_subject_between_two_solutions_is_not_merged(self):
        bs = [
            block(0, "HD-X1", 1),
            block(1, "X1画面异常"),
            block(2, "解决方法：核对显示条件"),
            block(3, "X1接音响音量很小，换了设备也一样"),
            block(4, "解决方法：核对音响输入条件"),
        ]
        es = prep.split_aftersales(bs, {"entry_levels": [1], "bare_cases": True})
        cases = [e for e in es if e["kind"] == "case_or_reference"]
        self.assertEqual(len(cases), 2)
        self.assertEqual([p[0] for p in cases[1]["parts"]], [3, 4])

    def test_unstyled_topic_title_stays_with_following_content(self):
        bs = [
            block(0, "HD-X1", 1),
            block(1, "问题现象：画面异常"),
            block(2, "解决方法：核对显示条件"),
            block(3, "模板保存的参数问题"),
            block(4, "X1：亮度和音量的保存条件需要按版本核对"),
        ]
        es = prep.split_aftersales(bs, {"entry_levels": [1], "bare_cases": True})
        cases = [e for e in es if e["kind"] == "case_or_reference"]
        self.assertEqual(len(cases), 2)
        self.assertEqual(cases[1]["title"], "模板保存的参数问题")
        self.assertEqual([p[0] for p in cases[1]["parts"]], [3, 4])

    def test_ooxml_inheritance_auto_number_media_and_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            asset = root / "assets"
            asset.mkdir()
            document = """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>
            <w:p><w:pPr><w:pStyle w:val="child"/></w:pPr><w:r><w:t>HD-X1控标点</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="8"/></w:numPr></w:pPr><w:r><w:t>支持输出</w:t></w:r><w:r><w:drawing><a:blip r:embed="image1"/></w:drawing></w:r></w:p>
            <w:tbl><w:tr><w:tc><w:p><w:r><w:t>限制条件</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
            </w:body></w:document>"""
            styles = """<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="parent"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:styleId="child"><w:basedOn w:val="parent"/></w:style></w:styles>"""
            numbering = """<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1、"/></w:lvl></w:abstractNum><w:num w:numId="8"><w:abstractNumId w:val="7"/></w:num></w:numbering>"""
            path = root / "test.docx"
            with zipfile.ZipFile(path, "w") as z:
                z.writestr("word/document.xml", document)
                z.writestr("word/styles.xml", styles)
                z.writestr("word/numbering.xml", numbering)
                z.writestr(
                    "word/_rels/document.xml.rels",
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="image" Target="media/test.png"/></Relationships>',
                )
                z.writestr("word/media/test.png", b"synthetic-image")
            bs = prep.read_docx(path, asset)
            self.assertEqual(
                [b["kind"] for b in bs], ["paragraph", "paragraph", "table"]
            )
            self.assertEqual(bs[0]["outline"], 0)
            self.assertEqual(bs[1]["numfmt"], "decimal")
            self.assertEqual(bs[2]["cells"][0]["text"], "限制条件")
            self.assertEqual(len(bs[1]["assets"]), 1)
            result = prep.build_database(
                [{"path": str(path), "category": "synthetic"}], root, "tender", {}
            )
            db = sqlite3.connect(root / result["database"])
            self.assertEqual(
                db.execute(
                    "SELECT count(*) FROM entries WHERE kind='tender_clause'"
                ).fetchone()[0],
                1,
            )
            self.assertEqual(
                db.execute(
                    "SELECT count(*) FROM entries WHERE recommendation_verified!=0"
                ).fetchone()[0],
                0,
            )
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            db.close()
            with connect(root / result["database"]) as readonly:
                results = search(readonly, "输出限制", model="HD-X1")
                self.assertTrue(results)
                self.assertIn("限制条件", results[0]["body"])
                self.assertEqual(len(results[0]["assets"]), 1)
                self.assertEqual(results[0]["outcome_state"], "unknown")
                self.assertEqual(results[0]["review_state"], "pending")
                with self.assertRaises(sqlite3.OperationalError):
                    readonly.execute("DELETE FROM entries")


if __name__ == "__main__":
    unittest.main()
