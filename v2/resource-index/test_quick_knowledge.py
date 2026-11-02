import hashlib, json, sqlite3, tempfile, unittest
from pathlib import Path
from file_registry import FileRegistry
from quick_knowledge import QuickKnowledge


class QuickSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()

    def test_files_use_existing_metadata_without_vectors_or_sections(self):
        db=sqlite3.connect(self.root/'sections.db')
        db.execute('CREATE TABLE files(id TEXT,name TEXT,kind TEXT,path TEXT,size INTEGER,mtime_ns INTEGER,sha256 TEXT,models TEXT,attributes TEXT,download TEXT)')
        for name,kind in [('HD-Q100规格书.pdf','spec'),('HD-Q100说明书.pdf','manual'),('Q100_V2.3.bin','firmware')]:
            p=self.root/name;p.write_bytes(name.encode());s=p.stat()
            db.execute('INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?,?)',(name,name,kind,str(p),s.st_size,s.st_mtime_ns,hashlib.sha256(p.read_bytes()).hexdigest(),'["HD-Q100"]','{}','/registered/'+name))
        db.commit();db.close();index=FileRegistry(self.root)
        r=index.search('给我Q100规格书');self.assertEqual([x['kind'] for x in r['results']],['spec']);self.assertFalse(r['vectorUsed'])
        self.assertEqual(index.search('HD-Q100X规格书')['results'],[])
        self.assertEqual(index.search('Q100 V99固件')['results'],[])
        self.assertEqual(index.search('Q100 V2.3固件')['results'][0]['name'],'Q100_V2.3.bin')

    def corpus(self):
        db=sqlite3.connect(self.root/'knowledge.sqlite')
        db.executescript('CREATE TABLE sources(id INTEGER,name TEXT,sha256 TEXT); CREATE TABLE records(id INTEGER PRIMARY KEY,source_id INTEGER,kind TEXT,models TEXT,parameter TEXT,value TEXT,conditions TEXT,sheet TEXT,cell TEXT,status TEXT,question TEXT,keywords TEXT); CREATE VIRTUAL TABLE record_search USING fts5(parameter,conditions,value,keywords);')
        db.executemany('INSERT INTO sources VALUES(?,?,?)',[(1,'异步全彩FAQ.csv','a'*64),(2,'LCD产品问题.csv','b'*64),(3,'固件功能.xlsx','c'*64)])
        rows=[(1,1,'faq','["X100"]','怎么修改密码','先确认设备为X100，再进入设置。','仅X100版本A','CSV','2','ready','怎么修改密码','密码'),
              (2,2,'faq','[]','怎么修改密码','LCD专属操作','仅LCD播放器','CSV','3','ready','怎么修改密码','密码'),
              (3,1,'faq','["X200"]','怎么修改密码','X200的步骤','仅X200','CSV','4','ready','怎么修改密码','密码'),
              (4,1,'faq','[]','怎么修改密码','','缺少答案','CSV','5','incomplete','怎么修改密码','密码'),
              (5,3,'parameter','[]','单模组90度旋转','√','固件示例：V2.1.65.30；限定示例','功能','E3','ready','',''),
              (6,3,'parameter','[]','单模组180度旋转','×','固件示例：V2.1.65.30；限定示例','功能','E4','ready','','')]
        for r in rows:
            db.execute('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',r)
            # Distinct meaningful words, so the FTS test does not require source originals.
            db.execute('INSERT INTO record_search(rowid,parameter,conditions,value,keywords) VALUES(?,?,?,?,?)',(r[0],'修改 密码 单模 模组 90 180 旋转',r[6],r[5],r[11]))
        db.commit();db.close();return QuickKnowledge(self.root/'knowledge.sqlite')

    def test_new_wiki_registration_is_visible_without_rebuilding_sections(self):
        section=self.root/'sections';section.mkdir()
        db=sqlite3.connect(section/'sections.db');db.execute('CREATE TABLE files(id TEXT,name TEXT,kind TEXT,path TEXT,size INTEGER,mtime_ns INTEGER,sha256 TEXT,models TEXT,attributes TEXT,download TEXT)');db.close()
        file=self.root/'HDPlayer说明书.pdf';file.write_bytes(b'new registered original');stat=file.stat();sha=hashlib.sha256(file.read_bytes()).hexdigest()
        db=sqlite3.connect(self.root/'resources.db');db.executescript('CREATE TABLE locations(id INTEGER,name TEXT,path TEXT,bytes INTEGER,mtime_ns INTEGER,sha256 TEXT,state TEXT); CREATE TABLE approved_files(sha256 TEXT,type TEXT);')
        db.execute('INSERT INTO locations VALUES(?,?,?,?,?,?,?)',(1,file.name,str(file),stat.st_size,stat.st_mtime_ns,sha,'present'));db.execute('INSERT INTO approved_files VALUES(?,?)',(sha,'document'));db.commit();db.close()
        found=FileRegistry(section,self.root).search('给我HDPlayer说明书')['results']
        self.assertEqual(len(found),1);self.assertEqual(found[0]['sha256'],sha);self.assertEqual(found[0]['download'],'/v2/offline/file?id=1&download=1')

    def test_faq_keeps_conditions_and_excludes_other_devices_and_lcd(self):
        index=self.corpus();r=index.lookup('X100怎么修改密码','faq',['X100'],['修改','密码'],['HDPlayer'])
        self.assertEqual(len(r['results']),1);self.assertEqual(r['results'][0]['conditions'],'仅X100版本A')
        self.assertEqual(r['results'][0]['locator'],{'sheet':'CSV','cell':'2'})
        mobile=index.lookup('X100怎么修改密码','faq',['X100'],['修改','密码'],['屏掌控'])
        self.assertEqual([row['name'] for row in mobile['results']],['异步全彩FAQ.csv'])

    def test_firmware_features_require_full_version_and_requested_angle(self):
        index=self.corpus();self.assertEqual(index.lookup('单模组90度旋转','parameter')['results'],[])
        r=index.lookup('V2.1.65.30单模组90度旋转','parameter')
        self.assertEqual([x['parameter'] for x in r['results']],['单模组90度旋转'])


if __name__=='__main__':unittest.main()
