import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
import zipfile
from xml.sax.saxutils import escape
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import engine
import role_index
import server


class RoleIndexTests(unittest.TestCase):
    def setUp(self):
        # This catalogue is fully synthetic and does not require private knowledge files.
        models = patch.object(engine, 'known_product_models', return_value={'R712', 'R712S', 'R716'})
        models.start()
        self.addCleanup(models.stop)
        workspace_tmp = engine.PROJECT / 'tmp'
        workspace_tmp.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=workspace_tmp)
        root = Path(self.tmp.name) / 'originals'
        root.mkdir()
        documents = {
            'R712规格书 V1.0.txt':'产品规格书\nHD-R712\n带载范围 最大26万点，512*512\n推荐常规128*1024，PWM256*1024\n注：实际带载与接口数和模组分辨率有关',
            'R712S规格书 V1.0.txt':'产品规格书\nHD-R712S\n带载范围 最大30万点',
            'HDPlayer用户手册.txt':'HDPlayer 用户手册\n目录\n1.定时开关机 ................ 25\n2.固件升级 ................ 28\n第一章 节目更新\n前提：先连接设备并保存当前节目\n1.定时开关机\n步骤1）进入系统控制\n步骤2）设置开机和关机时间\n步骤3）勾选并发送到设备\n2.固件升级\n步骤1）选择固件\n步骤2）确认升级',
            'FAQ.csv':'问题,答案\nR712黑屏,检查电源\nR712闪烁,检查排线',
            'R716规格书.txt':'产品规格书\nHD-R716\n显示科技 灰度让世界精彩\n灰度等级 256~65536级\n显示科技 灰度让世界精彩\n连接尺寸图\n显示科技 灰度让世界精彩\n版权所有 © 2026 灰度科技股份有限公司\n有灰度更精彩！',
            '合成故障案例汇总.txt':'合成故障记录\n3.45 SYNCHIP1001芯片闪屏问题\n模组信息：SYNCHIP1001，合成条件甲\n问题现象：固定位置闪屏\n1、使用测试工具核对连接问题\n2、更换测试排线，观察闪屏问题是否变化\n3.45.1 问题现象\n仍需记录现场结果\n解决方法：仅适用于合成条件甲的措施甲\n2002\n3.46 SYNCHIP2002芯片黑屏问题\n模组信息：SYNCHIP2002，合成条件乙\n问题现象：黑屏\n解决方法：仅适用于合成条件乙的措施乙',
            '合成超长故障案例.txt':'2.1 SYNCHIP3003芯片花屏问题\n模组信息：SYNCHIP3003，合成前提\n问题现象：花屏\n'+('观察记录：仅为合成连续文本，尚未验证故障原因。\n'*1250)+'处理结果：仍待核对\n2.2 SYNCHIP4004芯片白屏问题\n问题现象：白屏\n处理结果：另一条独立合成记录',
        }
        for name,text in documents.items():
            (root/name).write_text(text,encoding='utf8')
        # A real DOCX structure reproduces case paragraphs separated by an
        # embedded table row; rows must not disable sectioning of the document.
        paragraphs=documents['合成故障案例汇总.txt'].splitlines()
        body=[]
        for line in paragraphs:
            if line=='2002':
                body.append('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>合成表格中的条件甲补充</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
            body.append('<w:p><w:r><w:t>'+escape(line)+'</w:t></w:r></w:p>')
        with zipfile.ZipFile(root/'合成案例含表格.docx','w') as package:
            package.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join(body)+'</w:body></w:document>')
        firmware=root/'合成配置资料'/'SYNTHCHIP1234'
        firmware.mkdir(parents=True)
        (firmware/'R712_FPGA_V1.2.3.4_ZZ.bin').write_bytes(b'fixture')
        (root/'R712_FPGA_V1_GENERIC.bin').write_bytes(b'other-fixture')
        self.work = Path(self.tmp.name)/'catalog'
        self.folder = Path(self.tmp.name)/'role'
        engine.scan(root,self.work)
        engine.index_documents(self.work)
        db=engine.connect(self.work)
        # Synthetic PDF page fixture: the parser really stores disjoint chunks;
        # role windows must restore both parameter values and their source note.
        sha=db.execute("SELECT sha256 FROM locations WHERE name=?",('R712规格书 V1.0.txt',)).fetchone()[0]
        for b in db.execute('SELECT * FROM blocks WHERE hash=?',(sha,)).fetchall():
            db.execute('UPDATE blocks SET locator=? WHERE id=?',(json.dumps({'page':2,'charStart':b['ordinal']*100}),b['id']))
        other=db.execute("SELECT sha256 FROM locations WHERE name=?",('R716规格书.txt',)).fetchone()[0]
        for b in db.execute('SELECT * FROM blocks WHERE hash=?',(other,)).fetchall():
            db.execute('UPDATE blocks SET locator=? WHERE id=?',(json.dumps({'page':b['ordinal']+1,'charStart':0}),b['id']))
        db.commit();db.close()
        self.before=engine.digest(self.work/'resources.db')
        self.receipt=role_index.build(self.work,self.folder)
        db=engine.connect(self.work,True)
        self.hashes={r['name']:r['sha256'] for r in db.execute('SELECT name,sha256 FROM locations')}
        db.close()

    def tearDown(self):
        self.tmp.cleanup()

    def search(self,q,**kw):
        return role_index.search(self.work,self.folder,q,**kw)

    def test_parameter_preserves_maximum_recommendation_and_condition(self):
        rows=self.search('R712 带载',role='parameter',models=['R712'],concepts=['带载'])['results']
        self.assertTrue(rows)
        result=role_index.read(self.work,self.folder,rows[0]['unitId'])
        text='\n'.join(b['text'] for b in result['blocks'])
        for part in ['26万点','128*1024','PWM256*1024','实际带载与接口数']:
            self.assertIn(part,text)
        self.assertEqual(rows[0]['knowledgeUnit']['sourceSpans'],result['knowledgeUnit']['sourceSpans'])
        self.assertFalse(result['knowledgeUnit']['compatibilityConfirmed'])
        self.assertFalse(result['knowledgeUnit']['complete'])

    def test_manual_returns_steps_before_directory_and_keeps_prerequisite(self):
        row=self.search('HDPlayer 定时 开关机',role='operation',concepts=['定时','开关机'])['results'][0]
        read=role_index.read(self.work,self.folder,row['unitId'])
        text='\n'.join(b['text'] for b in read['blocks'])
        for expected in ['先连接设备','进入系统控制','设置开机和关机时间','勾选并发送']:
            self.assertIn(expected,text)
        self.assertNotIn('选择固件',text)
        self.assertNotIn('................',text)

    def test_exact_model_suffix_never_substitutes(self):
        rows=self.search('带载',role='parameter',models=['R712S'],concepts=['带载'])['results']
        self.assertEqual(len(rows),1)
        self.assertIn('R712S',rows[0]['name'])
        self.assertNotIn('26万',rows[0]['text'])

    def test_numeric_case_title_preserves_conditions_and_excludes_sibling(self):
        row=self.search('措施甲',role='case',concepts=['措施甲'],documents=['合成故障案例汇总.txt'])['results'][0]
        result=role_index.read(self.work,self.folder,row['unitId'])
        text='\n'.join(b['text'] for b in result['blocks'])
        for expected in ['3.45 SYNCHIP1001芯片闪屏问题','合成条件甲','固定位置闪屏','更换测试排线','仍需记录现场结果','措施甲']:
            self.assertIn(expected,text)
        for other in ['2002','合成条件乙','措施乙']:
            self.assertNotIn(other,text)
        self.assertTrue(result['boundary'].startswith('explicit-case-heading-continuous-section'))
        self.assertFalse(result['knowledgeUnit']['complete'])
        db=engine.connect(self.work,True)
        first=result['knowledgeUnit']['sourceSpans'][0]
        raw=db.execute('SELECT text FROM blocks WHERE id=?',(first['blockId'],)).fetchone()[0]
        self.assertIn('3.45 SYNCHIP1001',raw[first['start']:first['end']])
        db.close()

    def test_chip_label_before_next_title_is_not_a_measure_of_previous_case(self):
        row=self.search('措施乙',role='case',concepts=['措施乙'],documents=['合成故障案例汇总.txt'])['results'][0]
        result=role_index.read(self.work,self.folder,row['unitId'])
        text='\n'.join(b['text'] for b in result['blocks'])
        self.assertTrue(text.startswith('2002\n3.46 SYNCHIP2002芯片黑屏问题'))
        self.assertNotIn('措施甲',text)
        self.assertNotIn('SYNCHIP1001',text)

    def test_docx_embedded_table_does_not_disable_case_boundaries(self):
        rows=self.search('措施甲',role='case',concepts=['措施甲'],documents=['合成案例含表格.docx'])['results']
        self.assertEqual(len(rows),1)
        result=role_index.read(self.work,self.folder,rows[0]['unitId'])
        text='\n'.join(p['text'] for p in result['blocks'])
        for part in ['3.45 SYNCHIP1001','合成条件甲','措施甲','合成表格中的条件甲补充']:
            self.assertIn(part,text)
        self.assertTrue(any('table' in p['locator'] for p in result['knowledgeUnit']['sourceSpans']))
        for part in ['2002','SYNCHIP2002','措施乙']:
            self.assertNotIn(part,text)
        second=self.search('措施乙',role='case',concepts=['措施乙'],documents=['合成案例含表格.docx'])['results'][0]
        read=role_index.read(self.work,self.folder,second['unitId'])
        self.assertIn('3.46 SYNCHIP2002','\n'.join(p['text'] for p in read['blocks']))
        self.assertNotIn('条件甲','\n'.join(p['text'] for p in read['blocks']))

    def test_case_spreadsheet_rows_stay_independent_records(self):
        blocks=[{'id':i+1,'text':text,'text_hash':hashlib.sha256(text.encode()).hexdigest(),
                 'locator':json.dumps({'sheet':'合成记录','row':i+1})}
                for i,text in enumerate(['3.1 合成黑屏问题，措施甲','3.2 合成闪屏问题，措施乙'])]
        units=list(role_index.units_for(blocks,'case'))
        self.assertEqual(len(units),2)
        self.assertTrue(all(u['basis']=='native-row' and len(u['spans'])==1 for u in units))

    def test_case_heading_rejects_numbered_actions_and_internal_fields(self):
        for line in ['1、使用软件检查闪屏问题','2.更换排线，观察闪烁异常','3.45.1 问题现象','3.45.2 解决方法','4.1 检查芯片故障','5.1 调整参数解决黑屏问题','1.定时开关机 ................ 25']:
            with self.subTest(line=line):
                self.assertIsNone(role_index.case_heading(line))
        for line in ['3.45 SYNCHIP1001芯片闪屏问题','3.46 SYNCHIP2002芯片黑屏问题','2.4.1 合成设备升级后花屏问题','1、合成设备掉线故障','案例一：合成花屏记录']:
            with self.subTest(line=line):
                self.assertEqual(role_index.case_heading(line),line)

    def test_long_case_window_keeps_title_spans_without_claiming_case_or_read_complete(self):
        rows=self.search('SYNCHIP3003',role='case',concepts=['SYNCHIP3003'],documents=['合成超长故障案例.txt'],limit=10)['results']
        self.assertGreaterEqual(len(rows),2)
        later=next(row for row in rows if row['proximity']['totalContextChars']>6000 and any(p['role']=='condition' for p in row['knowledgeUnit']['sourceSpans']))
        first=role_index.read(self.work,self.folder,later['unitId'])
        self.assertIsNotNone(first['nextOffset'])
        self.assertFalse(first['knowledgeUnit']['complete'])
        self.assertTrue(first['boundaryWindowLimited'])
        self.assertIn('window-limited',first['boundary'])
        self.assertIn('2.1 SYNCHIP3003芯片花屏问题','\n'.join(p['text'] for p in first['blocks']))
        self.assertIn('模组信息：SYNCHIP3003','\n'.join(p['text'] for p in first['blocks']))
        offset=first['nextOffset'];texts=[p['text'] for p in first['blocks']]
        while offset is not None:
            page=role_index.read(self.work,self.folder,later['unitId'],offset)
            self.assertFalse(page['knowledgeUnit']['complete'])
            texts.extend(p['text'] for p in page['blocks'])
            offset=page['nextOffset']
        self.assertNotIn('SYNCHIP4004','\n'.join(texts))
        self.assertNotIn('另一条独立合成记录','\n'.join(texts))

    def test_grayscale_equivalences_retrieve_the_parameter_field_with_unchanged_model_scope(self):
        for phrase in ['灰阶', '灰度等级', '灰度级', 'Gray scale', 'Grayscale']:
            with self.subTest(phrase=phrase):
                rows=self.search('R716 '+phrase,role='parameter',models=['R716'],concepts=[phrase])['results']
                self.assertTrue(rows)
                self.assertTrue(all('R716' in r['name'] for r in rows))
                self.assertTrue(any('256~65536' in r['text'] for r in rows))
                read=role_index.read(self.work,self.folder,rows[0]['unitId'])
                self.assertEqual(read['knowledgeUnit']['sourceSpans'],rows[0]['knowledgeUnit']['sourceSpans'])

    def test_firmware_metadata_keeps_filename_and_directory_without_fake_body(self):
        rows=self.search('R712 SYNTHCHIP1234',role='firmware',models=['R712'],concepts=['SYNTHCHIP1234'])['results']
        self.assertTrue(rows)
        row=rows[0]
        self.assertIn('V1.2.3.4_ZZ.bin',row['name'])
        self.assertIn('SYNTHCHIP1234',row['text'])
        self.assertEqual(row['kind'],'file')
        self.assertNotIn('blockId',row)
        self.assertFalse(row['knowledgeUnit']['bodyParsed'])
        self.assertTrue(all('SYNTHCHIP1234' in r['text'] for r in rows))
        with self.assertRaisesRegex(ValueError,'no-body'):
            role_index.read(self.work,self.folder,row['unitId'])

    def test_repeated_brand_slogan_does_not_answer_parameter_question(self):
        rows=self.search('灰度',role='parameter',models=['R716'],concepts=['灰度'])['results']
        self.assertEqual(len(rows),1)
        self.assertIn('256~65536',rows[0]['text'])

    def test_authorization_is_applied_before_candidate_limit(self):
        sha=self.hashes['R712S规格书 V1.0.txt']
        rows=self.search('带载',role='parameter',concepts=['带载'],authorized_keys=[sha],limit=1)['results']
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['sha256'],sha)
        self.assertEqual(self.search('带载',concepts=['带载'],authorized_keys=[])['results'],[])

    def test_read_permission_cannot_be_granted_by_unit_id(self):
        row=self.search('带载',role='parameter',concepts=['带载'])['results'][0]
        with self.assertRaises(PermissionError):
            role_index.read(self.work,self.folder,row['unitId'],authorized_keys=[])

    def test_documents_filter_cannot_expand_authorized_scope(self):
        self.assertEqual(self.search('带载',role='parameter',concepts=['带载'],
            documents=['R712规格书 V1.0.txt'],authorized_keys=[self.hashes['R712S规格书 V1.0.txt']])['results'],[])

    def test_faq_never_combines_customers_rows(self):
        rows=self.search('黑屏',role='faq',concepts=['黑屏'])['results']
        self.assertEqual(len(rows),1)
        result=role_index.read(self.work,self.folder,rows[0]['unitId'])
        text='\n'.join(p['text'] for p in result['blocks'])
        self.assertIn('检查电源',text)
        self.assertNotIn('检查排线',text)

    def test_source_raw_span_hash_and_offset_are_real(self):
        row=self.search('带载',role='parameter',concepts=['带载'])['results'][0]
        result=role_index.read(self.work,self.folder,row['unitId'])
        db=engine.connect(self.work,True)
        for p in result['knowledgeUnit']['sourceSpans']:
            original=db.execute('SELECT text FROM blocks WHERE id=?',(p['blockId'],)).fetchone()[0]
            self.assertEqual(hashlib.sha256(original.encode('utf8')).hexdigest(),p['textHash'])
        db.close()

    def test_build_search_read_do_not_mutate_source_catalogue(self):
        row=self.search('带载',role='parameter',concepts=['带载'])['results'][0]
        role_index.read(self.work,self.folder,row['unitId'])
        self.assertTrue(self.receipt['sourceDBUnchanged'])
        self.assertEqual(engine.digest(self.work/'resources.db'),self.before)
        self.assertTrue(role_index.health(self.work,self.folder)['ready'])

    def test_existing_artifact_needs_explicit_replace(self):
        with self.assertRaises(FileExistsError):
            role_index.build(self.work,self.folder)

    def test_changed_source_is_fail_closed(self):
        db=engine.connect(self.work)
        db.execute("UPDATE blocks SET text=text||'changed' WHERE id=(SELECT MIN(id) FROM blocks)")
        db.commit();db.close()
        with self.assertRaisesRegex(ValueError,'stale'):
            self.search('带载',role='parameter',concepts=['带载'])

    def test_http_post_large_scope_and_scoped_read(self):
        http=server.create_server(self.work,0,self.folder)
        thread=threading.Thread(target=http.serve_forever,daemon=True)
        thread.start()
        def request(route,body):
            req=Request('http://127.0.0.1:'+str(http.server_port)+route,data=json.dumps(body).encode('utf8'),headers={'Content-Type':'application/json'})
            return json.load(urlopen(req))
        try:
            sha=self.hashes['R712规格书 V1.0.txt']
            scope=[sha]+[hashlib.sha256(str(i).encode()).hexdigest() for i in range(3000)]
            out=request('/role/search',{'q':'带载','role':'parameter','concepts':['带载'],'authorized_keys':scope})
            row=out['results'][0]
            read=request('/role/read',{'unit':row['unitId'],'authorized_keys':scope})
            self.assertEqual(read['knowledgeUnit']['id'],row['unitId'])
            with self.assertRaises(HTTPError) as error:
                request('/role/read',{'unit':row['unitId'],'authorized_keys':[]})
            self.assertEqual(error.exception.code,403)
            health=json.load(urlopen('http://127.0.0.1:'+str(http.server_port)+'/health'))
            self.assertTrue(health['roleIndex']['ready'])
        finally:
            http.shutdown();http.server_close();thread.join()


if __name__=='__main__':
    unittest.main()
