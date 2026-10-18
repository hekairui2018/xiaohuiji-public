import json
from pathlib import Path
import tempfile
import unittest
import engine
import proximity


class ProximityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp')
        self.root=Path(self.tmp.name)/'originals';self.root.mkdir()
        self.work=Path(self.tmp.name)/'index'

    def tearDown(self):
        self.tmp.cleanup()

    def seed(self,files):
        for name,text in files.items():(self.root/name).write_text(text,encoding='utf8')
        engine.scan(self.root,self.work);engine.index_documents(self.work)

    def test_concepts_cannot_cooccur_across_numbered_cases(self):
        self.seed({'售后案例.txt':'3.37 C16L 颜色异常\n处理结果：更换参数\n3.38 C16L 闪烁\n处理结果：更换排线'})
        result=proximity.search(self.work,'C16L 颜色异常 闪烁','cases',['颜色异常','闪烁'],['C16L'])
        self.assertEqual(result['results'],[])

    def test_same_case_neighbors_result_and_authorized_pagination(self):
        self.seed({'售后案例.txt':'案例1 C16L\n故障现象：C16L 模组闪烁\n排查：'+('已核对接线。'*1100)+'\n处理结果：换线后恢复\n案例2 R512S\n处理结果：不可混入'})
        result=proximity.search(self.work,'模组 闪屏','cases',['模组','闪屏'],['C16L'])
        self.assertTrue(result['results'])
        row=result['results'][0];offset=0;all_text=''
        while True:
            page=proximity.read(self.work,row['blockId'],row['readAnchor'],offset)
            all_text+='\n'.join(b['text'] for b in page['blocks'])
            if page['nextOffset'] is None:break
            offset=page['nextOffset']
        self.assertIn('换线后恢复',all_text);self.assertNotIn('不可混入',all_text)
        self.assertIn('blockId',row['proximity']['hits'][0])

    def test_exact_suffix_and_version_constraints(self):
        self.seed({'R512S案例.txt':'故障现象：R512S 闪烁 模组\n处理结果：升级25.1.2',
                   'R512案例.txt':'故障现象：R512 闪烁 模组\n处理结果：升级25.2.3'})
        r=proximity.search(self.work,'模组 闪烁','cases',['模组','闪烁'],['R512'],version='25.2.3')
        self.assertTrue(r['results']);self.assertTrue(all('R512S' not in h['text'] for h in r['results']))
        self.assertEqual(proximity.search(self.work,'模组 闪烁','cases',['模组','闪烁'],['R512'],version='25.1.2')['results'],[])

    def test_csv_rows_remain_separate_and_bad_constraints_rejected(self):
        self.seed({'常见问题FAQ.csv':'问题,答案\n模组异常,颜色异常\n闪烁,更换排线'})
        self.assertEqual(proximity.search(self.work,'颜色异常 闪烁','faq',['颜色异常','闪烁'])['results'],[])
        with self.assertRaises(ValueError):proximity.search(self.work,'x',concepts=['x'*33])
        with self.assertRaises(ValueError):proximity.read(self.work,1,offset=-1)

    def test_compound_model_terms_use_controlled_lexical_aliases_not_exact_long_phrases(self):
        self.seed({'C16L售后案例.txt':'案例1 C16L\n故障现象：模组颜色不正常，还在闪屏\n处理结果：重新检查排线'})
        r=proximity.search(self.work,'右侧多排颜色异常 模组更换 闪烁','cases',['右侧多排颜色异常','模组更换','闪烁'],['C16L'])
        self.assertTrue(r['results']);self.assertEqual(r['results'][0]['proximity']['matchedConcepts'],3)

    def test_model_in_case_heading_is_not_lost_when_phenomenon_has_no_model(self):
        self.seed({'售后案例合集.txt':'案例1 R512\n故障现象：节目正常\n案例2 R512S\n故障现象：模组闪烁\n处理结果：换线'})
        self.assertEqual(proximity.search(self.work,'模组 闪烁','cases',['模组','闪烁'],['R512'])['results'],[])

    def test_multi_product_document_never_borrows_neighbor_model_parameters(self):
        self.seed({'产品技术参数.txt':'HD-R512产品参数\n工作正常\nHD-R512S产品参数\n支持模组闪烁检查'})
        self.assertEqual(proximity.search(self.work,'模组 闪烁','products',['模组','闪烁'],['R512'])['results'],[])

    def test_returned_document_scope_is_applied_before_fts_candidate_limits(self):
        files={f'C16L其他参数{i}.txt':'C16L 带载 像素 '*8 for i in range(35)}
        files['C16L目标规格书.txt']='C16L 带载 123 像素'
        self.seed(files)
        r=proximity.search(self.work,'C16L 带载 像素','products',['带载','像素'],['C16L'],documents=['C16L目标规格书.txt'])
        self.assertTrue(r['results']);self.assertTrue(all(x['name']=='C16L目标规格书.txt' for x in r['results']))
        self.assertEqual(proximity.search(self.work,'带载','text',['带载'],documents=['不存在.txt'])['results'],[])


if __name__=='__main__':unittest.main()
