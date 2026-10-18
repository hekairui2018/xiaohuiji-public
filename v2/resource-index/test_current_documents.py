import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import engine
import proximity
from current_documents import historical_locations


class CurrentDocumentTests(unittest.TestCase):
    def setUp(self):
        (engine.PROJECT/'tmp').mkdir(parents=True,exist_ok=True)
        models=patch('engine.known_product_models',return_value={'A3L','A3','A4L'})
        models.start();self.addCleanup(models.stop)

    def test_families_preserve_suffix_hardware_language_and_unknown_versions(self):
        names = ['A3L规格书 V1.0.pdf', 'A3L规格书 V1.1.pdf', 'A3规格书 V9.0.pdf',
                 'A3L规格书 HW2 V1.0.pdf', 'A3L Specification V1.0.pdf',
                 'A3L规格书.pdf', 'A3L固件 V1.0.bin', 'A3L固件 V2.0.bin']
        rows = [dict(name=n, locationId=i, availabilityState='present') for i, n in enumerate(names)]
        self.assertEqual(historical_locations(rows), {0})
        rows[1]['availabilityState'] = 'missing'
        self.assertEqual(historical_locations(rows), set())

    def test_cover_conflict_and_equal_numeric_versions_do_not_supersede(self):
        rows = [dict(name='A3L规格书 V1.1.pdf',locationId=1,availabilityState='present'),
                dict(name='A3L规格书 V1.1.0.docx',locationId=2,availabilityState='present'),
                dict(name='A3L规格书 V2.0.pdf',locationId=3,availabilityState='present',documentMetadata={'version':'V1.0'})]
        self.assertEqual(historical_locations(rows), set())

    def test_publication_date_does_not_split_an_explicit_technical_document_family(self):
        rows=[dict(name=n,locationId=i,availabilityState='present') for i,n in enumerate([
            'LED播放器控标点V2.3.docx','LED播放器控标点20260730V2.7.docx',
            'LED播放器控标点 HW2 V2.3.docx','LED播放器控标点V2.7已签章.docx'])]
        self.assertEqual(historical_locations(rows), {0})

    def test_fts_prefilters_old_edition_and_explicit_history_remains_readable(self):
        with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as folder:
            root=Path(folder)/'originals';root.mkdir();work=Path(folder)/'index'
            for name,text in {'A3L规格书 V1.0.txt':'A3L 最大高度3840 模组闪烁 模组闪烁 模组闪烁',
                              'A3L规格书 V1.1.txt':'A3L 最大高度4096 模组闪烁'}.items():
                (root/name).write_text(text,encoding='utf8')
            engine.scan(root,work);engine.index_documents(work)
            rows=engine.query(work,'A3L 最大高度','text',limit=1)['results']
            self.assertEqual(len(rows),1);self.assertIn('V1.1',rows[0]['name']);self.assertIn('4096',rows[0]['text'])
            old=engine.query(work,'A3L 最大高度','text',version='V1.0')['results']
            self.assertTrue(old);self.assertTrue(all('V1.0' in r['name'] for r in old))
            near=proximity.search(work,'A3L 模组闪烁',concepts=['模组','闪烁'],models=['A3L'])['results']
            self.assertTrue(near);self.assertTrue(all('V1.1' in r['name'] for r in near))
            historical=proximity.search(work,'A3L 模组闪烁',concepts=['模组','闪烁'],models=['A3L'],documents=['A3L规格书 V1.0.txt'])['results']
            self.assertTrue(historical);self.assertTrue(all('V1.0' in r['name'] for r in historical))


if __name__ == '__main__':
    unittest.main()
