import unittest,tempfile,zipfile,pathlib,sys,sqlite3,json,hashlib
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from document_sections import sections
from file_attributes import attributes
import section_search
class Tests(unittest.TestCase):
    def test_docx_without_headings_preserves_prose_and_table(self):
        with tempfile.TemporaryDirectory() as folder:
            p=pathlib.Path(folder)/'source.docx'
            with zipfile.ZipFile(p,'w') as z:z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>无标题原文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>输入电压</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>5V</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
            chunks,report=sections(p);self.assertIn('无标题原文',chunks[0]['text']);self.assertIn('输入电压 | 5V',chunks[0]['text']);self.assertFalse(report['ocr'])
    def test_missing_attributes_stay_unknown(self):
        row=attributes('模块.ssr',['2026新调试配置']);self.assertEqual(row['chips'],[]);self.assertIsNone(row['manufacturer']);self.assertEqual(row['hubs'],[])
    def test_explicit_fields(self):
        row=attributes('CYD_P1.25_512x512_DP3364S_32020_64S_HUB320.ssr',['彩易达'])
        self.assertEqual(row['manufacturerAbbreviation'],'CYD');self.assertEqual(row['chips'],['DP3364S']);self.assertEqual(row['decoders'],['32020'])
    def test_source_scope_metadata_and_changed_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);db=sqlite3.connect(root/'sections.db')
            db.executescript('CREATE TABLE files(id TEXT,kind TEXT,name TEXT,path TEXT,sha256 TEXT,size INTEGER,mtime_ns INTEGER,models TEXT,attributes TEXT,download TEXT);CREATE TABLE sections(id TEXT,file_id TEXT,heading TEXT,text TEXT,locator TEXT);')
            for i,(kind,name,model,att,text) in enumerate([
                ('spec','设备X100.pdf',['HD-X100'],{},'输入电压 5V；视频支持1080P'),('manual','设备X200.pdf',['HD-X200'],{},'输入电压 12V'),('module-config','P3_64x64_SM16208_32S.ssr',[],{'chips':['SM16208'],'pitches':['P3'],'scans':['32S'],'resolutions':['64x64']},'')]):
                p=root/name;p.write_bytes(b'original');s=p.stat();fid=str(i);db.execute('INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?,?)',(fid,kind,name,str(p),hashlib.sha256(b'original').hexdigest(),s.st_size,s.st_mtime_ns,json.dumps(model),json.dumps(att),'/file/'+fid))
                if text:db.execute('INSERT INTO sections VALUES(?,?,?,?,?)',(fid,fid,'["参数"]',text,'{}'))
            db.commit();db.close();np.savez(root/'vectors.npz',vectors=np.array([[1.,0.],[1.,0.]]),owners=np.array([0,1]));(root/'vectors.json').write_text(json.dumps({'sectionIds':['0','1']}))
            class Dummy:
                def __init__(self,*a):pass
                def encode(self,text):return np.array([[1.,0.]])
            with patch.object(section_search,'Embedder',Dummy):idx=section_search.SectionIndex(root,root)
            found=idx.search('HD-X100电压是多少');self.assertTrue(found['results']);self.assertTrue(all(r['models']==['HD-X100'] for r in found['results']))
            self.assertEqual(idx.search('HD-X100Z电压')['results'],[])
            self.assertNotIn('video',idx.search('HD-X100播放视频支持多少')['plan']['kinds'])
            self.assertTrue(idx.search('64x64P332SSM16208 配置文件')['results'][0]['queryMatch']['exact'])
            missing=idx.search('P99 SM9999 64x64 配置文件');self.assertTrue(missing['results']);self.assertFalse(missing['results'][0]['queryMatch']['exact'])
            self.assertEqual(idx.search('P99 SM9999 64S 配置文件')['results'],[])
            (root/'设备X100.pdf').write_bytes(b'changed-file')
            self.assertEqual(idx.search('HD-X100电压是多少')['results'],[])
            with self.assertRaises(ValueError):idx.search('x'*241)
if __name__=='__main__':unittest.main()
