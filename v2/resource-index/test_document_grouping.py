"""Pure browse grouping regression; no G drive, model, or index access."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parent))
from engine import group_document_hits

class FileGroupingTests(unittest.TestCase):
    def test_one_record_per_original_with_useful_excerpt(self):
        hits=[
          {'kind':'file','sha256':'a'*64,'name':'1065手册.pdf','score':50,'text':None},
          {'kind':'passage','sha256':'a'*64,'score':30,'blockId':1,'locator':{'page':2},'text':'刷新参数'},
          {'kind':'passage','sha256':'a'*64,'score':25,'blockId':2,'locator':{'page':3},'text':'更多内容'},
          {'kind':'passage','sha256':'b'*64,'score':20,'blockId':3,'locator':{'page':1},'text':'独立文件'},
        ]
        out=group_document_hits(hits)
        self.assertEqual(len(out),2)
        self.assertEqual(out[0]['name'],'1065手册.pdf')
        self.assertEqual(out[0]['text'],'刷新参数')
        self.assertEqual(out[0]['blockId'],1)
        self.assertEqual(out[0]['candidatePassages'],2)
        self.assertTrue(out[0]['matchedFileName'])
        self.assertEqual(out[1]['text'],'独立文件')
        self.assertEqual(hits[0]['text'],None)
        self.assertNotIn('candidatePassages',hits[0])

    def test_positions_remain_independent_and_explicitly_capped(self):
        hits=[{'kind':'passage','sha256':'a'*64,'blockId':i+1,'locator':{'page':i+1},'text':'case '+str(i)} for i in range(30)]
        record=group_document_hits(hits)[0]
        self.assertEqual(record['candidatePassages'],30)
        self.assertEqual(len(record['matchedLocations']),24)
        self.assertTrue(record['locationsTruncated'])
        self.assertEqual(record['matchedLocations'][1]['locator'],{'page':2})
        self.assertEqual(record['text'],'case 0')

    def test_different_content_and_versions_are_not_merged_by_name(self):
        hits=[{'kind':'file','name':'同名.docx','sha256':'a'*64,'score':10},
              {'kind':'file','name':'同名.docx','sha256':'b'*64,'score':9}]
        self.assertEqual(len(group_document_hits(hits)),2)

if __name__=='__main__':
    unittest.main()
