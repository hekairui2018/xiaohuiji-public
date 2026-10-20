import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import engine
from knowledge_units import UnitReader, metadata_unit, source_span


class KnowledgeUnitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=engine.PROJECT / 'tmp')
        root = Path(self.tmp.name) / 'originals'
        root.mkdir()
        (root / 'FAQ.csv').write_text('问题,答案\nC16L闪烁,检查排线\nR712黑屏,检查电源', encoding='utf8')
        (root / '操作.txt').write_text('前提：选中设备\n步骤1：连接\n步骤2：发送\n另一主题：复位', encoding='utf8')
        self.work = Path(self.tmp.name) / 'index'
        engine.scan(root, self.work)
        engine.index_documents(self.work)
        db = engine.connect(self.work, True)
        self.rows = {r['text']: dict(r) for r in db.execute('SELECT * FROM blocks')}
        db.close()

    def tearDown(self):
        self.tmp.cleanup()

    def reader(self, texts, kind='task', roles=None, complete=True):
        blocks = [self.rows[t] for t in texts]
        sha = blocks[0]['hash']
        unit = {'kind': kind, 'uses': ['operations', 'diagnosis'],
                'basis': 'synthetic-reviewed-boundary', 'complete': complete,
                'spans': [source_span(b, role=(roles or ['body'] * len(blocks))[i])
                          for i, b in enumerate(blocks)]}
        return UnitReader({sha: [unit]}, {sha}), blocks, unit

    def test_task_restores_prerequisite_and_all_steps_without_neighbor(self):
        reader, blocks, _ = self.reader(['前提：选中设备', '步骤1：连接', '步骤2：发送'])
        result = reader.read(self.work, blocks[1]['id'])
        self.assertEqual([b['text'] for b in result['blocks']], ['前提：选中设备', '步骤1：连接', '步骤2：发送'])
        self.assertTrue(result['knowledgeUnit']['complete'])
        self.assertEqual(result['knowledgeUnit']['uses'], ['operations', 'diagnosis'])
        self.assertFalse(result['knowledgeUnit']['compatibilityConfirmed'])

    def test_qa_preserves_header_and_one_record_and_original_locators(self):
        reader, blocks, _ = self.reader(['问题 | 答案', 'C16L闪烁 | 检查排线'], 'faq', ['header', 'body'])
        result = reader.read(self.work, blocks[1]['id'])
        self.assertEqual([b['locator']['row'] for b in result['blocks']], [1, 2])
        self.assertNotIn('R712', '\n'.join(b['text'] for b in result['blocks']))
        self.assertEqual(result['knowledgeUnit']['documentId'], blocks[0]['hash'])

    def test_cross_rows_rejected(self):
        reader, blocks, _ = self.reader(['C16L闪烁 | 检查排线', 'R712黑屏 | 检查电源'], 'faq')
        with self.assertRaisesRegex(ValueError, 'cross-record'):
            reader.read(self.work, blocks[0]['id'])

    def test_cross_original_rejected(self):
        reader, blocks, _ = self.reader(['前提：选中设备', 'C16L闪烁 | 检查排线'])
        with self.assertRaisesRegex(ValueError, 'cross-original'):
            reader.read(self.work, blocks[0]['id'])

    def test_profiles_do_not_grant_authorization(self):
        reader, blocks, _ = self.reader(['前提：选中设备'])
        denied = UnitReader(reader.profiles, set())
        self.assertEqual(denied.search(self.work, '设备', concepts=['设备'])['results'], [])
        with self.assertRaises(PermissionError):
            denied.read(self.work, blocks[0]['id'])

    def test_document_filter_cannot_expand_authorized_scope(self):
        reader, _, _ = self.reader(['前提：选中设备'])
        self.assertEqual(reader.search(self.work, '闪烁', concepts=['闪烁'], documents=['FAQ.csv'])['results'], [])

    def test_stale_source_rejected(self):
        reader, blocks, unit = self.reader(['前提：选中设备'])
        unit['spans'][0]['textHash'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'stale'):
            reader.read(self.work, blocks[0]['id'])

    def test_unknown_boundary_does_not_borrow_neighbors(self):
        reader, blocks, _ = self.reader(['前提：选中设备'])
        other = self.rows['步骤1：连接']
        result = reader.read(self.work, other['id'])
        self.assertFalse(result['knowledgeUnit']['complete'])
        self.assertEqual([b['text'] for b in result['blocks']], ['步骤1：连接'])

    def test_original_offsets_and_id_stable_across_read(self):
        reader, blocks, unit = self.reader(['步骤1：连接'])
        unit['spans'][0]['start'] = 4
        a = reader.read(self.work, blocks[0]['id'], anchor=4)
        b = reader.read(self.work, blocks[0]['id'], anchor=5)
        self.assertEqual(a['knowledgeUnit']['id'], b['knowledgeUnit']['id'])
        self.assertEqual(a['blocks'][0]['charStart'], 4)
        self.assertEqual(a['blocks'][0]['text'], blocks[0]['text'][4:])

    def test_binary_metadata_does_not_claim_parsed_body(self):
        result = metadata_unit({'name': 'R712.bin', 'sha256': 'a', 'folders': ['firmware']})
        self.assertFalse(result['bodyParsed'])
        self.assertFalse(result['complete'])
        self.assertFalse(result['compatibilityConfirmed'])

    def test_reviewed_pdf_range_is_not_reintroduced_by_fragment_fallback(self):
        reader, blocks, unit = self.reader(['步骤1：连接'])
        unit['spans'][0]['start'] = 4
        result = reader.read(self.work, blocks[0]['id'], anchor=0)
        self.assertEqual(result['blocks'][0]['text'], '步骤1：')
        self.assertFalse(result['knowledgeUnit']['complete'])

    def test_search_read_share_unit_identity_and_scope(self):
        reader, _, _ = self.reader(['前提：选中设备', '步骤1：连接', '步骤2：发送'])
        found = reader.search(self.work, '连接 发送', concepts=['连接', '发送'])['results']
        self.assertEqual(len(found), 1)
        row = found[0]
        result = reader.read(self.work, row['blockId'], row['readAnchor'])
        self.assertEqual(row['knowledgeUnit']['id'], result['knowledgeUnit']['id'])

    def test_cross_sheet_headers_are_rejected(self):
        reader, blocks, _ = self.reader(['问题 | 答案', 'C16L闪烁 | 检查排线'], 'faq', ['header', 'body'])
        db = engine.connect(self.work)
        loc = json.loads(blocks[0]['locator'])
        loc['sheet'] = 'another-sheet'
        db.execute('UPDATE blocks SET locator=? WHERE id=?', (json.dumps(loc), blocks[0]['id']))
        db.commit()
        db.close()
        with self.assertRaisesRegex(ValueError, 'cross-record'):
            reader.read(self.work, blocks[1]['id'])


if __name__ == '__main__':
    unittest.main()
