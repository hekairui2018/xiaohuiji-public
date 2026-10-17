import unittest,tempfile,threading,json,urllib.request
from pathlib import Path
import engine,server

class CatalogDocumentTests(unittest.TestCase):
 def test_legacy_formats_and_cached_cover_are_exposed_without_prose_false_positive(self):
  with tempfile.TemporaryDirectory(dir=engine.PROJECT/'tmp') as temp:
   root=Path(temp)/'originals';root.mkdir();work=Path(temp)/'index'
   for name in ['40S操作说明.doc','X9规格书.xlsx','软件手册.pptx','无标题.pdf','故障笔记.pdf']:(root/name).write_bytes(name.encode())
   engine.scan(root,work);db=engine.connect(work)
   for name,text in [('无标题.pdf','PRODUCT SPECIFICATION\nHD-X9\nV1.0'),('故障笔记.pdf','排查时应阅读产品规格书。')]:
    sha=db.execute('SELECT sha256 FROM locations WHERE name=?',(name,)).fetchone()[0];db.execute('INSERT INTO blocks(hash,ordinal,locator,text,text_hash,models) VALUES(?,?,?,?,?,?)',(sha,0,'{}',text,sha,'[]'))
   db.commit();db.close();httpd=server.create_server(work);thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
   try:
    data=json.load(urllib.request.urlopen('http://127.0.0.1:'+str(httpd.server_port)+'/catalog'));rows={x['name']:x for x in data['resources']}
    self.assertEqual(len(rows),5);self.assertIn('documentIntro',rows['无标题.pdf']);self.assertNotIn('documentIntro',rows['故障笔记.pdf'])
   finally:httpd.shutdown();httpd.server_close();thread.join()

if __name__=='__main__':unittest.main()
