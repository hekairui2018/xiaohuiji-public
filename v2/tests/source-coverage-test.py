"""Source-audit guards; uses only isolated local temporary fixtures."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('source_audit', Path(__file__).parents[1] / 'tools/audit-source-coverage.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class SourceAuditTests(unittest.TestCase):
    def test_filename_does_not_establish_authorship(self):
        result = audit.classify('普通文字', '官方原版.pdf')
        self.assertEqual(result['category'], '来源不明或证据不足')
        self.assertFalse(result['authorshipVerified'])

    def test_secondary_content_cannot_be_promoted_by_quoted_brand(self):
        result = audit.classify('资料总览 冻结扫描文件 深圳市灰度科技 产品规格书', '知识库.md')
        self.assertTrue(result['category'].startswith('二次整理'))
        self.assertTrue(audit.classify('深圳市灰度科技 产品规格书 由AI整理', 'x.pdf')['category'].startswith('AI'))
        self.assertFalse(audit.classify('工程方案中可选接入本地Qwen及DeepSeek', '技术交流.pptx')['category'].startswith('AI'))
        self.assertFalse(audit.classify('效果图和工程图纸 AI 生成，提升方案设计效率', '技术交流.pptx')['category'].startswith('AI'))
        ppt = audit.classify('技术培训 现场排查 工程方案 产品参数 宣传', 'x.pptx')['presentation']
        self.assertEqual(ppt['reviewPriority'], '优先核查')
        self.assertEqual(len(ppt['sourceTypes']), 4)
        self.assertEqual(ppt['valueJudgment'], '第一轮未判定价值')

    def test_read_only_text_encoding_and_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'x.txt'
            p.write_bytes('型号及版本 V1.0'.encode('gb18030'))
            before = audit.digest(p)
            text, metadata = audit.extract(p)
            self.assertEqual(text, '型号及版本 V1.0')
            self.assertEqual(metadata['encoding'], 'gb18030')
            self.assertEqual(before, audit.digest(p))

    def test_docx_body_header_table_extracted_with_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'source.docx'
            with zipfile.ZipFile(p, 'w') as z:
                z.writestr('word/document.xml', '<w:document xmlns:w="word"><w:p><w:t>现场反馈</w:t></w:p><w:tbl><w:t>未解决</w:t></w:tbl></w:document>')
                z.writestr('word/header1.xml', '<w:hdr xmlns:w="word"><w:t>版本V1.0</w:t></w:hdr>')
            before = audit.digest(p)
            text, metadata = audit.extract(p)
            self.assertIn('现场反馈', text)
            self.assertIn('未解决', text)
            self.assertIn('版本V1.0', text)
            self.assertIn('not-verified', metadata['limitations'])
            self.assertEqual(before, audit.digest(p))


if __name__ == '__main__':
    unittest.main()
