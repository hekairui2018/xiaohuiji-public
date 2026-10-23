import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from xml.sax.saxutils import escape

import case_knowledge as fields
import engine
import role_index


class CaseKnowledgeTests(unittest.TestCase):
    def test_same_module_outweighs_symptom_only_and_different_module_conflicts(self):
        first=fields.case_fields('2.1065L黑屏红色亮点问题\n海佳P2.5 64S模组，ICN1065L+TC7559芯片，黑屏有红色亮点\n解决方法：仅为合成办法甲。')
        query='海佳P2.5 64S模组 ICN1065L 黑屏红点'
        match=fields.compare(query,first)
        self.assertIn('same-module',match['matchedFields']);self.assertEqual(match['conflictingFields'],[])
        self.assertFalse(first['outcomeVerified'])
        other=fields.case_fields('强力P2.5 64S模组，ICN1065L，黑屏红点\n解决方法：合成办法乙')
        self.assertIn('module-identity',fields.compare(query,other)['conflictingFields'])
        unrelated=fields.case_fields('黑屏红点\n解决方法：合成参考')
        self.assertGreater(match['score'],fields.compare(query,unrelated)['score'])

    def test_exact_chip_suffix_and_scan_are_independent_constraints(self):
        case=fields.case_fields('海佳P2.5 64S模组，ICN1065L+TC7559，黑屏\n解决方法：合成处理')
        self.assertIn('chips',fields.compare('ICN1065 黑屏',case)['conflictingFields'])
        self.assertIn('scan',fields.compare('海佳P2.5 32S模组 ICN1065L 黑屏',case)['conflictingFields'])
        self.assertEqual(fields.compare('ICN1065L 黑屏',case)['conflictingFields'],[])

    def test_pitch_alone_does_not_establish_same_module(self):
        result=fields.compare('P2.5 模组 黑屏',fields.case_fields('海佳P2.5 64S模组 黑屏\n解决方法：合成参考'))
        self.assertNotIn('same-module',result['matchedFields']);self.assertTrue(result['conditional'])

    def test_faq_question_site_trigger_preserves_offsets_and_ignores_historical_ai_output(self):
        headers=['问题内容','现场信息','解决方案','输出结果','提交人']
        cells=['屏幕黑屏','合成模组甲、ICN1065L','反馈研发，待处理','错误的历史AI答案','合成人员']
        columns=fields.faq_columns(headers);text=' | '.join(cells)
        mask=fields.faq_mask(text,cells,columns)
        self.assertEqual(len(mask),len(text));self.assertIn('ICN1065L',mask)
        self.assertNotIn('历史AI',mask);self.assertNotIn('反馈研发',mask)
        projected=fields.faq_fields(cells,columns)
        self.assertFalse(projected['historicalAgentOutputIsAnswer']);self.assertEqual(projected['resolutionState'],'pending-action')
        self.assertEqual(fields.faq_fields(cells,fields.faq_columns(['问题内容','现场信息','其他','输出结果','提交人']))['answer'],'')

    def test_blank_csv_cells_do_not_shift_source_offsets(self):
        cells=['','问题甲','答案乙','',''];text=' | '.join(cells).strip();columns=fields.faq_columns(['日期','问题描述','解决方案','现场信息','记录人'])
        mask=fields.faq_mask(text,cells,columns)
        self.assertEqual(mask.index('问题甲'),text.index('问题甲'));self.assertEqual(len(mask),len(text))

    def test_real_word_heading_format_separates_case_from_numbered_actions(self):
        with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as tmp:
            root=Path(tmp);original=root/'files';original.mkdir()
            name='合成问题经验分享.docx'
            content=[('2.1065L黑屏红色亮点问题',True),('海佳P2.5 64S模组，ICN1065L，黑屏红点',False),
                     ('解决方法：合成处理甲',False),('3.扩展属性界面，关闭黑屏节能模式。',False),
                     ('3.高温色带现象',True),('另一模组的颜色问题',False),('解决方法：合成处理乙',False)]
            body=''.join('<w:p><w:r>'+('<w:rPr><w:b/></w:rPr>' if bold else '')+'<w:t>'+escape(text)+'</w:t></w:r></w:p>' for text,bold in content)
            with zipfile.ZipFile(original/name,'w') as package:
                package.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>')
            self.assertEqual(fields.docx_headings(original/name),{1,5})
            (original/'合成FAQ.csv').write_text('问题描述,现场信息,解决方案\n合成黑屏,合成模组甲,独占解决词乙\n合成闪屏,合成模组乙,独占解决词甲',encoding='utf-8')
            work=root/'catalog';folder=root/'roles'
            with patch.object(engine,'known_product_models',return_value=set()):
                engine.scan(original,work);engine.index_documents(work);role_index.build(work,folder)
                rows=role_index.search(work,folder,'红点',role='case',concepts=['红点'])['results']
                self.assertTrue(rows)
                text='\n'.join(b['text'] for b in role_index.read(work,folder,rows[0]['unitId'])['blocks'])
                self.assertIn('合成处理甲',text);self.assertIn('扩展属性界面',text)
                self.assertNotIn('高温色带',text);self.assertNotIn('合成处理乙',text)
                self.assertEqual(role_index.search(work,folder,'独占解决词乙',role='faq',concepts=['独占解决词乙'])['results'],[])
                faq=role_index.search(work,folder,'合成黑屏',role='faq',concepts=['合成黑屏'])['results'][0]
                self.assertEqual(faq['knowledgeUnit']['faqFields']['answer'],'独占解决词乙')
                self.assertEqual(len(faq['knowledgeUnit']['sourceSpans']),1)


if __name__=='__main__':
    unittest.main()
