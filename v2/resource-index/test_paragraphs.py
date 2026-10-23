import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import engine
import paragraphs
import public_index
import role_index


def block(number, text, kind, section, **extra):
    return {'id': number, 'ordinal': number-1, 'text': text, 'text_hash': hashlib.sha256(text.encode()).hexdigest(),
            'locator': json.dumps({'structure': paragraphs.REVISION, 'unitKind': kind, 'page': 2,
                                   'sectionId': section, 'sectionPath': [section], 'headingOrdinals': [0], **extra})}


class ParagraphTests(unittest.TestCase):
    def test_paragraph_not_entire_page_and_retains_following_qualifier(self):
        rows=[block(1,'一、功能','heading','功能'),block(2,'支持任意添加图层，无数量限制；','bullet','功能'),
              block(3,'注：条件甲。','paragraph','功能'),block(4,'支持16路音频。','bullet','功能')]
        units=list(role_index.units_for(rows,'parameter'))
        self.assertEqual([[s['blockId'] for s in u['spans']] for u in units],[[1,2,3],[1,4]])
        self.assertEqual(units[0]['basis'],'native-bullet')

    def test_operation_section_keeps_steps_without_next_task(self):
        rows=[block(1,'5.9 EDID 设置','heading','EDID'),block(2,'前提：先连接信号源。','paragraph','EDID'),
              block(3,'偏绿时修正HDMI偏色，如下图。','paragraph','EDID',visualContextRequired=True),
              block(4,'5.10 画质调整','heading','画质'),block(5,'调整画质。','paragraph','画质',headingOrdinals=[3])]
        units=list(role_index.units_for(rows,'operation'))
        self.assertEqual([[s['blockId'] for s in u['spans']] for u in units],[[1,2,3],[4,5]])
        self.assertFalse(units[0]['complete'])

    def test_host_scope_needs_both_section_and_native_table_fields(self):
        rows=[['CPU','8核'],['内存','16G'],['显卡','4G'],['操作系统','Windows']]
        self.assertTrue(paragraphs.host_requirements('六、推荐配置',rows))
        self.assertFalse(paragraphs.host_requirements('产品参数',rows))
        self.assertFalse(paragraphs.host_requirements('推荐配置',[['分辨率','1920x1080']]))

    def test_step_number_alone_is_not_a_heading(self):
        self.assertIsNone(paragraphs.title_level('1.选择当前设备',10,10,False))
        self.assertEqual(paragraphs.title_level('5.9 EDID 设置',12,10,True),3)
        self.assertIsNone(paragraphs.title_level('5.9 EDID设置 ........ 12',12,10,True))

    def test_catalog_identity_aliases_and_unlisted_files(self):
        with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as tmp:
            root=Path(tmp);source=root/'release';source.mkdir()
            (source/'R712.bin').write_bytes(b'firmware-binary')
            (source/'alias.bin').write_bytes(b'firmware-binary')
            (source/'PRIVATE.txt').write_text('NOT IN CATALOG')
            sha=engine.digest(source/'R712.bin')
            manifest={'schemaVersion':'xhj-local-public-files-1','recordCount':2,'uniqueContentCount':1,
                      'files':[{'sha256':sha,'sizeBytes':15,'records':[{'relativePath':n,'category':'firmware'} for n in ['R712.bin','alias.bin']]}]}
            catalog=source/'index.json';catalog.write_text(json.dumps(manifest))
            with patch.object(engine,'known_product_models',return_value={'R712'}):
                result=public_index.register(catalog,root/'work')
                self.assertEqual(result['registeredRecords'],2)
                db=engine.connect(root/'work',True)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM locations').fetchone()[0],2)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM blocks').fetchone()[0],0)
                db.close()
                # Same length is insufficient identity proof, including aliases.
                (source/'alias.bin').write_bytes(b'x'*15)
                with self.assertRaisesRegex(ValueError,'size-changed|hash-mismatch'):
                    public_index.register(catalog,root/'work')

    def test_catalog_path_cannot_escape_release_root(self):
        with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as tmp:
            root=Path(tmp)
            data={'schemaVersion':'xhj-local-public-files-1','recordCount':1,'uniqueContentCount':1,
                  'files':[{'sha256':'a'*64,'sizeBytes':1,'records':[{'relativePath':'../outside.pdf','category':'spec'}]}]}
            path=root/'catalog.json';path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'outside-release-root'):
                public_index.catalog_records(path)

    def test_native_pdf_wrapped_bullet_and_table_geometry(self):
        from reportlab.pdfgen import canvas
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
        with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as tmp:
            path=Path(tmp)/'合成软件规格书.pdf';c=canvas.Canvas(str(path),pagesize=(600,800))
            c.setFont('STSong-Light',18);c.drawString(40,750,'一、功能特性')
            c.setFont('STSong-Light',11)
            c.drawString(40,710,'● 支持窗口编辑，连接灯控台和音控台，提供一体')
            c.drawString(40,679,'化解决方案；')
            c.drawString(40,648,'● 支持另一项独立功能。')
            c.setFont('STSong-Light',18);c.drawString(40,600,'二、推荐配置')
            rows=[['CPU','8核16线程'],['内存','16G以上'],['显卡','4G以上'],['操作系统','Windows']]
            c.setFont('STSong-Light',11)
            for i,row in enumerate(rows):
                y=550-i*32;c.drawString(50,y-21,row[0]);c.drawString(250,y-21,row[1])
            for x in (40,230,560):c.line(x,550,x,422)
            for i in range(5):c.line(40,550-i*32,560,550-i*32)
            c.save()
            parsed=paragraphs.extract(path)
            self.assertEqual(parsed['details']['tableCount'],1)
            bullets=[b for b in parsed['blocks'] if b['locator']['unitKind']=='bullet']
            self.assertEqual(len(bullets),2)
            self.assertIn('化解决方案',bullets[0]['text'])
            self.assertNotIn('另一项',bullets[0]['text'])
            table=next(b for b in parsed['blocks'] if b['locator']['unitKind']=='table')
            self.assertEqual(table['locator']['cells'],rows)
            self.assertEqual(table['locator']['contextSubject'],'software-host-computer')
            self.assertEqual(table['locator']['page'],1)


if __name__=='__main__':
    unittest.main()
